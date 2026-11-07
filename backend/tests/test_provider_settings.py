"""Spec: provider-settings; agent-chat - providers are configured, chat is rate-limited."""

from pathlib import Path
from typing import Any

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, text

from app.agent.messages import ProviderError, Turn
from app.agent.ratelimit import RateLimiter
from app.agent.secrets import SecretBox, SecretUnreadable, load_or_create_key_file
from app.main import create_app
from tests.agent_fakes import FakeProvider
from tests.conftest import TEST_DATABASE_URL

KEY = "sk-ant-api03-abcd1234"
ANTHROPIC = "/api/agent/providers/anthropic"


class Factory:
    """Builds fake providers and records what each was built with."""

    def __init__(self, *turns: Turn | Exception) -> None:
        self.fake = FakeProvider(turns)
        self.built: list[tuple[str, str | None, str | None]] = []

    def __call__(self, provider_id: str, key: str | None, base_url: str | None) -> FakeProvider:
        self.built.append((provider_id, key, base_url))
        return self.fake


def fake_clients(client: TestClient, *turns: Turn | Exception) -> Factory:
    factory = Factory(*turns)
    client.app.state.registry.factory = factory  # type: ignore[attr-defined]
    return factory


def provider(client: TestClient, provider_id: str) -> dict[str, Any]:
    return next(p for p in client.get("/api/agent/providers").json() if p["id"] == provider_id)


def stored_rows() -> list[Any]:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        rows = list(connection.execute(text("SELECT * FROM provider_configs")))
    engine.dispose()
    return rows


def chat(
    client: TestClient, provider_id: str = "anthropic", model: str = "claude-sonnet-5-5"
) -> Any:
    return client.post(
        "/api/agent/chat",
        json={
            "provider": provider_id,
            "model": model,
            "messages": [{"role": "user", "content": "hi"}],
        },
    )


# --- encryption ------------------------------------------------------------------


def test_secret_box_round_trip_and_wrong_key() -> None:
    box = SecretBox(Fernet.generate_key())
    token = box.encrypt(KEY)
    assert KEY not in token
    assert box.decrypt(token) == KEY
    with pytest.raises(SecretUnreadable, match="enter it again"):
        SecretBox(Fernet.generate_key()).decrypt(token)


