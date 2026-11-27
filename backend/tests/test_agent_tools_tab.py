"""Spec: agent-settings (Add and remove an agent's tools, A removed tool is not offered, Agent
tool choices are the user's own data)."""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agent.mcp_server import McpServer
from app.agent.messages import Turn
from app.routes.agents import effective_tools
from tests.conftest import user_id_of
from tests.test_a2ui_chat import QUIZ, ask_for_a_quiz, call, setup
from tests.test_a2ui_chat import chat as a2ui_chat
from tests.test_agent_chat import LESSON_PAGE, chat, save_area, use

H = {"X-LearningHub": "1"}
ASSISTANT_TOOLS = [
    "search_notes",
    "read_note",
    "list_roadmap",
    "read_lesson",
    "write_lesson",
    "list_node_resources",
    "fetch_reference",
    "save_learned_note",
    "show_interactive",
    "roadmapsh_list",
    "roadmapsh_outline",
    "roadmapsh_topic",
]
WRITER_TOOLS = ASSISTANT_TOOLS[:7]
TUTOR_TOOLS = ["search_notes", "read_note", "list_roadmap", "read_lesson"]


def put(client: TestClient, agent: str, attached: list[str]) -> Any:
    return client.put(f"/api/agents/{agent}/tools", json={"attached": attached}, headers=H)


def offered(model: Any, index: int = 0) -> set[str]:
    return {s.name for s in model.calls[index]["tools"]}


# Scenario: All attached by default; Remove and save; Add back
def test_defaults_remove_and_add_back(client: TestClient) -> None:
    body = client.get("/api/agents/assistant/tools").json()
    assert body == {"agent_id": "assistant", "attached": ASSISTANT_TOOLS, "available": []}
    kept = [n for n in ASSISTANT_TOOLS if n != "write_lesson"]
    body = put(client, "assistant", kept).json()
    assert body["attached"] == kept and body["available"] == ["write_lesson"]
    assert client.get("/api/agents/assistant/tools").json() == body
    assert put(client, "assistant", ASSISTANT_TOOLS).json()["available"] == []
    assert client.get("/api/agents/lesson-writer/tools").json()["attached"] == WRITER_TOOLS
    assert client.get("/api/agents/a2ui/tools").json()["attached"] == TUTOR_TOOLS


# Scenario: Only the agent's own tools
def test_a_tool_of_another_agent_is_refused_and_nothing_changes(client: TestClient) -> None:
    for extra in ("save_learned_note", "propose_topics", "nope"):
        assert put(client, "lesson-writer", ["read_note", extra]).status_code == 422
    assert client.get("/api/agents/lesson-writer/tools").json()["attached"] == WRITER_TOOLS


def test_tools_of_a2ui_are_in_the_catalog(client: TestClient) -> None:
    agents = {t["name"]: t["agents"] for t in client.get("/api/agents/tools").json()}
    for name in TUTOR_TOOLS:
        assert "a2ui" in agents[name]
    assert "a2ui" not in agents["write_lesson"]


@pytest.mark.parametrize("agent", ["note-sorter", "no-such"])
def test_agent_without_tools_or_unknown_is_404(client: TestClient, agent: str) -> None:
    assert client.get(f"/api/agents/{agent}/tools").status_code == 404
    assert put(client, agent, []).status_code == 404


def test_put_needs_the_app_header(client: TestClient) -> None:
    response = client.put(
        "/api/agents/assistant/tools", json={"attached": []}, headers={"X-LearningHub": ""}
    )
    assert response.status_code in (400, 403)
    assert client.get("/api/agents/assistant/tools").json()["attached"] == ASSISTANT_TOOLS


# Scenario: Another user
def test_tool_choices_are_the_users_own(client: TestClient, second_client: TestClient) -> None:
    put(client, "assistant", ["read_note"])
    assert second_client.get("/api/agents/assistant/tools").json()["attached"] == ASSISTANT_TOOLS
    fake = use(second_client, Turn("ok"))
    assert chat(second_client, "hi").status_code == 200
    assert "write_lesson" in offered(fake)


# Scenario: Removed from the assistant
def test_removed_tool_is_not_offered_and_refused(client: TestClient) -> None:
    put(client, "assistant", [n for n in ASSISTANT_TOOLS if n != "search_notes"])
    fake = use(client, Turn("Trying.", (call("search_notes", query="x"),)), Turn("No."), Turn("ok"))
    assert chat(client, "find").status_code == 200
    assert "search_notes" not in offered(fake)
    assert "not available" in fake.calls[1]["messages"][-1].text
    # The Lesson writer is still offered it.
    writer = {"agent_id": "lesson-writer", "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/api/agent/chat", json=writer).status_code == 200
    assert "search_notes" in offered(fake, 2)


# Scenario: Both layers
def test_removed_and_unticked_tools_are_both_left_out(client: TestClient) -> None:
    put(client, "assistant", [n for n in ASSISTANT_TOOLS if n != "read_note"])
    save_area(client, "backend", tools=["read_note", "write_lesson", "search_notes"])
    fake = use(client, Turn("ok"))
    assert chat(client, "hi", LESSON_PAGE).status_code == 200
    assert offered(fake) == {"write_lesson", "search_notes"}


# Scenario: Claude Code provider
def test_effective_set_reaches_the_mcp_list(client: TestClient) -> None:
    put(client, "assistant", [n for n in ASSISTANT_TOOLS if n != "read_note"])
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        allowed = effective_tools(db, user_id_of(app), "assistant", None)
        assert allowed is not None and "read_note" not in allowed
        assert effective_tools(db, user_id_of(app), "outline", None) is None
    listed = {t["name"] for t in McpServer(lambda *_: None, allowed).tools_list()["tools"]}  # type: ignore[arg-type,return-value]
    assert "read_note" not in listed and "search_notes" in listed


# Scenario: Interactive tutor keeps its output
def test_tutor_keeps_its_content_tool_when_every_tool_is_removed(client: TestClient) -> None:
    assert put(client, "a2ui", []).json()["attached"] == []
    factory = setup(
        client,
        [ask_for_a_quiz(), Turn("Here is a quiz.")],
        [Turn(text="", tool_calls=[call("read_note", note_id="x")]), Turn("Done.")],
    )
    tutor = factory.by_name["Local qwen"]
    tutor._turns.insert(0, Turn(text="", tool_calls=[call("make_quiz", **QUIZ)]))
    response = a2ui_chat(client)
    assert response.status_code == 200, response.text
    assert offered(tutor) == {"make_quiz"}
    assert len(response.json()["surfaces"]) == 1
