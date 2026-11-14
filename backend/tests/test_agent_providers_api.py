"""Spec: agent-providers and agent-chat - agents, assignment, resolution, fallback, logs."""

import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import LLMFactory
from app.agent.messages import ToolCall, Turn
from app.agent.ratelimit import RateLimiter
from tests.agent_fakes import FakeFactory, fake_resolver, openai_answer, openai_client

KEY = "sk-test-abcd1234"
QUESTION = "what did I write about my-private-topic-xyz?"


def add(client: TestClient, name: str, **overrides: Any) -> str:
    body: dict[str, Any] = {
        "name": name,
        "provider_type": "anthropic",
        "model_name": "claude-sonnet-5-5",
        "api_key": KEY,
    }
    body.update(overrides)
    response = client.post("/api/ai-providers", json=body)
    assert response.status_code == 201, response.text
    provider_id: str = response.json()["id"]
    return provider_id


def add_local(client: TestClient, name: str = "Local qwen") -> str:
    return add(
        client,
        name,
        provider_type="local",
        model_name="qwen3",
        api_key=None,
        base_url="http://127.0.0.1:8002/v1",
    )


def assign(
    client: TestClient, agent_id: str, primary: str | None, fallback: str | None = None
) -> Any:
    return client.put(
        f"/api/agents/{agent_id}/provider",
        json={"primary_provider_id": primary, "fallback_provider_id": fallback},
    )


def chat(client: TestClient, agent_id: str = "assistant", provider_id: str | None = None) -> Any:
    payload: dict[str, Any] = {
        "agent_id": agent_id,
        "messages": [{"role": "user", "content": QUESTION}],
    }
    if provider_id is not None:
        payload["provider_id"] = provider_id
    return client.post("/api/agent/chat", json=payload)


def factory(client: TestClient) -> FakeFactory:
    fake = FakeFactory(Turn("default answer"))
    client.app.state.llm_factory = fake  # type: ignore[attr-defined]
    return fake


def set_active(client: TestClient, provider_id: str, active: bool) -> None:
    current = client.get(f"/api/ai-providers/{provider_id}").json()
    body = {
        "name": current["name"],
        "provider_type": current["provider_type"],
        "model_name": current["model_name"],
        "base_url": current["base_url"],
        "config": current["config"],
        "is_active": active,
    }
    assert client.put(f"/api/ai-providers/{provider_id}", json=body).status_code == 200


# --- agents ------------------------------------------------------------------------


# Scenario: List agents
def test_list_agents(client: TestClient) -> None:
    agents = client.get("/api/agents").json()
    assert [(a["id"], a["name"]) for a in agents] == [
        ("assistant", "Learning assistant"),
        ("lesson-writer", "Lesson writer"),
    ]
    for agent in agents:
        assert agent["description"]
        assert (agent["primary"], agent["fallback"], agent["effective"]) == (None, None, None)
        assert agent["effective_reason"] == "none"

    claude = add(client, "Claude main")
    local = add_local(client)
    body = assign(client, "assistant", claude, local).json()
    assert body["primary"] == {
        "id": claude,
        "name": "Claude main",
        "provider_type": "anthropic",
        "model_name": "claude-sonnet-5-5",
        "is_active": True,
        "last_test_status": None,
    }
    assert body["fallback"]["name"] == "Local qwen"
    assert (body["effective"]["id"], body["effective_reason"]) == (claude, "primary")
    assert client.get("/api/agents/assistant/provider").json() == body
    # The writer has no assignment of its own, so it follows the assistant.
    writer = client.get("/api/agents/lesson-writer/provider").json()
    assert (writer["primary"], writer["effective"]["id"], writer["effective_reason"]) == (
        None,
        claude,
        "assistant",
    )
    assert client.get("/api/agents/nobody/provider").status_code == 404
    assert assign(client, "nobody", claude).status_code == 404


