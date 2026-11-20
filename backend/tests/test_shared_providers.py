"""Spec: ai-providers (Share a configuration with all users) and agent-providers (shared
agent setup, daily limit on shared configurations, withdrawn warning, read-only setup).

The admin is ``client``; ``second_client`` is a member. No real provider is ever called:
chats run on FakeFactory, everything else on NoNetworkFactory (which fails on any build).
"""

import json
import logging
import threading
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from io import BytesIO
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent.llm.errors import ProviderError
from app.agent.messages import Turn
from app.agent.resolve import count_shared, limit_message, utc_today
from app.auth.sessions import COOKIE, LIFETIME, hash_token, new_token
from app.db import AIProvider, SharedUsage, User, UserSession
from tests.agent_fakes import FakeFactory
from tests.conftest import MEMBER_EMAIL, user_id_of
from tests.test_agent_providers_api import KEY, QUESTION, add, add_local, assign, chat, set_active
from tests.test_data_backup import download, restore

LIMIT_429 = limit_message(10)


def app_of(client: TestClient) -> FastAPI:
    app: FastAPI = client.app  # type: ignore[assignment]
    return app


def fake(client: TestClient) -> FakeFactory:
    factory = FakeFactory(Turn("default answer"))
    app_of(client).state.llm_factory = factory
    return factory


def share(client: TestClient, provider_id: str, shared: bool = True) -> Any:
    current = client.get(f"/api/ai-providers/{provider_id}").json()
    body = {
        "name": current["name"],
        "provider_type": current["provider_type"],
        "model_name": current["model_name"],
        "base_url": current["base_url"],
        "config": current["config"],
        "is_active": current["is_active"],
        "shared": shared,
    }
    return client.put(f"/api/ai-providers/{provider_id}", json=body)


def add_shared(client: TestClient, name: str = "Claude main", **overrides: Any) -> str:
    return add(client, name, shared=True, **overrides)