def test_key_file_is_created_once_and_reused(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "secret.key"
    first = load_or_create_key_file(path)
    assert path.exists()
    assert load_or_create_key_file(path) == first


def test_passphrase_from_settings(settings_factory: Any) -> None:
    a = SecretBox.from_settings(settings_factory(secret_key=SecretStr("my passphrase")))
    b = SecretBox.from_settings(settings_factory(secret_key=SecretStr("my passphrase")))
    assert b.decrypt(a.encrypt("x")) == "x"


# --- Enter a provider key in the app ------------------------------------------------


# Scenario: Paste a key and chat
def test_paste_key_and_chat_without_restart(client: TestClient) -> None:
    factory = fake_clients(client, Turn("Hello from the fake."))
    assert chat(client).status_code == 409

    response = client.put(ANTHROPIC, json={"api_key": f"  {KEY}  "})
    assert response.status_code == 200
    body = response.json()
    assert (body["available"], body["source"], body["key_hint"]) == (True, "app", "…1234")
    assert factory.built == [("anthropic", KEY, None)]

    answer = chat(client)
    assert answer.status_code == 200
    assert answer.json()["reply"] == "Hello from the fake."


# Scenario: Key never returned
def test_key_is_never_returned_and_stored_encrypted(client: TestClient) -> None:
    fake_clients(client)
    put = client.put(ANTHROPIC, json={"api_key": KEY})
    listing = client.get("/api/agent/providers")
    for response in (put, listing):
        assert KEY not in response.text
        assert "abcd1234" not in response.text
    rows = stored_rows()
    assert len(rows) == 1
    assert rows[0].key_hint == "…1234"
    assert KEY not in rows[0].api_key_enc


# Scenario: Change only the model / Custom model id
def test_change_model_keeps_key_and_custom_model_is_listed(client: TestClient) -> None:
    factory = fake_clients(client)
    client.put(ANTHROPIC, json={"api_key": KEY})
    body = client.put(ANTHROPIC, json={"api_key": "", "model": "claude-sonnet-5-5-preview"}).json()
    assert body["model"] == "claude-sonnet-5-5-preview"
    assert "claude-sonnet-5-5-preview" not in body["models"]  # the catalog; the UI adds it
    assert body["key_hint"] == "…1234"
    assert factory.built[-1] == ("anthropic", KEY, None)
    reset = client.put(ANTHROPIC, json={"model": ""}).json()
    assert reset["model"] == "claude-sonnet-5-5"


def test_bad_model_id_is_rejected(client: TestClient) -> None:
    assert client.put(ANTHROPIC, json={"model": "claude; rm -rf"}).status_code == 422


# Scenario: Ollama URL
def test_ollama_url(client: TestClient) -> None:
    factory = fake_clients(client)
    bad = client.put("/api/agent/providers/ollama", json={"base_url": "localhost:11434"})
    assert bad.status_code == 422
    assert "http://" in bad.text
    body = client.put(
        "/api/agent/providers/ollama", json={"base_url": "http://localhost:11434"}
    ).json()
    assert (body["available"], body["base_url"], body["key_hint"]) == (
        True,
        "http://localhost:11434",
        None,
    )
    assert factory.built[-1] == ("ollama", None, "http://localhost:11434")


def test_unknown_provider_is_404(client: TestClient) -> None:
    assert client.put("/api/agent/providers/acme", json={"api_key": "x"}).status_code == 404
    assert client.delete("/api/agent/providers/acme").status_code == 404
    assert client.post("/api/agent/providers/acme/test").status_code == 404


# --- Test a provider with a real call --------------------------------------------------


# Scenario: Working key
def test_connection_test_success(client: TestClient) -> None:
    factory = fake_clients(client, Turn("OK"))
    client.put(ANTHROPIC, json={"api_key": KEY, "model": "claude-haiku-5-5"})
    body = client.post(f"{ANTHROPIC}/test").json()
    assert body["ok"] is True
    assert body["model"] == "claude-haiku-5-5"
    assert body["latency_ms"] >= 0
    assert "OK" in body["message"]
    sent = factory.fake.calls[0]
    assert sent["tools"] == [] and sent["model"] == "claude-haiku-5-5"


# Scenario: Wrong key or model
def test_connection_test_failure_keeps_provider(client: TestClient) -> None:
    fake_clients(client, ProviderError("model: claude-x not found"))
    client.put(ANTHROPIC, json={"api_key": KEY})
    response = client.post(f"{ANTHROPIC}/test")
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "not found" in response.json()["message"]
    assert provider(client, "anthropic")["source"] == "app"


def test_connection_test_needs_configuration(client: TestClient) -> None:
    response = client.post(f"{ANTHROPIC}/test")
    assert response.status_code == 409


# --- Switch off or remove ---------------------------------------------------------------


# Scenario: Switch off
def test_switch_off_keeps_key_and_refuses_chat(client: TestClient) -> None:
    fake_clients(client, Turn("never"))
    client.put(ANTHROPIC, json={"api_key": KEY})
    body = client.put(ANTHROPIC, json={"enabled": False}).json()
    assert (body["available"], body["configured"], body["enabled"]) == (False, True, False)
    refused = chat(client)
    assert refused.status_code == 409
    assert "switched off" in refused.json()["detail"]
    assert client.put(ANTHROPIC, json={"enabled": True}).json()["available"] is True


# Scenario: Remove
def test_remove_app_key(client: TestClient) -> None:
    fake_clients(client)
    client.put(ANTHROPIC, json={"api_key": KEY})
    body = client.delete(ANTHROPIC).json()
    assert (body["configured"], body["source"]) == (False, None)
    assert stored_rows() == []


# --- App settings win over backend/.env ---------------------------------------------------


def env_app(settings_factory: Any) -> tuple[TestClient, Any]:
    app = create_app(settings_factory(openai_api_key=SecretStr("sk-env-key-9999")))
    return TestClient(app), app


# Scenario: Both sources / Only backend/.env
def test_app_key_overrides_env_and_remove_falls_back(settings_factory: Any) -> None:
    client, app = env_app(settings_factory)
    with client:
        factory = fake_clients(client)
        only_env = provider(client, "openai")
        assert (only_env["source"], only_env["key_hint"], only_env["overrides_env"]) == (
            "env",
            "…9999",
            False,
        )
        assert "sk-env-key-9999" not in client.get("/api/agent/providers").text

        body = client.put("/api/agent/providers/openai", json={"api_key": "sk-app-key-5555"}).json()
        assert (body["source"], body["overrides_env"], body["key_hint"]) == ("app", True, "…5555")
        assert factory.built[-1] == ("openai", "sk-app-key-5555", None)

        back = client.delete("/api/agent/providers/openai").json()
        assert (back["source"], back["key_hint"]) == ("env", "…9999")
        assert factory.built[-1] == ("openai", "sk-env-key-9999", None)
    app.state.engine.dispose()


def test_unreadable_saved_key_is_reported(client: TestClient, settings_factory: Any) -> None:
    fake_clients(client)
    client.put(ANTHROPIC, json={"api_key": KEY})
    # Another secret: the stored token can no longer be decrypted.
    app = create_app(settings_factory(secret_key=SecretStr("a different passphrase")))
    with TestClient(app) as other:
        body = provider(other, "anthropic")
    app.state.engine.dispose()
    assert body["available"] is False
    assert "enter it again" in body["key_error"]


# --- Rate limit -------------------------------------------------------------------------------


def test_rate_limiter_window() -> None:
    now = [0.0]
    limiter = RateLimiter(2, clock=lambda: now[0])
    assert limiter.acquire() is None
    assert limiter.acquire() is None
    now[0] = 10.0
    assert limiter.acquire() == 50
    now[0] = 60.5
    assert limiter.acquire() is None


# Scenario: Over the limit
def test_chat_over_the_limit_is_429_and_calls_nothing(client: TestClient) -> None:
    factory = fake_clients(client, Turn("one"), Turn("two"), Turn("three"))
    client.put(ANTHROPIC, json={"api_key": KEY})
    client.app.state.rate_limiter = RateLimiter(2)  # type: ignore[attr-defined]
    assert chat(client).status_code == 200
    assert chat(client).status_code == 200
    third = chat(client)
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) >= 1
    assert "per minute" in third.json()["detail"]
    assert len(factory.fake.calls) == 2