# Scenario: Different providers per agent
def test_different_providers_per_agent(client: TestClient) -> None:
    fake = factory(client)
    claude = add(client, "Claude main")
    local = add_local(client)
    fake.script("Claude main", Turn("from claude"))
    fake.script("Local qwen", Turn("from local"))
    assign(client, "assistant", claude)
    assign(client, "lesson-writer", local)

    answer = chat(client).json()
    assert answer["reply"] == "from claude"
    assert answer["provider"] == {"id": claude, "name": "Claude main", "model": "claude-sonnet-5-5"}
    draft = chat(client, "lesson-writer").json()
    assert draft["reply"] == "from local"
    assert draft["provider"]["name"] == "Local qwen" and draft["fallback_used"] is False
    # The lesson writer gets its own instructions on top of the shared prompt.
    assert "lesson writer" in fake.by_name["Local qwen"].calls[0]["system"]
    assert "lesson writer" not in fake.by_name["Claude main"].calls[0]["system"]
    # ... including the fixed lesson outline (change lesson-template), and only the writer.
    assert "## " in fake.by_name["Local qwen"].calls[0]["system"]
    assert "Key takeaways" in fake.by_name["Local qwen"].calls[0]["system"]
    assert "Key takeaways" not in fake.by_name["Claude main"].calls[0]["system"]
    used = client.get(f"/api/ai-providers/{claude}").json()["used_by"]
    assert used == [
        {"agent_id": "assistant", "agent_name": "Learning assistant", "role": "primary"}
    ]


def test_shared_provider_and_config_change_applies_to_every_agent(client: TestClient) -> None:
    fake = factory(client)
    claude = add(client, "Claude main")
    assign(client, "assistant", claude)
    assign(client, "lesson-writer", claude)
    body = {
        "name": "Claude main",
        "provider_type": "anthropic",
        "model_name": "claude-haiku-5-5",
        "config": {"temperature": 0.1},
    }
    client.put(f"/api/ai-providers/{claude}", json=body)
    chat(client)
    chat(client, "lesson-writer")
    assert [(s.model, s.config) for s in fake.built] == [
        ("claude-haiku-5-5", {"temperature": 0.1}),
        ("claude-haiku-5-5", {"temperature": 0.1}),
    ]


# Scenario: Same provider twice
def test_same_provider_twice_is_refused(client: TestClient) -> None:
    claude = add(client, "Claude main")
    response = assign(client, "assistant", claude, claude)
    assert response.status_code == 422
    assert response.json()["detail"][0]["field"] == "fallback_provider_id"
    assert client.get("/api/agents/assistant/provider").json()["primary"] is None


# Scenario: Unknown provider
def test_unknown_provider_is_refused_and_nothing_changes(client: TestClient) -> None:
    claude = add(client, "Claude main")
    assign(client, "assistant", claude)
    missing = "00000000-0000-0000-0000-000000000000"
    response = assign(client, "assistant", missing)
    assert response.status_code == 404
    assert client.get("/api/agents/assistant/provider").json()["primary"]["id"] == claude
    bad_id = client.put("/api/agents/assistant/provider", json={"primary_provider_id": "x"})
    assert bad_id.status_code == 422


def test_clear_assignment(client: TestClient) -> None:
    claude = add(client, "Claude main")
    local = add_local(client)
    assign(client, "assistant", claude, local)
    cleared = assign(client, "assistant", None, None).json()
    assert (cleared["primary"], cleared["fallback"], cleared["effective_reason"]) == (
        None,
        None,
        "default",
    )
    assert client.delete(f"/api/ai-providers/{claude}").status_code == 204


# --- resolution ---------------------------------------------------------------------------


# Scenario: No assignment
def test_no_assignment_uses_the_only_active_provider(client: TestClient) -> None:
    factory(client)
    add(client, "Claude main")
    answer = chat(client, "lesson-writer").json()
    assert answer["provider"]["name"] == "Claude main"


# Scenario: Unassigned agent follows the assistant
def test_unassigned_agent_uses_the_assistants_primary_and_fallback(client: TestClient) -> None:
    fake = factory(client)
    main = add(client, "Claude main")  # created first: the old default
    sub = add(client, "Claude sub")
    assign(client, "assistant", sub, main)
    fake.script("Claude sub", ProviderError("slow", "timeout"))
    fake.script("Claude main", Turn("from the fallback"))
    answer = chat(client, "lesson-writer").json()
    assert answer["provider"]["name"] == "Claude main"
    assert answer["fallback_used"] is True
    agent = client.get("/api/agents/lesson-writer/provider").json()
    assert (agent["effective"]["id"], agent["effective_reason"]) == (sub, "assistant")


