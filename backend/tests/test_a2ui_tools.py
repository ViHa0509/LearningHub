"""Spec: a2ui-chat - The Interactive tutor agent, The assistant hands interactive requests over,
Generated quiz (the tools and the result plumbing, with a fake runner and a scripted model)."""

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.a2ui.interface import ContentSink, InteractiveRequest, InteractiveResult
from app.agent.agents import AGENTS
from app.agent.loop import tool_loop
from app.agent.mcp_server import McpServer
from app.agent.messages import Message, ToolCall, Turn
from app.agent.resolve import merged
from app.agent.results import AgentResult
from app.agent.tools import AgentTools
from tests.agent_fakes import FakeModel
from tests.conftest import user_id_of

SECRET = "SECRET-EXPLANATION"
NEW_TOOLS = {"show_interactive", "make_quiz", "make_lesson"}
READ_TOOLS = ["search_notes", "read_note", "list_roadmap", "read_lesson"]
SURFACE = {"id": "s-1", "kind": "quiz", "title": "Docker", "messages": [{"version": "v0.9"}]}


class FakeRunner:
    def __init__(self, error: str | None = None) -> None:
        self.requests: list[InteractiveRequest] = []
        self.error = error

    def __call__(self, request: InteractiveRequest) -> InteractiveResult:
        self.requests.append(request)
        if self.error:
            return InteractiveResult(None, {}, "", error=self.error)
        return InteractiveResult(
            SURFACE,
            {"surface": {"kind": "quiz", "title": "Docker", "questions": 5}},
            "Made an interactive quiz: Docker (5 questions)",
        )


@pytest.fixture
def session(client: TestClient) -> Iterator[Session]:
    with client.app.state.session_factory() as s:  # type: ignore[attr-defined]
        yield s


def make_tools(client: TestClient, session: Session, **kwargs: Any) -> AgentTools:
    return AgentTools(
        session,
        client.app.state.catalog,  # type: ignore[attr-defined]
        user_id=user_id_of(client.app),
        **kwargs,
    )


def names(tools: AgentTools) -> list[str]:
    return [s.name for s in tools.specs()]


def call(name: str, **args: Any) -> ToolCall:
    return ToolCall(id=f"id-{name}", name=name, input=args)


def question(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "text": "Which command lists containers?",
        "options": ["docker ps", "docker run", "docker rm"],
        "answer": 1,
        "explanation": f"{SECRET}: docker ps lists them.",
    }
    return {**base, **changes}


def quiz(**changes: Any) -> dict[str, Any]:
    return {"title": "Docker", "questions": [question() for _ in range(3)], **changes}


# --- show_interactive ----------------------------------------------------------------------


def test_show_interactive_is_offered_to_the_assistant_with_a_runner(
    client: TestClient, session: Session
) -> None:
    runner = FakeRunner()
    assert "show_interactive" in names(make_tools(client, session, interactive=runner))
    assert "show_interactive" not in names(make_tools(client, session))


def test_show_interactive_follows_the_areas_allowed_set(
    client: TestClient, session: Session
) -> None:
    runner = FakeRunner()
    allowed = {"search_notes", "show_interactive"}
    tools = make_tools(client, session, interactive=runner, allowed=allowed)
    assert names(tools) == ["search_notes", "show_interactive"]
    left_out = make_tools(client, session, interactive=runner, allowed={"search_notes"})
    assert "show_interactive" not in names(left_out)
    outcome = left_out.run("show_interactive", {"kind": "quiz", "topic": "docker"})
    assert "unknown tool" in json.loads(outcome.result)["error"]
    assert runner.requests == []


def test_it_is_offered_only_to_the_assistant(client: TestClient, session: Session) -> None:
    runner = FakeRunner()
    for agent_id in ("lesson-writer", "outline"):
        tools = make_tools(client, session, agent_id=agent_id, interactive=runner)
        assert NEW_TOOLS.isdisjoint(names(tools))
        outcome = tools.run("show_interactive", {"kind": "quiz", "topic": "docker"})
        assert "unknown tool" in json.loads(outcome.result)["error"]
    a2ui = make_tools(client, session, agent_id="a2ui", interactive=runner)
    assert "show_interactive" not in names(a2ui)
    assert runner.requests == []


def test_the_result_to_the_model_is_the_runners_and_holds_no_answer(
    client: TestClient, session: Session
) -> None:
    runner = FakeRunner()
    tools = make_tools(client, session, interactive=runner)
    model = FakeModel(
        [
            Turn(
                text="",
                tool_calls=[
                    call("show_interactive", kind="quiz", topic="docker", node_id="devops/docker")
                ],
            ),
            Turn(text="Here is a quiz."),
        ]
    )
    result = tool_loop(model, "sys", [Message(role="user", text="quiz me")], tools, 4)
    assert result.reply == "Here is a quiz."
    assert result.surfaces == [SURFACE]
    assert result.steps[0].summary == "Made an interactive quiz: Docker (5 questions)"
    assert runner.requests == [InteractiveRequest("quiz", "docker", "devops/docker", None)]
    tool_message = next(m for m in model.calls[1]["messages"] if m.role == "tool")
    assert json.loads(tool_message.text) == {
        "surface": {"kind": "quiz", "title": "Docker", "questions": 5}
    }
    assert "answer" not in tool_message.text and "explanation" not in tool_message.text