def status(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/agents/shared")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def member_id(client: TestClient, email: str = MEMBER_EMAIL) -> Any:
    return user_id_of(app_of(client), email)


def set_usage(client: TestClient, email: str, day: Any, runs: int) -> None:
    with app_of(client).state.session_factory() as db:
        user_id = member_id(client, email)
        row = db.get(SharedUsage, (user_id, day))
        if row is None:
            db.add(SharedUsage(user_id=user_id, day=day, runs=runs))
        else:
            row.runs = runs
        db.commit()


def usage_rows(client: TestClient) -> list[tuple[Any, Any, int]]:
    with app_of(client).state.session_factory() as db:
        return [(r.user_id, r.day, r.runs) for r in db.scalars(select(SharedUsage))]


@pytest.fixture
def third_client(client: TestClient) -> Iterator[TestClient]:
    """Another member, signed in on the same app."""
    app = app_of(client)
    now = datetime.now(UTC)
    token = new_token()
    with app.state.session_factory() as db:
        user = User(email="third@example.test", email_verified_at=now, role="member")
        user.preferences = {}
        db.add(user)
        db.flush()
        db.add(
            UserSession(
                user_id=user.id,
                token_hash=hash_token(token),
                last_seen_at=now,
                expires_at=now + LIFETIME,
            )
        )
        db.commit()
    with TestClient(app, headers={"X-LearningHub": "1"}, cookies={COOKIE: token}) as other:
        yield other


def member_client(client: TestClient) -> TestClient:
    """A second TestClient of the member (same user, own session cookie)."""
    from tests.conftest import member_session_token

    app = app_of(client)
    return TestClient(
        app, headers={"X-LearningHub": "1"}, cookies={COOKIE: member_session_token(app)}
    )


# === ai-providers: Share a configuration with all users ===================================


# Scenario: Admin shares
def test_admin_shares_and_unshares(client: TestClient) -> None:
    provider_id = add(client, "Claude main")
    listed = client.get("/api/ai-providers").json()
    assert listed[0]["shared"] is False  # private unless shared

    response = share(client, provider_id)
    assert response.status_code == 200, response.text
    assert response.json()["shared"] is True
    assert [(p["name"], p["shared"]) for p in client.get("/api/ai-providers").json()] == [
        ("Claude main", True)
    ]
    # An update that leaves `shared` out keeps it.
    set_active(client, provider_id, True)
    assert client.get(f"/api/ai-providers/{provider_id}").json()["shared"] is True

    assert share(client, provider_id, False).json()["shared"] is False
    created = client.post(
        "/api/ai-providers",
        json={
            "name": "Claude fast",
            "provider_type": "anthropic",
            "model_name": "claude-haiku-5",
            "api_key": KEY,
            "shared": True,
        },
    )
    assert created.status_code == 201 and created.json()["shared"] is True


# Scenario: Member cannot share
def test_member_cannot_share(client: TestClient, second_client: TestClient) -> None:
    body = {
        "name": "My key",
        "provider_type": "anthropic",
        "model_name": "claude-sonnet-5-5",
        "api_key": KEY,
        "shared": True,
    }
    refused = second_client.post("/api/ai-providers", json=body)
    assert refused.status_code == 403
    assert refused.json()["detail"] == "only the admin can share a provider"
    assert second_client.get("/api/ai-providers").json() == []

    own = add(second_client, "My key")
    refused = share(second_client, own)
    assert refused.status_code == 403
    assert refused.json()["detail"] == "only the admin can share a provider"
    assert second_client.get(f"/api/ai-providers/{own}").json()["shared"] is False
    # Sending `shared: false` is not sharing: the member's save goes through.
    assert share(second_client, own, False).status_code == 200


# Scenario: Claude Code cannot be shared
def test_claude_code_cannot_be_shared(client: TestClient) -> None:
    body = {"name": "Sub", "provider_type": "claude-code", "model_name": "sonnet", "shared": True}
    refused = client.post("/api/ai-providers", json=body)
    assert refused.status_code == 422
    assert refused.json()["detail"] == "Claude Code cannot be shared"
    assert client.get("/api/ai-providers").json() == []

    # A shared row cannot be turned into Claude Code, with `shared` sent or left out.
    provider_id = add_shared(client)
    for extra in ({}, {"shared": True}):
        changed = client.put(
            f"/api/ai-providers/{provider_id}",
            json={"name": "Claude main", "provider_type": "claude-code", "model_name": "sonnet"}
            | extra,
        )
        assert changed.status_code == 422
        assert changed.json()["detail"] == "Claude Code cannot be shared"
    row = client.get(f"/api/ai-providers/{provider_id}").json()
    assert (row["provider_type"], row["shared"]) == ("anthropic", True)
    # Unsharing in the same save is allowed (a keyless row, so no stored key is in the way).
    keyless = add_local(client)
    assert share(client, keyless).status_code == 200
    allowed = client.put(
        f"/api/ai-providers/{keyless}",
        json={
            "name": "Local qwen",
            "provider_type": "claude-code",
            "model_name": "sonnet",
            "shared": False,
        },
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["shared"] is False


# Scenario: Hidden from other users
def test_shared_row_is_hidden_from_other_users(
    client: TestClient, second_client: TestClient
) -> None:
    provider_id = add_shared(client)
    missing = f"no AI provider with id {provider_id}"
    assert second_client.get("/api/ai-providers").json() == []
    calls = [
        second_client.get(f"/api/ai-providers/{provider_id}"),
        second_client.post(f"/api/ai-providers/{provider_id}/test"),
        second_client.get(f"/api/ai-providers/{provider_id}/models"),
        second_client.put(
            f"/api/ai-providers/{provider_id}",
            json={"name": "Mine", "provider_type": "anthropic", "model_name": "x", "shared": False},
        ),
        second_client.delete(f"/api/ai-providers/{provider_id}"),
        second_client.post(
            "/api/ai-providers/test",
            json={
                "provider_id": provider_id,
                "provider_type": "anthropic",
                "model_name": "claude-sonnet-5-5",
            },
        ),
    ]
    for response in calls:
        assert response.status_code == 404, response.text
        assert response.json()["detail"] == missing
    # Nothing changed, and no client was built with the admin's key (NoNetworkFactory).
    row = client.get(f"/api/ai-providers/{provider_id}").json()
    assert (row["name"], row["shared"], row["last_test"]) == ("Claude main", True, None)


# Scenario: Unshare
def test_unshare_ends_the_use(client: TestClient, second_client: TestClient) -> None:
    provider_id = add_shared(client)
    fake(client)
    assert chat(second_client).status_code == 200
    assert share(client, provider_id, False).status_code == 200
    refused = chat(second_client)
    assert refused.status_code == 409
    assert "Settings" in refused.json()["detail"]


# Scenario: Backup
def test_backup_does_not_carry_shared_and_restore_is_private(client: TestClient) -> None:
    add_shared(client)
    backup = download(client)
    with zipfile.ZipFile(BytesIO(backup)) as archive:
        providers = json.loads(archive.read("data/ai_providers.json"))
    assert [p["name"] for p in providers] == ["Claude main"]
    assert all("shared" not in p for p in providers)

    assert restore(client, backup).status_code == 200
    listed = client.get("/api/ai-providers").json()
    assert [(p["name"], p["shared"]) for p in listed] == [("Claude main", False)]


# === agent-providers: resolution in shared mode ============================================


# Scenario: Shared configuration for a user without one
def test_member_without_a_configuration_runs_on_the_shared_one(
    client: TestClient, second_client: TestClient
) -> None:
    provider_id = add_shared(client)
    factory = fake(client)
    response = chat(second_client)
    assert response.status_code == 200, response.text
    assert response.json()["provider"]["name"] == "Claude main"
    # The admin's key is used server-side only, inside the factory.
    assert [(s.name, s.key) for s in factory.built] == [("Claude main", KEY)]
    assert KEY not in response.text and "1234" not in response.text

    agents = second_client.get("/api/agents")
    assert agents.status_code == 200
    for agent in agents.json():
        assert agent["primary"] is None and agent["fallback"] is None
        assert agent["effective_reason"] == "shared"
        assert agent["effective"] == {
            "id": provider_id,
            "name": "Claude main",
            "provider_type": "anthropic",
            "model_name": "claude-sonnet-5-5",
            "is_active": True,
            "last_test_status": None,
            "shared": True,
        }
    assert "key_hint" not in agents.text and "base_url" not in agents.text
    assert KEY not in agents.text and "1234" not in agents.text
    # The admin sees their own row as their own (not "shared by the admin").
    own_view = client.get("/api/agents").json()[0]
    assert own_view["effective_reason"] == "default"
    assert own_view["effective"]["shared"] is False


# Scenario: Own configuration wins over a shared one
def test_own_configuration_wins(client: TestClient, second_client: TestClient) -> None:
    add_shared(client)
    factory = fake(client)
    add(second_client, "My key")
    response = chat(second_client)
    assert response.json()["provider"]["name"] == "My key"
    assert [s.name for s in factory.built] == ["My key"]
    assert status(second_client)["mode"] == "own"
    assert usage_rows(client) == []
    assert second_client.get("/api/agents").json()[0]["effective_reason"] == "default"


# Scenario: No shared configuration
def test_no_shared_configuration_is_a_conflict(
    client: TestClient, second_client: TestClient
) -> None:
    add(client, "Claude main")  # private
    response = chat(second_client)
    assert response.status_code == 409
    assert "Settings" in response.json()["detail"]
    assert status(second_client)["mode"] == "none"
    assert second_client.get("/api/agents").json()[0]["effective_reason"] == "none"


# Scenario: Shared configuration switched off
def test_shared_configuration_switched_off_is_a_conflict(
    client: TestClient, second_client: TestClient
) -> None:
    provider_id = add_shared(client)
    set_active(client, provider_id, False)
    response = chat(second_client)
    assert response.status_code == 409
    assert "Settings" in response.json()["detail"]
    assert usage_rows(client) == []


def test_override_matches_only_own_rows(client: TestClient, second_client: TestClient) -> None:
    provider_id = add_shared(client)
    fake(client)
    response = chat(second_client, provider_id=provider_id)
    assert response.status_code == 404
    assert response.json()["detail"] == f"no AI provider with id {provider_id}"
    assert usage_rows(client) == []


# === Shared agent setup ===================================================================


# Scenario: Agent follows the admin's assignment
def test_agent_follows_the_admins_assignment(client: TestClient, second_client: TestClient) -> None:
    main = add_shared(client)
    fast = add_shared(client, "Claude fast", model_name="claude-haiku-5")
    assert assign(client, "lesson-writer", fast, main).status_code == 200
    factory = fake(client)
    factory.script("Claude fast", ProviderError("busy", "rate_limited"))
    factory.script("Claude main", Turn("fallback answer"))
    response = chat(second_client, "lesson-writer")
    assert response.status_code == 200, response.text
    # The admin's primary was tried first, then the admin's (shared) fallback answered.
    assert [s.name for s in factory.built] == ["Claude fast", "Claude main"]
    assert response.json()["fallback_used"] is True
    agents = {a["id"]: a for a in second_client.get("/api/agents").json()}
    assert agents["lesson-writer"]["effective"]["name"] == "Claude fast"
    assert agents["assistant"]["effective"]["name"] == "Claude main"


def test_unassigned_agent_follows_the_admins_assistant(
    client: TestClient, second_client: TestClient
) -> None:
    add_shared(client)
    fast = add_shared(client, "Claude fast", model_name="claude-haiku-5")
    assert assign(client, "assistant", fast).status_code == 200
    factory = fake(client)
    assert chat(second_client, "lesson-writer").json()["provider"]["name"] == "Claude fast"
    assert [s.name for s in factory.built] == ["Claude fast"]


# Scenario: Private assignment is skipped
def test_private_assignment_is_skipped(client: TestClient, second_client: TestClient) -> None:
    local = add_local(client)
    main = add(client, "Claude main")
    fast = add_shared(client, "Claude fast", model_name="claude-haiku-5")
    # The admin's primary is private and the fallback is private: neither is used.
    assert assign(client, "lesson-writer", local, main).status_code == 200
    factory = fake(client)
    factory.script("Claude fast", ProviderError("busy", "rate_limited"))
    response = chat(second_client, "lesson-writer")
    assert response.status_code == 502
    assert [s.name for s in factory.built] == ["Claude fast"]  # no private fallback
    share(client, main)
    factory = fake(client)
    response = chat(second_client, "lesson-writer")
    # "Claude main" was created first among the shared rows.
    assert response.json()["provider"]["name"] == "Claude main"
    assert fast  # the other shared row exists but is not the first


def test_claude_code_of_the_admin_is_never_used_in_shared_mode(
    client: TestClient, second_client: TestClient
) -> None:
    with app_of(client).state.session_factory() as db:
        admin_id = user_id_of(app_of(client))
        # Even a row flagged shared by hand (the API refuses it) is not used.
        db.add(
            AIProvider(
                user_id=admin_id,
                name="Sub",
                provider_type="claude-code",
                model_name="sonnet",
                shared=True,
            )
        )
        db.commit()
    assert chat(second_client).status_code == 409
    assert status(second_client)["mode"] == "none"


# Scenario: Internet search follows the admin
def test_internet_search_follows_the_admin(
    client: TestClient, second_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_shared(client)
    fake(client)
    assert client.put("/api/agents/assistant/settings", json={"web_search": True}).is_success
    # The member's own switch is stored but has no effect in shared mode.
    saved = second_client.put("/api/agents/assistant/settings", json={"web_search": False})
    assert saved.status_code == 200 and saved.json()["web_search"] is True
    seen: list[bool] = []
    import app.routes.agent as agent_route

    real = agent_route.run_agent

    def spy(*args: Any, **kwargs: Any) -> Any:
        seen.append(kwargs["web_search"])
        return real(*args, **kwargs)

    monkeypatch.setattr(agent_route, "run_agent", spy)
    assert chat(second_client).status_code == 200
    assert chat(second_client, "lesson-writer").status_code == 200
    assert seen == [True, False]
    agents = {a["id"]: a["web_search"] for a in second_client.get("/api/agents").json()}
    assert agents["assistant"] is True and agents["lesson-writer"] is False


# === Daily limit on shared configurations =================================================


# Scenario: Count shown
def test_count_shown(client: TestClient, second_client: TestClient) -> None:
    add_shared(client)
    fake(client)
    for _ in range(3):
        assert chat(second_client).status_code == 200
    body = status(second_client)
    today = utc_today()
    assert body == {
        "mode": "shared",
        "used_today": 3,
        "daily_limit": 10,
        "resets_at": (today + timedelta(days=1)).isoformat() + "T00:00:00Z",
        "withdrawn": False,
    }


def test_limit_follows_the_server_setting(client: TestClient, second_client: TestClient) -> None:
    add_shared(client)
    fake(client)
    app_of(client).state.settings.shared_daily_limit = 2
    assert chat(second_client).status_code == 200
    assert chat(second_client).status_code == 200
    refused = chat(second_client)
    assert refused.status_code == 429
    assert refused.json() == {"detail": limit_message(2)}
    assert "2 requests" in refused.json()["detail"]
    assert status(second_client)["daily_limit"] == 2


# Scenario: Over the limit
def test_over_the_limit_is_refused_before_any_model_call(
    client: TestClient, second_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    add_shared(client)
    factory = fake(client)
    set_usage(client, MEMBER_EMAIL, utc_today(), 10)
    with caplog.at_level(logging.DEBUG):
        response = chat(second_client)
    assert response.status_code == 429
    assert response.json() == {"detail": LIMIT_429}
    assert response.json()["detail"] == (
        "Daily limit reached: you have used today's 10 requests on the shared provider. "
        "Add your own provider in Settings, or try again tomorrow."
    )
    assert factory.built == [] and factory.default.calls == []
    assert status(second_client)["used_today"] == 10  # a refused request does not count
    refused = [r for r in caplog.records if r.getMessage() == "shared limit"]
    assert len(refused) == 1
    assert refused[0].user_id == str(member_id(client))  # type: ignore[attr-defined]
    logged = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)
    assert QUESTION not in logged and KEY not in logged


def test_a_failed_request_still_counts(client: TestClient, second_client: TestClient) -> None:
    add_shared(client, base_url=None)
    factory = fake(client)
    factory.script(
        "Claude main", ProviderError("refused at https://internal.example/v1", "auth_failed")
    )
    response = chat(second_client)
    assert response.status_code == 502
    # The member sees the shared row's name, model and error category only.
    assert response.json()["detail"] == "Claude main (claude-sonnet-5-5): auth_failed"
    assert status(second_client)["used_today"] == 1


# Scenario: Another user
def test_another_user_is_not_affected(
    client: TestClient, second_client: TestClient, third_client: TestClient
) -> None:
    add_shared(client)
    fake(client)
    set_usage(client, MEMBER_EMAIL, utc_today(), 10)
    assert chat(second_client).status_code == 429
    assert chat(third_client).status_code == 200
    assert status(third_client)["used_today"] == 1
    assert status(second_client)["used_today"] == 10


# Scenario: Next day
def test_next_utc_day_starts_again(client: TestClient, second_client: TestClient) -> None:
    add_shared(client)
    fake(client)
    set_usage(client, MEMBER_EMAIL, utc_today() - timedelta(days=1), 10)
    assert chat(second_client).status_code == 200
    assert status(second_client)["used_today"] == 1


# Scenario: Admin is not counted
def test_admin_is_not_counted(client: TestClient) -> None:
    add_shared(client)
    fake(client)
    for _ in range(3):
        assert chat(client).status_code == 200
    assert usage_rows(client) == []
    body = status(client)
    assert (body["mode"], body["used_today"], body["withdrawn"]) == ("own", 0, False)
    # No limit of any kind: even with a full count row the admin is answered.
    with app_of(client).state.session_factory() as db:
        db.add(SharedUsage(user_id=user_id_of(app_of(client)), day=utc_today(), runs=10))
        db.commit()
    assert chat(client).status_code == 200


def test_two_requests_at_once_at_the_limit_count_once(client: TestClient) -> None:
    """The count is one atomic statement: while one request holds the row, the other waits
    and then sees the new count."""
    add_shared(client)
    with app_of(client).state.session_factory() as db:
        member = db.scalar(select(User).where(User.email == MEMBER_EMAIL))
        if member is None:
            member = User(email=MEMBER_EMAIL, role="member", preferences={})
            db.add(member)
            db.commit()
        user_id = member.id
    day = utc_today()
    set_usage(client, MEMBER_EMAIL, day, 9)
    factory = app_of(client).state.session_factory
    first, second = factory(), factory()
    try:
        assert count_shared(first, user_id, 10, day) == 10  # holds the row, not committed
        results: list[int | None] = []
        waiting = threading.Thread(
            target=lambda: results.append(count_shared(second, user_id, 10, day))
        )
        waiting.start()
        waiting.join(timeout=0.5)
        assert waiting.is_alive()  # blocked on the first request's row
        first.commit()
        waiting.join(timeout=10)
        assert results == [None]
        second.commit()
    finally:
        first.close()
        second.close()
    assert usage_rows(client) == [(user_id, day, 10)]


def test_two_chats_at_once_at_the_limit_only_one_passes(
    client: TestClient, second_client: TestClient
) -> None:
    add_shared(client)
    fake(client)
    set_usage(client, MEMBER_EMAIL, utc_today(), 9)
    other = member_client(client)
    barrier = threading.Barrier(2)
    codes: list[int] = []

    def send(c: TestClient) -> None:
        barrier.wait()
        codes.append(chat(c).status_code)

    with other:
        threads = [threading.Thread(target=send, args=(c,)) for c in (second_client, other)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
    assert sorted(codes) == [200, 429]
    assert status(second_client)["used_today"] == 10


# === Warning when the shared configuration is withdrawn ===================================


# Scenario: Unshared
def test_withdrawn_after_unshare(client: TestClient, second_client: TestClient) -> None:
    provider_id = add_shared(client)
    fake(client)
    set_usage(client, MEMBER_EMAIL, utc_today() - timedelta(days=1), 2)
    assert status(second_client)["withdrawn"] is False
    share(client, provider_id, False)
    body = status(second_client)
    assert (body["mode"], body["withdrawn"]) == ("none", True)


# Scenario: Switched off or deleted
@pytest.mark.parametrize("how", ["off", "deleted"])
def test_withdrawn_after_switch_off_or_delete(
    client: TestClient, second_client: TestClient, how: str
) -> None:
    provider_id = add_shared(client)
    fake(client)
    assert chat(second_client).status_code == 200
    if how == "off":
        set_active(client, provider_id, False)
    else:
        assert client.delete(f"/api/ai-providers/{provider_id}").status_code == 204
    body = status(second_client)
    assert (body["mode"], body["withdrawn"]) == ("none", True)
    assert chat(second_client).status_code == 409


# Scenario: Falls back to the user's own configuration
def test_own_configuration_clears_the_warning(
    client: TestClient, second_client: TestClient
) -> None:
    provider_id = add_shared(client)
    fake(client)
    assert chat(second_client).status_code == 200
    share(client, provider_id, False)
    assert status(second_client)["withdrawn"] is True
    add(second_client, "My key")
    assert chat(second_client).json()["provider"]["name"] == "My key"
    body = status(second_client)
    assert (body["mode"], body["withdrawn"]) == ("own", False)


# Scenario: Shared again
def test_shared_again_clears_the_warning(client: TestClient, second_client: TestClient) -> None:
    provider_id = add_shared(client)
    fake(client)
    assert chat(second_client).status_code == 200
    share(client, provider_id, False)
    assert status(second_client)["withdrawn"] is True
    share(client, provider_id, True)
    body = status(second_client)
    assert (body["mode"], body["withdrawn"]) == ("shared", False)
    assert chat(second_client).status_code == 200


# Scenario: User who never used it
def test_no_warning_for_a_user_who_never_used_it(
    client: TestClient, second_client: TestClient
) -> None:
    assert status(second_client) | {"resets_at": None} == {
        "mode": "none",
        "used_today": 0,
        "daily_limit": 10,
        "resets_at": None,
        "withdrawn": False,
    }
    # A shared request more than 30 days ago no longer warns.
    set_usage(client, MEMBER_EMAIL, utc_today() - timedelta(days=31), 3)
    assert status(second_client)["withdrawn"] is False


# === Shared setup is read-only ============================================================


# Scenario: Read-only rows (the API side: no assignment of the member's, the admin's setup)
# Scenario: Assigning the shared configuration is refused
def test_assigning_the_shared_configuration_is_refused(
    client: TestClient, second_client: TestClient
) -> None:
    provider_id = add_shared(client)
    response = assign(second_client, "assistant", provider_id)
    assert response.status_code == 404
    assert response.json()["detail"] == f"no AI provider with id {provider_id}"
    response = assign(second_client, "assistant", None, provider_id)
    assert response.status_code == 404
    agent = second_client.get("/api/agents/assistant/provider").json()
    assert (agent["primary"], agent["fallback"], agent["effective_reason"]) == (
        None,
        None,
        "shared",
    )


def test_shared_status_needs_a_session(client: TestClient) -> None:
    with TestClient(app_of(client)) as anonymous:
        assert anonymous.get("/api/agents/shared").status_code == 401