# Scenario: Own assignment wins
def test_own_assignment_wins_over_the_assistants(client: TestClient) -> None:
    factory(client)
    sub = add(client, "Claude sub")
    local = add_local(client)
    assign(client, "assistant", sub)
    assign(client, "lesson-writer", local)
    answer = chat(client, "lesson-writer").json()
    assert answer["provider"]["name"] == "Local qwen"
    agent = client.get("/api/agents/lesson-writer/provider").json()
    assert (agent["effective"]["id"], agent["effective_reason"]) == (local, "primary")


# Scenario: Primary switched off
def test_primary_switched_off_uses_first_active(client: TestClient) -> None:
    fake = factory(client)
    first = add(client, "First active")
    claude = add(client, "Claude main")
    assign(client, "assistant", claude)
    set_active(client, claude, False)
    fake.script("First active", Turn("from first"))
    answer = chat(client).json()
    assert (answer["reply"], answer["provider"]["id"]) == ("from first", first)
    agent = client.get("/api/agents/assistant/provider").json()
    assert (agent["effective"]["id"], agent["effective_reason"]) == (first, "default")


# Scenario: No provider configured
def test_no_active_provider_is_409(client: TestClient) -> None:
    fake = factory(client)
    claude = add(client, "Claude main")
    set_active(client, claude, False)
    response = chat(client)
    assert response.status_code == 409
    assert "Settings" in response.json()["detail"]
    assert fake.built == []


# Scenario: One provider configured
def test_one_provider_answers_and_is_named(client: TestClient) -> None:
    factory(client)
    add(client, "Claude main")
    body = chat(client).json()
    assert body["provider"]["name"] == "Claude main"
    assert body["provider"]["model"] == "claude-sonnet-5-5"
    assert body["fallback_used"] is False


# Scenario: Override for one conversation
def test_override_for_one_conversation(client: TestClient) -> None:
    fake = factory(client)
    claude = add(client, "Claude main")
    local = add_local(client)
    assign(client, "assistant", claude)
    fake.script("Local qwen", Turn("from local"))
    answer = chat(client, provider_id=local).json()
    assert (answer["reply"], answer["provider"]["id"]) == ("from local", local)
    assert client.get("/api/agents/assistant/provider").json()["primary"]["id"] == claude
    assert [s.name for s in fake.built] == ["Local qwen"]


# Scenario: Chat with an unavailable provider
def test_override_switched_off_or_unknown(client: TestClient) -> None:
    fake = factory(client)
    add(client, "Claude main")
    local = add_local(client)
    set_active(client, local, False)
    off = chat(client, provider_id=local)
    assert off.status_code == 409 and "switched off" in off.json()["detail"]
    unknown = chat(client, provider_id="00000000-0000-0000-0000-000000000000")
    assert unknown.status_code == 404
    assert fake.built == []


# --- fallback -------------------------------------------------------------------------------


def with_fallback(client: TestClient) -> tuple[FakeFactory, str, str]:
    fake = factory(client)
    primary = add(client, "Claude main")
    fallback = add_local(client)
    assign(client, "assistant", primary, fallback)
    return fake, primary, fallback


# Scenario: Rate limited primary
def test_rate_limited_primary_falls_back(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="learninghub.llm")
    fake, primary, fallback = with_fallback(client)
    fake.script("Claude main", ProviderError("slow down", "rate_limited"))
    fake.script("Local qwen", Turn("from fallback"))
    answer = chat(client).json()
    assert answer["reply"] == "from fallback"
    assert answer["fallback_used"] is True
    assert answer["provider"] == {"id": fallback, "name": "Local qwen", "model": "qwen3"}
    events = [r for r in caplog.records if r.getMessage() == "llm.fallback"]
    assert len(events) == 1
    event: Any = events[0]
    assert (event.agent_id, event.provider_id, event.fallback_provider_id, event.category) == (
        "assistant",
        primary,
        fallback,
        "rate_limited",
    )


def test_fallback_is_sticky_for_the_rest_of_the_request(client: TestClient) -> None:
    fake, _, _ = with_fallback(client)
    claude = fake.script("Claude main", ProviderError("down", "unavailable"), Turn("never"))
    local = fake.script(
        "Local qwen",
        Turn("", (ToolCall("t1", "list_roadmap", {"domain": "backend"}),)),
        Turn("done"),
    )
    answer = chat(client).json()
    assert (answer["reply"], answer["fallback_used"]) == ("done", True)
    assert len(claude.calls) == 1 and len(local.calls) == 2


