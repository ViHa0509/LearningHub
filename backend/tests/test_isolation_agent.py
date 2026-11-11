"""Spec: multi-user accounts - providers, agents, agent tools and rate limit are per user."""

import uuid
from typing import Any

from fastapi.testclient import TestClient

from app.agent.messages import ToolCall, Turn
from app.agent.ratelimit import RateLimiter
from tests.agent_fakes import FakeFactory
from tests.conftest import MEMBER_EMAIL, user_id_of
from tests.test_agent_chat import import_note

KEY = "sk-test-abcd1234"
MISSING = "00000000-0000-0000-0000-000000000000"


def add(client: TestClient, name: str, **overrides: Any) -> str:
    body: dict[str, Any] = {
        "name": name,
        "provider_type": "anthropic",
        "model_name": "claude-sonnet-5-5",
        "api_key": KEY,
        **overrides,
    }
    response = client.post("/api/ai-providers", json=body)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def assign(client: TestClient, agent: str, primary: str | None, fallback: str | None = None) -> Any:
    return client.put(
        f"/api/agents/{agent}/provider",
        json={"primary_provider_id": primary, "fallback_provider_id": fallback},
    )


def chat(client: TestClient, text: str = "hello") -> Any:
    return client.post("/api/agent/chat", json={"messages": [{"role": "user", "content": text}]})


def call(name: str, **args: Any) -> ToolCall:
    return ToolCall(id=f"id-{name}", name=name, input=args)


# Scenario: Personal data is separate per user (providers)
def test_member_never_sees_the_admins_providers(
    client: TestClient, second_client: TestClient
) -> None:
    admin_id = add(client, "Admin Claude")
    assert second_client.get("/api/ai-providers").json() == []
    assert second_client.get(f"/api/ai-providers/{admin_id}").status_code == 404
    body = {"name": "x", "provider_type": "anthropic", "model_name": "claude-sonnet-5-5"}
    assert second_client.put(f"/api/ai-providers/{admin_id}", json=body).status_code == 404
    assert second_client.delete(f"/api/ai-providers/{admin_id}").status_code == 404
    assert second_client.post(f"/api/ai-providers/{admin_id}/test").status_code == 404
    assert second_client.get(f"/api/ai-providers/{admin_id}/models").status_code == 404
    unsaved = {**body, "provider_id": admin_id}
    assert second_client.post("/api/ai-providers/test", json=unsaved).status_code == 404
    assert [p["name"] for p in client.get("/api/ai-providers").json()] == ["Admin Claude"]


def test_provider_names_are_unique_per_user(client: TestClient, second_client: TestClient) -> None:
    add(client, "Main")
    add(second_client, "Main")
    duplicate = second_client.post(
        "/api/ai-providers",
        json={
            "name": "Main",
            "provider_type": "anthropic",
            "model_name": "claude-sonnet-5-5",
            "api_key": KEY,
        },
    )
    assert duplicate.status_code == 409


# Scenario: Personal data is separate per user (agents)
def test_member_cannot_assign_the_admins_provider(
    client: TestClient, second_client: TestClient
) -> None:
    admin_provider = add(client, "Admin Claude")
    assert assign(second_client, "assistant", admin_provider).status_code == 404
    assert assign(second_client, "assistant", None, admin_provider).status_code == 404
    assert second_client.get("/api/agents/assistant/provider").json()["primary"] is None


def test_agents_and_used_by_are_per_user(client: TestClient, second_client: TestClient) -> None:
    admin_provider = add(client, "Admin Claude")
    member_provider = add(second_client, "Member Claude")
    assert assign(client, "assistant", admin_provider).status_code == 200
    admin_agent = client.get("/api/agents/assistant/provider").json()
    member_agent = second_client.get("/api/agents/assistant/provider").json()
    assert admin_agent["primary"]["id"] == admin_provider
    assert member_agent["primary"] is None
    # No assignment of their own: the member's agent falls back to their own first provider.
    assert member_agent["effective"]["id"] == member_provider
    assert member_agent["effective_reason"] == "default"
    admin_uses = client.get(f"/api/ai-providers/{admin_provider}").json()["used_by"]
    assert [u["agent_id"] for u in admin_uses] == ["assistant"]
    assert second_client.get(f"/api/ai-providers/{member_provider}").json()["used_by"] == []
    assert assign(second_client, "assistant", member_provider).status_code == 200
    assert client.get("/api/agents/assistant/provider").json()["primary"]["id"] == admin_provider
    settings = second_client.put("/api/agents/assistant/settings", json={"web_search": True})
    assert settings.json()["web_search"] is True
    assert client.get("/api/agents/assistant/provider").json()["web_search"] is False
    # The admin cannot delete-block the member and vice versa: each deletes their own.
    assert second_client.delete(f"/api/ai-providers/{member_provider}").status_code == 409
    assert client.delete(f"/api/ai-providers/{member_provider}").status_code == 404


def test_unknown_provider_for_an_agent_is_404(client: TestClient) -> None:
    assert assign(client, "assistant", MISSING).status_code == 404


