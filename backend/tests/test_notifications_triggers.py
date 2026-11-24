"""Spec: notifications - New member, Lesson ready and Published field notifications."""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent.messages import Turn
from app.db import Notification
from tests import test_auth_oauth
from tests.agent_fakes import FakeFactory
from tests.auth_fakes import AuthKit, ProviderState
from tests.conftest import MEMBER_EMAIL, user_id_of
from tests.test_admin_users import ANA, accept, invite
from tests.test_auth_oauth import approve, error_of, start
from tests.test_isolation_agent import add, call, chat

okit = test_auth_oauth.okit  # the fixtures: an app with the fake GitHub and Google
provider = test_auth_oauth.provider


def notes_of(app: Any, email: str | None = None, kind: str | None = None) -> list[Notification]:
    with app.state.session_factory() as db:
        query = select(Notification).where(Notification.user_id == user_id_of(app, email))
        if kind:
            query = query.where(Notification.kind == kind)
        return list(db.scalars(query.order_by(Notification.created_at)))


# Scenario: Member signs up
def test_open_signup_notifies_the_admin_only(kit: AuthKit) -> None:
    assert kit.signup().status_code == 201
    assert notes_of(kit.app) == []  # the admin's own account makes none
    browser = kit.browser()
    body = {"email": ANA, "password": "ana's long password", "display_name": "<b>Ana</b>"}
    assert browser.post("/api/auth/signup", json=body).status_code == 201
    (note,) = notes_of(kit.app, kind="new_member")
    assert note.params == {"name": "<b>Ana</b>", "email": ANA}
    assert note.link == "#/settings/users" and note.read_at is None
    assert notes_of(kit.app, ANA) == []


def test_invitation_accept_notifies_the_admin(kit: AuthKit) -> None:
    assert kit.signup().status_code == 201
    assert invite(kit).status_code == 201
    browser = kit.browser()
    assert accept(kit, browser, kit.mailer.token("invitation")).status_code == 201
    (note,) = notes_of(kit.app, kind="new_member")
    assert note.params == {"name": "Ana", "email": ANA}
    assert notes_of(kit.app, ANA) == []


def test_oauth_signup_notifies_the_admin(
    okit: AuthKit,
    provider: tuple[str, ProviderState],
) -> None:
    _, state = provider
    okit.signup(email="boss@example.test")
    assert notes_of(okit.app) == []
    browser = okit.browser()
    assert error_of(approve(browser, state, "github", start(browser, "github"))) is None
    (note,) = notes_of(okit.app, kind="new_member")
    assert note.link == "#/settings/users" and note.params["email"]
    assert browser.get("/api/auth/me").json()["role"] == "member"


# Scenario: Lesson writer finishes
def test_write_lesson_notifies_its_user(client: TestClient, second_client: TestClient) -> None:
    factory = FakeFactory(
        Turn("", (call("write_lesson", node_id="backend/graphql", markdown="# GraphQL"),)),
        Turn("written"),
    )
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    add(second_client, "Member Claude")
    assert chat(second_client).status_code == 200
    (note,) = notes_of(client.app, MEMBER_EMAIL, "lesson_ready")
    assert note.params["node"] == "backend/graphql" and note.params["title"]
    assert note.link == "#/lesson/backend/graphql"
    assert notes_of(client.app, kind="lesson_ready") == []


# Scenario: Publish
def test_publish_notifies_each_member_not_the_admin_once_a_day(
    client: TestClient, second_client: TestClient
) -> None:
    field = client.post("/api/fields", json={"title": "Finance"}).json()
    url = f"/api/fields/{field['id']}"
    assert client.patch(url, json={"title": "Finance"}).status_code == 200
    assert notes_of(client.app, MEMBER_EMAIL) == []  # not published yet
    assert client.patch(url, json={"published": True}).status_code == 200
    (note,) = notes_of(client.app, MEMBER_EMAIL, "field_published")
    assert note.params == {"title": "Finance"} and note.link == "#/"
    assert notes_of(client.app) == []
    client.patch(url, json={"published": False})
    client.patch(url, json={"published": True})
    assert len(notes_of(client.app, MEMBER_EMAIL, "field_published")) == 1
