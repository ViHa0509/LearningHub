"""Spec: notifications - Shared limit, Provider problem and Knowledge Hub reconnect."""

import json
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent.llm.errors import ProviderError
from app.agent.messages import Turn
from app.agent.resolve import resets_at, utc_today
from app.agent.tools import AgentTools
from app.db import Notification
from app.kh.http import HttpReply
from app.kh.service import KhReconnect
from tests.agent_fakes import FakeFactory
from tests.conftest import MEMBER_EMAIL, user_id_of
from tests.test_agent_providers_api import add, assign, chat
from tests.test_kh_search import (
    kit,  # noqa: F401  (fixture)
    run_search,
)
from tests.test_shared_providers import add_shared, app_of, fake, set_usage


def notes(client: TestClient, kind: str, email: str | None = None) -> list[Notification]:
    app = app_of(client)
    with app.state.session_factory() as db:
        return list(
            db.scalars(
                select(Notification)
                .where(Notification.user_id == user_id_of(app, email), Notification.kind == kind)
                .order_by(Notification.created_at)
            )
        )


# Scenario: 80 percent
def test_member_gets_a_notice_at_80_percent_once_and_one_at_the_limit(
    client: TestClient, second_client: TestClient
) -> None:
    add_shared(client)
    fake(client)
    app_of(client).state.settings.shared_daily_limit = 20
    set_usage(client, MEMBER_EMAIL, utc_today(), 15)
    assert chat(second_client).status_code == 200  # the 16th
    (note,) = notes(client, "shared_limit", MEMBER_EMAIL)
    assert note.params == {
        "used": 16,
        "limit": 20,
        "resets_at": resets_at(utc_today()).isoformat(),
    }
    assert note.link == "#/settings"
    assert chat(second_client).status_code == 200  # the 17th adds none
    assert len(notes(client, "shared_limit", MEMBER_EMAIL)) == 1
    set_usage(client, MEMBER_EMAIL, utc_today(), 19)
    assert chat(second_client).status_code == 200  # the 20th: limit reached
    reached = notes(client, "shared_limit", MEMBER_EMAIL)
    assert [n.params["used"] for n in reached] == [16, 20]
    assert chat(second_client).status_code == 429  # refused: no third notice
    assert len(notes(client, "shared_limit", MEMBER_EMAIL)) == 2
    assert notes(client, "shared_limit") == []  # never the admin


def test_a_limit_of_one_makes_only_the_reached_notice(
    client: TestClient, second_client: TestClient
) -> None:
    add_shared(client)
    fake(client)
    app_of(client).state.settings.shared_daily_limit = 1
    assert chat(second_client).status_code == 200
    (note,) = notes(client, "shared_limit", MEMBER_EMAIL)
    assert note.params["used"] == 1


# Scenario: Admin has no limit
def test_the_admin_gets_no_limit_notice(client: TestClient) -> None:
    add(client, "Admin Claude")
    fake(client)
    app_of(client).state.settings.shared_daily_limit = 2
    for _ in range(5):
        assert chat(client).status_code == 200
    assert notes(client, "shared_limit") == []


def failing(client: TestClient, category: str, name: str = "Primary") -> tuple[str, FakeFactory]:
    """A primary that always fails with ``category`` and a fallback that answers."""
    primary = add(client, name)
    backup = add(client, "Backup")
    assert assign(client, "assistant", primary, backup).status_code == 200
    factory = FakeFactory(Turn("from fallback"), Turn("from fallback"))
    factory.script(name, *[ProviderError("secret detail sk-xyz", category)] * 3)  # type: ignore[arg-type]
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    return primary, factory


# Scenario: Fallback answered
def test_fallback_answers_and_the_user_gets_one_notice_per_day(client: TestClient) -> None:
    primary, _ = failing(client, "rate_limited")
    first, second = chat(client).json(), chat(client).json()
    assert first["fallback_used"] and second["fallback_used"]
    (note,) = notes(client, "provider_problem")
    assert note.params == {
        "provider_id": primary,
        "name": "Primary",
        "category": "rate_limited",
        "fallback": True,
    }
    assert note.link == f"#/settings/providers/{primary}"
    assert "secret" not in json.dumps(note.params) and "sk-xyz" not in json.dumps(note.params)


def test_an_invalid_key_notifies_even_though_the_request_fails_and_rolls_back(
    client: TestClient,
) -> None:
    primary, _ = failing(client, "auth_failed")
    assert chat(client).status_code == 502
    assert chat(client).status_code == 502
    (note,) = notes(client, "provider_problem")
    assert note.params["category"] == "auth_failed" and note.params["fallback"] is False
    assert note.params["provider_id"] == primary


def test_a_timeout_without_fallback_notifies_nobody(client: TestClient) -> None:
    primary = add(client, "Primary")
    assert assign(client, "assistant", primary, None).status_code == 200
    factory = FakeFactory()
    factory.script("Primary", ProviderError("slow", "timeout"))
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    assert chat(client).status_code == 502
    assert notes(client, "provider_problem") == []


def test_a_member_on_the_shared_provider_gets_no_provider_notice(
    client: TestClient, second_client: TestClient
) -> None:
    add_shared(client)
    factory = fake(client)
    factory.script("Claude main", ProviderError("bad", "auth_failed"))
    assert chat(second_client).status_code == 502
    assert notes(client, "provider_problem", MEMBER_EMAIL) == []


# Scenario: Connection expired
def test_kh_reconnect_notifies_once_until_the_user_connects_again(
    kit: Any,  # noqa: F811
) -> None:
    kit.connect_and_approve()
    kit.fake.refresh_reply = HttpReply(400, {"error": "invalid_grant"})
    run_search(kit, query="x")
    (note,) = notes(kit.client, "kh_reconnect")
    assert note.link == "#/settings/agents/connections" and note.params == {}
    # A second failure before reconnecting adds none.
    with kit.app.state.session_factory() as db:
        tools = AgentTools(
            db, kit.app.state.catalog, user_id=user_id_of(kit.app), kh_search=_expired
        )
        assert "error" in json.loads(tools.run("kh_search", {"query": "y"}).result)
    assert len(notes(kit.client, "kh_reconnect")) == 1
    # Connecting again removes it; the next expiry makes a new one.
    kit.fake.refresh_reply = HttpReply(
        200, {"access_token": "a", "refresh_token": "r", "expires_in": 300}
    )
    kit.connect_and_approve()
    assert notes(kit.client, "kh_reconnect") == []
    with kit.app.state.session_factory() as db:
        tools = AgentTools(
            db, kit.app.state.catalog, user_id=user_id_of(kit.app), kh_search=_expired
        )
        tools.run("kh_search", {"query": "z"})
    assert len(notes(kit.client, "kh_reconnect")) == 1


def _expired(query: str, project: str | None) -> Any:
    raise KhReconnect()
