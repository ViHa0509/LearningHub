"""Spec: a2ui-chat - The assistant hands interactive requests over (through the chat route),
Surfaces carry no answers, Stored chats keep their surfaces.

The assistant and the Interactive tutor run on two providers, each a scripted fake."""

import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.agent.llm.errors import ProviderError
from app.agent.messages import ToolCall, Turn
from app.db import A2uiSurface
from tests.agent_fakes import FakeFactory
from tests.test_a2ui_actions import act
from tests.test_agent_providers_api import add, add_local, assign

SECRET = "SECRET-EXPLANATION"
QUIZ = {
    "title": "Docker networking",
    "questions": [
        {
            "text": f"Question {n}?",
            "options": ["bridge", "host", "none"],
            "answer": 2,
            "explanation": f"{SECRET} {n}.",
        }
        for n in range(1, 4)
    ],
}


def call(name: str, **args: Any) -> ToolCall:
    return ToolCall(id=f"id-{name}", name=name, input=args)


def ask_for_a_quiz() -> Turn:
    return Turn(
        text="", tool_calls=[call("show_interactive", kind="quiz", topic="docker networking")]
    )


def setup(
    client: TestClient, assistant: list[Turn | Exception], tutor: list[Turn | Exception]
) -> FakeFactory:
    factory = FakeFactory(Turn("default answer"))
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    claude = add(client, "Claude main")
    local = add_local(client)
    factory.script("Claude main", *assistant)
    factory.script("Local qwen", *tutor)
    assign(client, "assistant", claude)
    assign(client, "a2ui", local)
    return factory


def chat(client: TestClient, text: str = "quiz me on docker networking", **extra: Any) -> Any:
    return client.post(
        "/api/agent/chat", json={"messages": [{"role": "user", "content": text}], **extra}
    )


def surface_rows(client: TestClient) -> list[A2uiSurface]:
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        rows = list(db.scalars(select(A2uiSurface)))
        db.expunge_all()
        return rows


def quiz_turns() -> tuple[list[Turn | Exception], list[Turn | Exception]]:
    return (
        [ask_for_a_quiz(), Turn("Here is a quiz.")],
        [Turn(text="", tool_calls=[call("make_quiz", **QUIZ)]), Turn("Done.")],
    )


