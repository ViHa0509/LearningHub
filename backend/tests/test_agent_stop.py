"""Spec: agent-chat (change agent-stop) - the run row, the stop route and the stop checks of the
tool loop, the Claude Code runner and the Interactive tutor."""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.a2ui.interface import ContentSink, InteractiveRequest
from app.a2ui.runner import ChatInteractiveRunner
from app.agent.llm import claude_code
from app.agent.llm.errors import ProviderError
from app.agent.loop import Page, tool_loop
from app.agent.messages import Message, ToolCall, Turn
from app.agent.stop import STOPPED_BY_USER, request_stop, throttled
from app.agent.tools import AgentTools
from app.db import A2uiSurface, AgentRun, User
from tests.agent_fakes import FakeModel
from tests.claude_code_fakes import ReplayRunner, fixture_lines
from tests.conftest import MEMBER_EMAIL, user_id_of
from tests.test_a2ui_runner import QUIZ, StubModel
from tests.test_agent_chat import use
from tests.test_claude_code import agent as claude_agent


def call(name: str, **args: Any) -> ToolCall:
    return ToolCall(id=f"id-{name}-{len(args)}", name=name, input=args)


def chat(client: TestClient, run_id: uuid.UUID | None = None) -> Any:
    body: dict[str, Any] = {"messages": [{"role": "user", "content": "hi"}]}
    if run_id is not None:
        body["run_id"] = str(run_id)
    return client.post("/api/agent/chat", json=body)


def rows(client: TestClient) -> dict[uuid.UUID, AgentRun]:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        return {r.id: r for r in db.scalars(select(AgentRun))}


def add_run(client: TestClient, user_id: Any, **values: Any) -> uuid.UUID:
    run_id = uuid.uuid4()
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        db.add(AgentRun(id=run_id, user_id=user_id, **values))
        db.commit()
    return run_id


def stop_url(run_id: uuid.UUID) -> str:
    return f"/api/agent/runs/{run_id}/stop"


# --- 1.2 the run row and the stop route -----------------------------------------------------


def test_run_row_exists_only_while_the_answer_runs(client: TestClient) -> None:
    seen: list[int] = []
    model = use(client, Turn("done"))
    original = model.complete

    def spy(*args: Any) -> Turn:
        seen.append(len(rows(client)))
        return original(*args)

    model.complete = spy  # type: ignore[method-assign]
    assert chat(client, uuid.uuid4()).status_code == 200
    assert seen == [1]
    assert rows(client) == {}


def test_run_row_is_removed_after_a_provider_error(client: TestClient) -> None:
    use(client, ProviderError("down", "unavailable"))
    assert chat(client, uuid.uuid4()).status_code == 502
    assert rows(client) == {}


def test_chat_without_run_id_makes_no_row(client: TestClient) -> None:
    use(client, Turn("done"))
    assert chat(client).status_code == 200
    assert rows(client) == {}


def test_stale_rows_of_the_user_are_removed_on_a_new_run(
    client: TestClient, second_client: TestClient
) -> None:
    admin, member = user_id_of(client.app), user_id_of(client.app, MEMBER_EMAIL)
    old = datetime.now(UTC) - timedelta(hours=2)
    stale = add_run(client, admin, started_at=old)
    fresh = add_run(client, admin)
    others_stale = add_run(client, member, started_at=old)
    use(client, Turn("done"))
    assert chat(client, uuid.uuid4()).status_code == 200
    assert set(rows(client)) == {fresh, others_stale}
    assert stale not in rows(client)


def test_a_run_id_in_use_answers_409_and_keeps_the_row(client: TestClient) -> None:
    taken = add_run(client, user_id_of(client.app))
    use(client, Turn("done"))
    response = chat(client, taken)
    assert response.status_code == 409
    assert set(rows(client)) == {taken}


def test_stop_marks_own_running_run(client: TestClient) -> None:
    run_id = add_run(client, user_id_of(client.app))
    assert client.post(stop_url(run_id)).status_code == 204
    assert rows(client)[run_id].stop_requested_at is not None


