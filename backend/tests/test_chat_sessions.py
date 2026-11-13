"""Spec: chat-history - chats are saved as sessions, continued, retried, listed, renamed,
deleted, and kept separate per user."""

import uuid
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.agent.messages import ProviderError, ToolCall, Turn
from app.db import ChatMessage, ChatSession, User
from tests.agent_fakes import FakeModel
from tests.conftest import MEMBER_EMAIL
from tests.test_agent_chat import use

MISSING = "00000000-0000-0000-0000-000000000000"
NOT_FOUND = {"detail": "chat session not found"}


def send(client: TestClient, text: str, **extra: Any) -> Any:
    message = {"role": "user", "content": text}
    if "display" in extra:
        message["display"] = extra.pop("display")
    return client.post("/api/agent/chat", json={"messages": [message], **extra})


def sessions(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/agent/sessions")
    assert response.status_code == 200, response.text
    return list(response.json()["sessions"])


def read(client: TestClient, session_id: str) -> dict[str, Any]:
    response = client.get(f"/api/agent/sessions/{session_id}")
    assert response.status_code == 200, response.text
    return dict(response.json())


def texts(fake: FakeModel, call: int = -1) -> list[tuple[str, str]]:
    return [(m.role, m.text) for m in fake.calls[call]["messages"]]


def one_turn(client: TestClient, question: str = "what is JWT?") -> dict[str, Any]:
    answer = send(client, question)
    assert answer.status_code == 200, answer.text
    return dict(answer.json())


# --- Chats are saved as sessions -------------------------------------------------


def test_first_message_creates_a_session(client: TestClient) -> None:
    use(client, Turn("You noted allkeys-lru."))
    question = "what did I learn about redis eviction?"
    body = one_turn(client, question)
    assert body["session"]["title"] == question
    stored = read(client, body["session"]["id"])
    assert [(m["role"], m["content"]) for m in stored["messages"]] == [
        ("user", question),
        ("assistant", "You noted allkeys-lru."),
    ]
    assert [m["id"] for m in stored["messages"]] == [
        body["user_message_id"],
        body["assistant_message_id"],
    ]
    assert stored["message_count"] == 2


def test_title_is_cut_to_60_characters_with_whitespace_collapsed(client: TestClient) -> None:
    use(client, Turn("ok"))
    body = one_turn(client, "  a   long\n" + "x" * 100)
    assert body["session"]["title"] == ("a long " + "x" * 100)[:60]


def test_failed_request_stores_nothing(client: TestClient) -> None:
    use(client, ProviderError("invalid x-api-key", "auth_failed"))
    assert send(client, "hello").status_code == 502
    assert sessions(client) == []


def test_message_with_only_files_is_titled_new_chat(client: TestClient) -> None:
    use(client, Turn("It is about JWT."))
    answer = send(
        client,
        "(see the attached files)",
        display="",
        attachments=[{"name": "jwt.md", "text": "SECRET-FILE-TEXT about tokens"}],
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["session"]["title"] == "New chat"


# --- A stored message keeps what the panel shows ---------------------------------


def test_answer_details_are_kept(client: TestClient) -> None:
    use(
        client,
        Turn("", (ToolCall(id="1", name="search_notes", input={"query": "jwt"}),)),
        Turn("", (ToolCall(id="2", name="list_roadmap", input={"domain": "backend"}),)),
        Turn("Done."),
    )
    answer = send(client, "find jwt", effort="high")
    assert answer.status_code == 200, answer.text
    question, reply = read(client, answer.json()["session"]["id"])["messages"]
    assert [s["tool"] for s in reply["steps"]] == ["search_notes", "list_roadmap"]
    assert reply["steps"][0]["input"] == {"query": "jwt"}
    assert reply["steps"] == answer.json()["steps"]
    assert reply["provider"] == {"name": "Claude main", "model": "claude-sonnet-5-5"}
    assert reply["effort"] == "high"
    assert reply["fallback_used"] is False
    assert reply["stopped"] is False
    assert reply["display"] is None
    assert question["agent_id"] == "assistant"
    assert question["provider"] is None


def test_skill_message_keeps_what_was_typed_and_what_was_sent(client: TestClient) -> None:
    fake = use(client, Turn("Question 1"))
    sent = "Quiz me on this topic: JWT"
    answer = send(client, sent, display="/quiz JWT")
    question = read(client, answer.json()["session"]["id"])["messages"][0]
    assert question["display"] == "/quiz JWT"
    assert question["content"] == sent
    assert answer.json()["session"]["title"] == "/quiz JWT"
    # The typed text is stored, never sent to the model.
    assert texts(fake)[-1] == ("user", sent) or sent in texts(fake)[-1][1]
    assert all("/quiz JWT" not in text for _, text in texts(fake))


def test_attachment_text_is_not_kept(client: TestClient) -> None:
    use(client, Turn("It is about JWT."))
    answer = send(
        client,
        "summarise the file",
        attachments=[{"name": "jwt.md", "text": "SECRET-FILE-TEXT about tokens"}],
    )
    assert answer.status_code == 200, answer.text
    session_id = answer.json()["session"]["id"]
    assert read(client, session_id)["messages"][0]["attachments"] == ["jwt.md"]
    assert "SECRET-FILE-TEXT" not in client.get(f"/api/agent/sessions/{session_id}").text
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        for row in db.scalars(select(ChatMessage)):
            assert "SECRET-FILE-TEXT" not in row.content
            assert "SECRET-FILE-TEXT" not in (row.display or "")


# --- Continue a session ----------------------------------------------------------


def test_follow_up_uses_the_stored_history(client: TestClient) -> None:
    fake = use(client, Turn("A signed token."), Turn("Through the exp claim."))
    first = one_turn(client)
    session_id = first["session"]["id"]
    answer = send(client, "and how does it expire?", session_id=session_id)
    assert answer.status_code == 200, answer.text
    assert answer.json()["session"] == first["session"]
    assert texts(fake) == [
        ("user", "what is JWT?"),
        ("assistant", "A signed token."),
        ("user", "and how does it expire?"),
    ]
    stored = read(client, session_id)
    assert [m["content"] for m in stored["messages"]] == [
        "what is JWT?",
        "A signed token.",
        "and how does it expire?",
        "Through the exp claim.",
    ]
    assert stored["message_count"] == 4
    assert len(sessions(client)) == 1


def test_unknown_session_is_not_found_and_calls_no_model(client: TestClient) -> None:
    fake = use(client, Turn("never"))
    answer = send(client, "hello", session_id=MISSING)
    assert answer.status_code == 404
    assert answer.json() == NOT_FOUND
    assert fake.calls == []


def test_history_sent_with_a_session_is_refused(client: TestClient) -> None:
    fake = use(client, Turn("A signed token."), Turn("never"))
    session_id = one_turn(client)["session"]["id"]
    payload = {
        "session_id": session_id,
        "messages": [
            {"role": "user", "content": "a"},
            {"role": "assistant", "content": "b"},
            {"role": "user", "content": "c"},
        ],
    }
    assert client.post("/api/agent/chat", json=payload).status_code == 400
    assert len(fake.calls) == 1
    assert read(client, session_id)["message_count"] == 2


def test_stateless_request_with_history_stores_all_of_it(client: TestClient) -> None:
    fake = use(client, Turn("Through the exp claim."))
    payload = {
        "messages": [
            {"role": "user", "content": "what is JWT?"},
            {"role": "assistant", "content": "A signed token."},
            {"role": "user", "content": "and how does it expire?"},
        ]
    }
    answer = client.post("/api/agent/chat", json=payload)
    assert answer.status_code == 200, answer.text
    assert len(texts(fake)) == 3
    stored = read(client, answer.json()["session"]["id"])
    assert [m["role"] for m in stored["messages"]] == ["user", "assistant", "user", "assistant"]
    assert stored["title"] == "what is JWT?"
    assert stored["messages"][2]["id"] == answer.json()["user_message_id"]


# --- Retry replaces the turn in the session --------------------------------------


def test_retry_an_answer_replaces_the_turn_and_what_follows(client: TestClient) -> None:
    fake = use(client, Turn("one"), Turn("two"), Turn("one again"))
    first = one_turn(client, "first?")
    session_id = first["session"]["id"]
    assert send(client, "second?", session_id=session_id).status_code == 200
    answer = send(client, "first?", session_id=session_id, retry_from=first["user_message_id"])
    assert answer.status_code == 200, answer.text
    assert texts(fake) == [("user", "first?")]
    stored = read(client, session_id)
    assert [m["content"] for m in stored["messages"]] == ["first?", "one again"]
    assert stored["messages"][0]["id"] == answer.json()["user_message_id"]


def test_failed_retry_keeps_the_session(client: TestClient) -> None:
    use(client, Turn("one"), ProviderError("overloaded", "unavailable"))
    first = one_turn(client, "first?")
    session_id = first["session"]["id"]
    answer = send(client, "first?", session_id=session_id, retry_from=first["user_message_id"])
    assert answer.status_code == 502
    assert [m["content"] for m in read(client, session_id)["messages"]] == ["first?", "one"]


def test_retry_from_must_be_a_user_message_of_that_session(client: TestClient) -> None:
    fake = use(client, Turn("one"), Turn("other"), Turn("never"))
    first = one_turn(client, "first?")
    other = one_turn(client, "other?")
    session_id = first["session"]["id"]
    for message_id in (first["assistant_message_id"], other["user_message_id"], MISSING):
        answer = send(client, "first?", session_id=session_id, retry_from=message_id)
        assert answer.status_code == 404, message_id
    assert send(client, "first?", retry_from=first["user_message_id"]).status_code == 400
    assert len(fake.calls) == 2
    assert read(client, session_id)["message_count"] == 2


# --- List, read, rename and delete sessions --------------------------------------


def test_list_is_ordered_by_the_last_message(client: TestClient) -> None:
    use(client, Turn("a1"), Turn("b1"), Turn("a2"))
    a = one_turn(client, "A")["session"]["id"]
    b = one_turn(client, "B")["session"]["id"]
    assert [s["title"] for s in sessions(client)] == ["B", "A"]
    assert send(client, "more", session_id=a).status_code == 200
    listed = sessions(client)
    assert [(s["id"], s["message_count"]) for s in listed] == [(a, 4), (b, 2)]
    assert client.get("/api/agent/sessions").json()["total"] == 2
    assert [
        s["id"] for s in client.get("/api/agent/sessions?limit=1&offset=1").json()["sessions"]
    ] == [b]
    assert client.get("/api/agent/sessions?limit=0").status_code == 422


def test_rename_keeps_the_place_in_the_list(client: TestClient) -> None:
    use(client, Turn("a1"), Turn("b1"))
    a = one_turn(client, "A")["session"]["id"]
    one_turn(client, "B")
    before = sessions(client)
    response = client.patch(f"/api/agent/sessions/{a}", json={"title": "  JWT expiry  "})
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "JWT expiry"
    assert response.json()["message_count"] == 2
    after = sessions(client)
    assert [s["title"] for s in after] == ["B", "JWT expiry"]
    assert [s["last_message_at"] for s in after] == [s["last_message_at"] for s in before]


def test_rename_refuses_an_empty_or_too_long_title(client: TestClient) -> None:
    use(client, Turn("a1"))
    a = one_turn(client, "A")["session"]["id"]
    for title in ("   ", "", "x" * 121):
        assert client.patch(f"/api/agent/sessions/{a}", json={"title": title}).status_code == 422
    assert client.patch(f"/api/agent/sessions/{a}", json={"title": "x" * 120}).status_code == 200
    assert client.patch(f"/api/agent/sessions/{MISSING}", json={"title": "x"}).json() == NOT_FOUND


def test_delete_removes_the_session_and_its_messages(client: TestClient) -> None:
    use(client, Turn("a1"))
    a = one_turn(client, "A")["session"]["id"]
    assert client.delete(f"/api/agent/sessions/{a}").status_code == 204
    assert sessions(client) == []
    missing = client.get(f"/api/agent/sessions/{a}")
    assert missing.status_code == 404
    assert missing.json() == NOT_FOUND
    assert client.delete(f"/api/agent/sessions/{a}").status_code == 404
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        assert db.scalars(select(ChatMessage)).all() == []


def test_changing_a_session_needs_the_app_header(client: TestClient) -> None:
    use(client, Turn("a1"))
    a = one_turn(client, "A")["session"]["id"]
    bare = {"X-LearningHub": ""}
    assert (
        client.patch(f"/api/agent/sessions/{a}", json={"title": "x"}, headers=bare).status_code
        == 403
    )
    assert client.delete(f"/api/agent/sessions/{a}", headers=bare).status_code == 403
    assert read(client, a)["title"] == "A"


# --- Chat sessions are separate per user -----------------------------------------


def test_another_users_session_is_not_found(client: TestClient, second_client: TestClient) -> None:
    use(client, Turn("A signed token."))
    first = one_turn(client)
    session_id = first["session"]["id"]
    fake = use(second_client, Turn("never"))
    url = f"/api/agent/sessions/{session_id}"
    assert second_client.get(url).status_code == 404
    assert second_client.patch(url, json={"title": "mine"}).status_code == 404
    assert second_client.delete(url).status_code == 404
    assert send(second_client, "and?", session_id=session_id).status_code == 404
    retry = send(
        second_client, "what is JWT?", session_id=session_id, retry_from=first["user_message_id"]
    )
    assert retry.status_code == 404
    assert fake.calls == []
    stored = read(client, session_id)
    assert stored["title"] == "what is JWT?"
    assert stored["message_count"] == 2


def test_lists_do_not_mix(client: TestClient, second_client: TestClient) -> None:
    use(client, Turn("for the admin"))
    one_turn(client, "admin chat")
    use(second_client, Turn("for the member"))
    one_turn(second_client, "member chat")
    assert [s["title"] for s in sessions(second_client)] == ["member chat"]
    assert [s["title"] for s in sessions(client)] == ["admin chat"]


def test_not_signed_in_is_401(client: TestClient) -> None:
    app: FastAPI = client.app  # type: ignore[assignment]
    with TestClient(app, headers={"X-LearningHub": "1"}) as anonymous:
        assert anonymous.get("/api/agent/sessions").status_code == 401
        assert anonymous.get(f"/api/agent/sessions/{MISSING}").status_code == 401


def test_deleting_a_user_deletes_their_sessions(
    client: TestClient, second_client: TestClient
) -> None:
    use(second_client, Turn("for the member"))
    one_turn(second_client, "member chat")
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        db.execute(delete(User).where(User.email == MEMBER_EMAIL))
        db.commit()
        assert db.scalars(select(ChatSession)).all() == []
        assert db.scalars(select(ChatMessage)).all() == []
    assert uuid.UUID(MISSING).int == 0