# Scenario: Wrong key does not fall back
@pytest.mark.parametrize("category", ["auth_failed", "invalid_model", "invalid_config"])
def test_non_recoverable_errors_do_not_fall_back(client: TestClient, category: str) -> None:
    fake, _, _ = with_fallback(client)
    fake.script("Claude main", ProviderError("refused", category))  # type: ignore[arg-type]
    local = fake.script("Local qwen", Turn("never"))
    response = chat(client)
    assert response.status_code == 502
    assert category in response.json()["detail"] and "Claude main" in response.json()["detail"]
    assert local.calls == []


# Scenario: Both fail
def test_both_fail_names_both(client: TestClient) -> None:
    fake, _, _ = with_fallback(client)
    fake.script("Claude main", ProviderError("no answer in 60 s", "timeout"))
    fake.script("Local qwen", ProviderError("connection refused", "unavailable"))
    response = chat(client)
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "Claude main" in detail and "timeout" in detail
    assert "Local qwen" in detail and "unavailable" in detail


def test_inactive_fallback_is_not_used(client: TestClient) -> None:
    fake, _, fallback = with_fallback(client)
    set_active(client, fallback, False)
    fake.script("Claude main", ProviderError("slow down", "rate_limited"))
    response = chat(client)
    assert response.status_code == 502 and "rate_limited" in response.json()["detail"]


# --- logging ---------------------------------------------------------------------------------


# Scenario: Log records (and: Key never returned or logged)
def test_log_records_carry_fields_and_no_secrets(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    # The real factory and adapter, with a stubbed SDK client: two model calls.
    sdk_client, _ = openai_client(None)
    answers = [
        _tool_call_answer(),
        openai_answer("You wrote one note."),
    ]
    sdk_client.chat.completions.create = lambda **_: answers.pop(0)
    client.app.state.llm_factory = LLMFactory(  # type: ignore[attr-defined]
        resolve=fake_resolver(), openai_client=lambda **_: sdk_client
    )
    provider_id = add(client, "GPT main", provider_type="openai", model_name="gpt-5.5", api_key=KEY)
    response = chat(client)
    assert response.status_code == 200, response.text
    assert response.json()["reply"] == "You wrote one note."

    calls = [r for r in caplog.records if r.getMessage() == "llm.call"]
    assert len(calls) == 2
    for record in calls:
        values: Any = record
        assert values.agent_id == "assistant"
        assert values.provider_id == provider_id
        assert values.provider_type == "openai"
        assert values.model == "gpt-5.5"
        assert isinstance(values.duration_ms, int)
        assert values.category is None
    assert any(r.getMessage() == "llm.provider_init" for r in caplog.records)
    for record in caplog.records:
        dumped = record.getMessage() + str(record.__dict__)
        assert KEY not in dumped
        assert "my-private-topic-xyz" not in dumped
        assert "You wrote one note" not in dumped


def _tool_call_answer() -> Any:
    from types import SimpleNamespace

    call = SimpleNamespace(
        id="c1", function=SimpleNamespace(name="search_notes", arguments='{"query": "topic"}')
    )
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call]))]
    )


def test_failed_call_is_logged_with_category(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="learninghub.llm")
    fake = factory(client)
    add(client, "Claude main")
    fake.script("Claude main", ProviderError("bad key", "auth_failed"))
    chat(client)
    failed: Any = next(r for r in caplog.records if r.getMessage() == "llm.call_failed")
    assert (failed.category, failed.provider_type) == ("auth_failed", "anthropic")


# --- rate limit ---------------------------------------------------------------------------------


# Scenario: Over the limit
def test_chat_over_the_limit_is_429_and_calls_nothing(client: TestClient) -> None:
    fake = factory(client)
    add(client, "Claude main")
    client.app.state.rate_limiter = RateLimiter(2)  # type: ignore[attr-defined]
    assert chat(client).status_code == 200
    assert chat(client).status_code == 200
    third = chat(client)
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) >= 1
    assert "per minute" in third.json()["detail"]
    assert len(fake.default.calls) == 2