def test_stop_of_unknown_or_ended_run_is_204(client: TestClient) -> None:
    assert client.post(stop_url(uuid.uuid4())).status_code == 204
    use(client, Turn("done"))
    run_id = uuid.uuid4()
    assert chat(client, run_id).status_code == 200
    assert client.post(stop_url(run_id)).status_code == 204
    assert rows(client) == {}


def test_another_users_stop_changes_nothing(client: TestClient, second_client: TestClient) -> None:
    run_id = add_run(client, user_id_of(client.app))
    assert second_client.post(stop_url(run_id)).status_code == 204
    assert rows(client)[run_id].stop_requested_at is None
    unknown = second_client.post(stop_url(uuid.uuid4()))
    assert unknown.status_code == 204 and unknown.content == b""


def test_stop_needs_the_app_header_and_a_session(client: TestClient) -> None:
    run_id = add_run(client, user_id_of(client.app))
    refused = client.post(stop_url(run_id), headers={"X-LearningHub": "0"})
    assert refused.status_code == 403
    assert rows(client)[run_id].stop_requested_at is None
    with TestClient(client.app, headers={"X-LearningHub": "1"}) as anonymous:
        assert anonymous.post(stop_url(run_id)).status_code == 401
    assert rows(client)[run_id].stop_requested_at is None


# --- 1.3 the tool loop -----------------------------------------------------------------------