def test_a_chat_answer_holds_the_text_and_one_surface_without_answers(
    client: TestClient,
) -> None:
    assistant, tutor = quiz_turns()
    setup(client, assistant, tutor)
    response = chat(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reply"] == "Here is a quiz."
    assert [s["tool"] for s in body["steps"]] == ["show_interactive"]
    assert len(body["surfaces"]) == 1
    surface = body["surfaces"][0]
    assert surface["kind"] == "quiz" and surface["title"] == "Docker networking"
    assert [next(k for k in m if k != "version") for m in surface["messages"]] == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert SECRET not in response.text and "explanation" not in json.dumps(surface)
    # The row is owned by the user and linked to the stored assistant message.
    (row,) = surface_rows(client)
    assert str(row.id) == surface["id"] and str(row.message_id) == body["assistant_message_id"]
    assert row.answer_key["q1"]["answer"] == 2 and row.answers == {}


def test_a_chat_without_a_surface_has_an_empty_list(client: TestClient) -> None:
    setup(client, [Turn("Just text.")], [])
    body = chat(client, "hello").json()
    assert body["surfaces"] == [] and surface_rows(client) == []


def test_a_failed_request_leaves_no_surface_row(client: TestClient) -> None:
    assistant: list[Turn | Exception] = [ask_for_a_quiz(), ProviderError("down", "network")]
    _, tutor = quiz_turns()
    setup(client, assistant, tutor)
    response = chat(client)
    assert response.status_code == 502
    assert surface_rows(client) == []


def test_the_stored_detail_replays_the_answers_given(client: TestClient) -> None:
    assistant, tutor = quiz_turns()
    setup(client, assistant, tutor)
    body = chat(client).json()
    surface_id = body["surfaces"][0]["id"]
    detail = client.get(f"/api/agent/sessions/{body['session']['id']}").json()
    user_message, answer = detail["messages"]
    assert user_message["surfaces"] == []
    assert len(answer["surfaces"]) == 1 and len(answer["surfaces"][0]["messages"]) == 3
    # Answer question 1 wrong (option 1; the key says 2): the detail then replays the result.
    assert act(client, surface_id, "q1", ("1",)).status_code == 200
    detail = client.get(f"/api/agent/sessions/{body['session']['id']}").json()
    messages = detail["messages"][1]["surfaces"][0]["messages"]
    assert len(messages) == 8
    updates = {m["updateDataModel"]["path"]: m["updateDataModel"]["value"] for m in messages[3:]}
    assert updates["/questions/q1/status"] == "wrong"
    assert updates["/questions/q1/feedback"].startswith('Not quite. The answer is "host".')
    assert updates["/score/text"] == "1 / 3 answered, 0 correct"
    assert updates["/questions/q1/mark"] == "✗ Not quite"
    assert updates["/questions/q1/options/1/label"] == "host ✓"
    # The first three messages still hold no answer.
    assert SECRET not in json.dumps(messages[:3])


def test_retry_removes_the_later_surfaces(client: TestClient) -> None:
    assistant, tutor = quiz_turns()
    setup(client, [*assistant, Turn("Plain answer.")], tutor)
    body = chat(client).json()
    assert len(surface_rows(client)) == 1
    retried = client.post(
        "/api/agent/chat",
        json={
            "messages": [{"role": "user", "content": "just explain it"}],
            "session_id": body["session"]["id"],
            "retry_from": body["user_message_id"],
        },
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["reply"] == "Plain answer." and retried.json()["surfaces"] == []
    assert surface_rows(client) == []


def test_deleting_the_chat_removes_its_surfaces(client: TestClient) -> None:
    assistant, tutor = quiz_turns()
    setup(client, assistant, tutor)
    body = chat(client).json()
    assert len(surface_rows(client)) == 1
    assert client.delete(f"/api/agent/sessions/{body['session']['id']}").status_code == 204
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(A2uiSurface)) == 0
    assert act(client, body["surfaces"][0]["id"], "q1", ("1",)).status_code == 404


# --- Spec: One request, one count (shared mode) -------------------------------------------


def test_a_shared_quiz_request_takes_one_count_and_one_slot_and_grading_none(
    client: TestClient, second_client: TestClient
) -> None:
    from app.agent.ratelimit import RateLimiter
    from app.agent.resolve import utc_today
    from tests.conftest import MEMBER_EMAIL
    from tests.test_shared_providers import add_shared, set_usage, status

    factory = FakeFactory(Turn("default answer"))
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    client.app.state.rate_limiter = RateLimiter(2)  # type: ignore[attr-defined]
    add_shared(client)
    # The tutor follows the assistant's configuration, so one scripted model serves both.
    factory.script(
        "Claude main",
        ask_for_a_quiz(),
        Turn(text="", tool_calls=[call("make_quiz", **QUIZ)]),
        Turn("Done."),
        Turn("Here is a quiz."),
        Turn("second chat"),
    )
    set_usage(client, MEMBER_EMAIL, utc_today(), 3)
    response = chat(second_client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["surfaces"]) == 1
    assert status(second_client)["used_today"] == 4
    for question in ("q1", "q2", "q3"):
        assert act(second_client, body["surfaces"][0]["id"], question, ("1",)).status_code == 200
    assert status(second_client)["used_today"] == 4
    # One per-minute slot was used by the quiz request: a second chat fits, a third does not.
    assert chat(second_client, "again").status_code == 200
    assert status(second_client)["used_today"] == 5
    assert chat(second_client, "once more").status_code == 429