# Scenario: the agent sees only its user's notes
def test_agent_chat_as_member_finds_only_the_members_notes(
    client: TestClient, second_client: TestClient
) -> None:
    import_note(client, "Admin zebra note", "zebra stripes of the admin")
    import_note(second_client, "Member zebra note", "zebra herds of the member")
    factory = FakeFactory(
        Turn("", (call("search_notes", query="zebra"),)),
        Turn("done"),
    )
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    add(second_client, "Member Claude")
    answer = chat(second_client, "what about zebra?").json()
    assert answer["reply"] == "done"
    assert answer["steps"][0]["summary"] == "Searched notes for 'zebra': 1 found"
    result = [m for m in factory.default.calls[1]["messages"] if m.role == "tool"]
    text = "".join(str(m) for m in result)
    assert "Member zebra note" in text
    assert "Admin zebra note" not in text


def test_agent_tools_read_note_of_another_user_is_not_found(
    client: TestClient, second_client: TestClient
) -> None:
    admin_note = import_note(client, "Admin secret", "classified")
    factory = FakeFactory(Turn("", (call("read_note", note_id=admin_note),)), Turn("done"))
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    add(second_client, "Member Claude")
    answer = chat(second_client).json()
    assert answer["steps"][0]["summary"].startswith("Error: no note with id")


def test_write_lesson_as_member_writes_the_members_lesson_only(
    client: TestClient, second_client: TestClient
) -> None:
    client.put("/api/lessons/backend/graphql", json={"body": "Admin's own lesson."})
    factory = FakeFactory(
        Turn("", (call("write_lesson", node_id="backend/graphql", markdown="# Member GraphQL"),)),
        Turn("written"),
    )
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    add(second_client, "Member Claude")
    answer = chat(second_client).json()
    assert answer["changed_lessons"] == ["backend/graphql"]
    member = second_client.get("/api/lessons/backend/graphql").json()
    assert (member["body"], member["source"]) == ("# Member GraphQL", "agent")
    admin = client.get("/api/lessons/backend/graphql").json()
    assert (admin["body"], admin["source"]) == ("Admin's own lesson.", "user")


def test_member_cannot_override_with_the_admins_provider(
    client: TestClient, second_client: TestClient
) -> None:
    admin_provider = add(client, "Admin Claude")
    add(second_client, "Member Claude")
    response = second_client.post(
        "/api/agent/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "provider_id": admin_provider},
    )
    assert response.status_code == 404


# Scenario: Claude Code is admin-only
def test_member_gets_403_for_claude_code_and_types_omit_it(
    client: TestClient, second_client: TestClient
) -> None:
    body = {"name": "Sub", "provider_type": "claude-code", "model_name": "sonnet"}
    refused = second_client.post("/api/ai-providers", json=body)
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Only the admin can use the Claude Code provider"
    assert second_client.post("/api/ai-providers/test", json=body).status_code == 403
    member_types = [t["type"] for t in second_client.get("/api/ai-providers/types").json()]
    admin_types = [t["type"] for t in client.get("/api/ai-providers/types").json()]
    assert "claude-code" not in member_types
    assert "claude-code" in admin_types
    assert second_client.get("/api/ai-providers").json() == []
    # A member cannot turn an own provider into a Claude Code one.
    own = add(second_client, "Own")
    assert second_client.put(f"/api/ai-providers/{own}", json=body).status_code == 403


def test_a_claude_code_provider_of_a_member_is_never_resolved(
    client: TestClient, second_client: TestClient
) -> None:
    """Defence in depth: a row that should not exist is treated as not configured."""
    app: Any = client.app
    member_id = user_id_of(app, MEMBER_EMAIL)
    with app.state.session_factory() as session:
        from app.db import AIProvider

        session.add(
            AIProvider(
                id=uuid.uuid4(),
                user_id=member_id,
                name="Sneaky",
                provider_type="claude-code",
                model_name="sonnet",
                config={},
                is_active=True,
            )
        )
        session.commit()
    agent = second_client.get("/api/agents/assistant/provider").json()
    assert agent["effective"] is None and agent["effective_reason"] == "none"
    assert chat(second_client).status_code == 409


# Scenario: the rate limit is per user
def test_rate_limit_is_per_user(client: TestClient, second_client: TestClient) -> None:
    client.app.state.llm_factory = FakeFactory()  # type: ignore[attr-defined]
    add(client, "Admin Claude")
    add(second_client, "Member Claude")
    client.app.state.rate_limiter = RateLimiter(1)  # type: ignore[attr-defined]
    assert chat(client).status_code == 200
    assert chat(client).status_code == 429
    assert chat(second_client).status_code == 200
    assert chat(second_client).status_code == 429


# Scenario: .env providers go to the admin only
def test_env_import_goes_to_the_admin_and_skips_without_one(
    client: TestClient, second_client: TestClient, settings_factory: Any
) -> None:
    from pydantic import SecretStr

    from app.agent.env_import import import_env_providers

    app: Any = client.app
    env_settings = settings_factory(anthropic_api_key=SecretStr("sk-ant-api03-" + "E" * 30))
    with app.state.session_factory() as session:
        assert import_env_providers(session, env_settings, app.state.box) == [
            "Anthropic (from .env)"
        ]
    assert [p["name"] for p in client.get("/api/ai-providers").json()] == ["Anthropic (from .env)"]
    assert second_client.get("/api/ai-providers").json() == []