def test_stop_during_the_first_tool_call_runs_only_that_call(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = use(
        client,
        Turn("", (call("list_roadmap", domain="backend"), call("list_roadmap", domain="other"))),
        Turn("never reached"),
    )
    run_id = uuid.uuid4()
    original = AgentTools.run
    ran: list[str] = []

    def run_then_stop(self: AgentTools, name: str, args: dict[str, Any]) -> Any:
        outcome = original(self, name, args)
        ran.append(name)
        with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
            request_stop(db, self.user_id, run_id)
        return outcome

    monkeypatch.setattr(AgentTools, "run", run_then_stop)
    response = chat(client, run_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["stopped"], body["reply"]) == (True, STOPPED_BY_USER)
    assert [s["tool"] for s in body["steps"]] == ["list_roadmap"] and len(ran) == 1
    assert len(model.calls) == 1
    assert rows(client) == {}
    session_id = body["session"]["id"]
    stored = client.get(f"/api/agent/sessions/{session_id}").json()
    last = stored["messages"][-1]
    assert (last["stopped"], last["content"], len(last["steps"])) == (True, STOPPED_BY_USER, 1)


def test_stop_before_the_first_model_call_makes_no_call(client: TestClient) -> None:
    model = use(client, Turn("never"))
    run_id = uuid.uuid4()
    original = request_stop
    # The row exists only inside the request, so the stop is set when the route builds the check.
    import app.routes.agent as route

    def start_stopped(factory: Any, user_id: Any, rid: uuid.UUID) -> None:
        route_start(factory, user_id, rid)
        with factory() as db:
            original(db, user_id, rid)

    route_start = route.start_run
    route.start_run = start_stopped  # type: ignore[assignment]
    try:
        body = chat(client, run_id).json()
    finally:
        route.start_run = route_start  # type: ignore[assignment]
    assert (body["stopped"], body["reply"], body["steps"]) == (True, STOPPED_BY_USER, [])
    assert model.calls == []


def test_loop_without_a_stop_check_runs_as_before(client: TestClient) -> None:
    model = FakeModel([Turn("", (call("list_roadmap", domain="backend"),)), Turn("all done")])
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        tools = AgentTools(db, client.app.state.catalog, user_id=user_id_of(client.app))  # type: ignore[attr-defined]
        result = tool_loop(model, "system", [Message(role="user", text="hi")], tools, 5)  # type: ignore[arg-type]
    assert (result.reply, result.stopped, len(result.steps)) == ("all done", False, 1)


# --- 1.4 Claude Code, throttle, tutor --------------------------------------------------------


def test_claude_code_stops_reading_and_reports_the_steps_so_far(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(claude_code, "throttled", lambda check: check)
    runner = ReplayRunner(fixture_lines("answer_from_notes.jsonl", note_id="n1"))
    tools = SimpleNamespace(
        user_id=None, allowed=None, should_stop=lambda: runner.read >= 5
    )  # the first tool call and its result were read
    model = claude_agent(runner)
    result = model.run("system", [Message(role="user", text="q")], tools, 6)  # type: ignore[arg-type]
    assert (result.stopped, result.reply) == (True, STOPPED_BY_USER)
    assert [s.tool for s in result.steps] == ["search_notes"]
    assert runner.read == 5  # on_line answered False at line 5: the runner kills the tree


def test_claude_code_not_stopped_when_the_check_stays_false() -> None:
    runner = ReplayRunner(fixture_lines("answer_from_notes.jsonl", note_id="n1"))
    result = claude_agent(runner).run("system", [Message(role="user", text="q")], None, 6)
    assert result.stopped is False and result.reply != STOPPED_BY_USER


def test_throttled_calls_the_real_check_once_per_interval() -> None:
    now = [100.0]
    calls: list[float] = []

    def check() -> bool:
        calls.append(now[0])
        return len(calls) >= 3

    wrapped = throttled(check, every=1.0, clock=lambda: now[0])
    results = []
    for tick in (0.0, 0.2, 0.9, 1.0, 1.5, 2.0, 2.1, 3.0):
        now[0] = 100.0 + tick
        results.append(wrapped())
    assert calls == [100.0, 101.0, 102.0]
    assert results == [False, False, False, False, False, True, True, True]


def test_stopped_tutor_fails_and_stores_no_surface(client: TestClient) -> None:
    app: Any = client.app
    model = StubModel(Turn(text="", tool_calls=(call("make_quiz", **QUIZ),)), Turn(text="Done."))
    with app.state.session_factory() as db:
        user = db.scalars(select(User).where(User.role == "admin")).one()
        sinks: list[ContentSink] = []

        def tools_for(sink: ContentSink) -> AgentTools:
            sinks.append(sink)
            # The user presses Stop while the tutor's quiz is being made.
            return AgentTools(
                db,
                app.state.catalog,
                user_id=user.id,
                agent_id="a2ui",
                content_sink=sink,
                should_stop=lambda: sink.content is not None,
            )

        runner = ChatInteractiveRunner(
            db, user, app.state.catalog, Page(), None, lambda: model, tools_for
        )
        result = runner(InteractiveRequest(kind="quiz", topic="docker networking"))
        assert sinks[0].content is not None  # the quiz was made, yet it is dropped
        assert result.error is not None and result.surface is None
        assert runner.made == []
        db.commit()
        assert db.scalars(select(A2uiSurface)).all() == []


# Scenario: A lesson written before the stop stays
def test_a_lesson_written_before_the_stop_stays(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = use(
        client,
        Turn(
            "", (call("write_lesson", node_id="backend/graphql", markdown="# GraphQL\n- schema"),)
        ),
        Turn("never reached"),
    )
    run_id = uuid.uuid4()
    original = AgentTools.run

    def run_then_stop(self: AgentTools, name: str, args: dict[str, Any]) -> Any:
        outcome = original(self, name, args)
        with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
            request_stop(db, self.user_id, run_id)
        return outcome

    monkeypatch.setattr(AgentTools, "run", run_then_stop)
    body = chat(client, run_id).json()
    assert (body["stopped"], body["reply"]) == (True, STOPPED_BY_USER)
    assert [s["tool"] for s in body["steps"]] == ["write_lesson"]
    assert body["changed_lessons"] == ["backend/graphql"]
    assert len(model.calls) == 1
    lesson = client.get("/api/lessons/backend/graphql").json()
    assert lesson["body"] == "# GraphQL\n- schema"
