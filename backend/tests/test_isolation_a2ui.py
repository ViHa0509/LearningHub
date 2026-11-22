"""Spec: a2ui-chat - Grade an answer (Someone else's surface) and Stored chats keep their
surfaces, for two users. The admin is ``client``; ``second_client`` is a member."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.agent.messages import Turn
from app.db import A2uiSurface, ChatMessage
from tests.agent_fakes import FakeFactory
from tests.test_a2ui_actions import act
from tests.test_a2ui_chat import chat, quiz_turns, setup
from tests.test_shared_providers import add_shared


def test_another_users_surface_is_invisible_and_its_actions_answer_404(
    client: TestClient, second_client: TestClient
) -> None:
    assistant, tutor = quiz_turns()
    setup(client, assistant, tutor)
    body = chat(client).json()
    surface_id = body["surfaces"][0]["id"]
    session_id = body["session"]["id"]

    # The member cannot read the chat, list it or act on its surface.
    assert second_client.get(f"/api/agent/sessions/{session_id}").status_code == 404
    assert second_client.get("/api/agent/sessions").json()["sessions"] == []
    for question in ("q1", "q2"):
        assert act(second_client, surface_id, question, ("1",)).status_code == 404
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        assert db.scalars(select(A2uiSurface.answers)).one() == {}
    # The owner still can.
    assert act(client, surface_id, "q1", ("2",)).status_code == 200


def test_a_surface_linked_to_another_users_message_is_not_shown(
    client: TestClient, second_client: TestClient
) -> None:
    assistant, tutor = quiz_turns()
    setup(client, assistant, tutor)
    admin_body = chat(client).json()
    # The member chats on the shared configuration (their own fake model).
    add_shared(client, "Shared model")
    client.app.state.llm_factory = FakeFactory(Turn("member answer"))  # type: ignore[attr-defined]
    member_body = chat(second_client, "hello").json()
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        # Force the admin's surface onto the member's assistant message.
        db.execute(update(A2uiSurface).values(message_id=member_body["assistant_message_id"]))
        assert db.scalar(
            select(ChatMessage.id).where(ChatMessage.id == member_body["assistant_message_id"])
        )
        db.commit()
    detail = second_client.get(f"/api/agent/sessions/{member_body['session']['id']}").json()
    assert [m["surfaces"] for m in detail["messages"]] == [[], []]
    assert admin_body["surfaces"][0]["id"]