def test_a_runner_error_passes_through_as_an_error_result(
    client: TestClient, session: Session
) -> None:
    tools = make_tools(client, session, interactive=FakeRunner(error="no provider"))
    outcome = tools.run("show_interactive", {"kind": "practice", "topic": "docker", "count": 5})
    assert json.loads(outcome.result) == {"error": "no provider"}
    assert outcome.surface is None and outcome.summary == "Error: no provider"


def test_show_interactive_refuses_bad_arguments(client: TestClient, session: Session) -> None:
    runner = FakeRunner()
    tools = make_tools(client, session, interactive=runner)
    bad: list[dict[str, Any]] = [
        {"kind": "game", "topic": "x"},
        {"kind": "quiz"},
        {"kind": "quiz", "topic": "x" * 201},
        {"kind": "quiz", "topic": "x", "node_id": "Docker"},
        {"kind": "quiz", "topic": "x", "count": 2},
        {"kind": "quiz", "topic": "x", "count": 11},
        {"kind": "quiz", "topic": "x", "count": True},
    ]
    for args in bad:
        assert "error" in json.loads(tools.run("show_interactive", args).result), args
    assert runner.requests == []
    tools.run("show_interactive", {"kind": "lesson", "topic": "x", "count": 10})
    assert len(runner.requests) == 1


# --- the a2ui agent's tools ----------------------------------------------------------------


def test_the_a2ui_agents_specs_are_the_read_tools_and_one_content_tool(
    client: TestClient, session: Session
) -> None:
    assert AGENTS["a2ui"].name == "Interactive tutor"
    for kind, tool in (("quiz", "make_quiz"), ("lesson", "make_lesson")):
        tools = make_tools(client, session, agent_id="a2ui", content_sink=ContentSink(kind))  # type: ignore[arg-type]
        assert sorted(names(tools)) == sorted([*READ_TOOLS, tool])
        spec = next(s for s in tools.specs() if s.name == tool)
        assert "url" not in json.dumps(spec.parameters).lower()
    quiz_tools = make_tools(client, session, agent_id="a2ui", content_sink=ContentSink("quiz"))
    assert quiz_tools.specs()[-1].parameters["properties"]["questions"]["minItems"] == 3
    outcome = quiz_tools.run("write_lesson", {"node_id": "a/b", "markdown": "x"})
    assert "unknown tool" in json.loads(outcome.result)["error"]
    outcome = quiz_tools.run("make_lesson", {})
    assert "unknown tool" in json.loads(outcome.result)["error"]


def test_make_quiz_refuses_invalid_content_then_the_agent_retries(
    client: TestClient, session: Session
) -> None:
    sink = ContentSink("quiz")
    tools = make_tools(client, session, agent_id="a2ui", content_sink=sink)
    bad = quiz()
    bad["questions"][1] = question(options=["only"])
    model = FakeModel(
        [
            Turn(text="", tool_calls=[call("make_quiz", **bad)]),
            Turn(text="", tool_calls=[call("make_quiz", **quiz())]),
            Turn(text="Done."),
        ]
    )
    result = tool_loop(model, "sys", [Message(role="user", text="go")], tools, 6)
    assert result.reply == "Done."
    tool_texts = [m.text for call_ in model.calls for m in call_["messages"] if m.role == "tool"]
    assert json.loads(tool_texts[0])["error"] == "question 2 has 1 option; give 2 to 6"
    assert "Saved. Reply with one short sentence" in tool_texts[-1]
    assert sink.content is not None and len(sink.content.questions) == 3  # type: ignore[union-attr]
    assert result.surfaces == []


def test_make_lesson_validates_and_fills_the_sink(client: TestClient, session: Session) -> None:
    sink = ContentSink("lesson")
    tools = make_tools(client, session, agent_id="a2ui", content_sink=sink)
    short = {"title": "L", "sections": []}
    assert "has 0 sections" in json.loads(tools.run("make_lesson", short).result)["error"]
    assert sink.content is None
    good = {
        "title": "Containers",
        "sections": [
            {"kind": "concept", "heading": "A", "body": "text"},
            {"kind": "tip", "heading": "B", "body": "text"},
            {"kind": "check", "heading": "C", "question": question()},
        ],
    }
    outcome = tools.run("make_lesson", good)
    assert "error" not in json.loads(outcome.result) and sink.content is not None


# --- results and the MCP server ------------------------------------------------------------


def test_surfaces_survive_a_fallback_handover_without_duplicates() -> None:
    other = {"id": "s-2", "kind": "lesson", "title": "L", "messages": []}
    before = AgentResult(reply="", surfaces=[SURFACE])
    after = AgentResult(reply="ok", surfaces=[SURFACE, other])
    assert merged(before, after).surfaces == [SURFACE, other]
    assert merged(AgentResult(reply=""), after).surfaces == [SURFACE, other]
    assert merged(before, AgentResult(reply="ok")).surfaces == [SURFACE]


def test_the_mcp_server_does_not_expose_the_interactive_tools() -> None:
    def run(name: str, arguments: dict[str, Any]) -> Any:
        raise AssertionError("no call")

    listed = {t["name"] for t in McpServer(run, None, lambda: True).tools_list()["tools"]}
    assert "save_learned_note" in listed and NEW_TOOLS.isdisjoint(listed)
