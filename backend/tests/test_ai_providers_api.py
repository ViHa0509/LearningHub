"""Spec: ai-providers - the /api/ai-providers API (injected factory, no network)."""

import logging
from typing import Any

import openai
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, text

from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import LLMFactory
from app.agent.messages import Turn
from app.main import create_app
from tests.agent_fakes import (
    FakeFactory,
    fake_resolver,
    openai_answer,
    openai_client,
    status_error,
)
from tests.conftest import TEST_DATABASE_URL

KEY = "sk-test-abcd1234"
BASE = "/api/ai-providers"


def claude(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Claude main",
        "provider_type": "anthropic",
        "model_name": "claude-sonnet-5-5",
        "api_key": KEY,
    }
    body.update(overrides)
    return body


def local(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Local qwen",
        "provider_type": "local",
        "model_name": "qwen3",
        "base_url": "http://localhost:11434/v1",
    }
    body.update(overrides)
    return body


def create(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post(BASE, json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def use_factory(client: TestClient, *turns: Turn | Exception) -> FakeFactory:
    factory = FakeFactory(*turns)
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]
    return factory


def db_rows(sql: str) -> list[Any]:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        rows = list(connection.execute(text(sql)))
    engine.dispose()
    return rows


def errors(response: Any) -> dict[str, str]:
    assert response.status_code == 422, response.text
    return {e["field"]: e["msg"] for e in response.json()["detail"]}


# --- types --------------------------------------------------------------------------


def test_types_describe_parameters_and_presets(client: TestClient) -> None:
    types = {t["type"]: t for t in client.get(f"{BASE}/types").json()}
    assert list(types) == ["openai", "anthropic", "gemini", "local", "custom"]
    anthropic = types["anthropic"]
    assert anthropic["label"] == "Anthropic" and anthropic["needs_key"] is True
    assert {"temperature", "max_tokens", "top_p", "top_k", "stop"} <= set(anthropic["params"])
    assert "frequency_penalty" not in anthropic["params"]
    assert anthropic["models"][0] == {
        "id": "claude-sonnet-5-5",
        "context_window": 200000,
        "max_output": 64000,
    }
    assert {"frequency_penalty", "presence_penalty", "seed", "response_format"} <= set(
        types["gemini"]["params"]
    )
    assert types["local"]["needs_base_url"] is True and types["local"]["needs_key"] is False
    assert types["local"]["default_base_url"] == "http://localhost:11434/v1"
    assert all(t["capabilities"] for t in types.values())


# --- manage configurations ----------------------------------------------------------------


# Scenario: Create and list
def test_create_and_list(client: TestClient) -> None:
    created = create(client, claude())
    listing = client.get(BASE).json()
    assert [p["name"] for p in listing] == ["Claude main"]
    item = listing[0]
    assert item["id"] == created["id"]
    assert (item["provider_type"], item["model_name"], item["is_active"]) == (
        "anthropic",
        "claude-sonnet-5-5",
        True,
    )
    assert (item["key_hint"], item["has_key"]) == ("…1234", True)
    assert item["last_test"] is None and item["last_success_at"] is None
    assert item["used_by"] == [] and item["config"] == {} and item["base_url"] is None
    assert client.get(f"{BASE}/{created['id']}").json() == item


def test_several_configurations_of_one_type(client: TestClient) -> None:
    create(client, claude())
    create(client, claude(name="Claude cheap", model_name="claude-haiku-5-5"))
    assert len(client.get(BASE).json()) == 2


# Scenario: Duplicate name
def test_duplicate_name(client: TestClient) -> None:
    create(client, claude())
    response = client.post(BASE, json=claude(name="  Claude main "))
    assert response.status_code == 409
    assert "already taken" in response.json()["detail"]
    other = create(client, claude(name="Other"))
    rename = client.put(f"{BASE}/{other['id']}", json=claude(name="Claude main", api_key=""))
    assert rename.status_code == 409


# Scenario: Edit keeps the key
def test_edit_keeps_the_key(client: TestClient) -> None:
    factory = use_factory(client, Turn("OK"))
    created = create(client, claude())
    response = client.put(
        f"{BASE}/{created['id']}", json=claude(api_key="", config={"temperature": 0.3})
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["config"] == {"temperature": 0.3}
    assert body["key_hint"] == "…1234"
    without_field = claude(config={"temperature": 0.4})
    del without_field["api_key"]
    assert client.put(f"{BASE}/{created['id']}", json=without_field).json()["key_hint"] == "…1234"
    client.post(f"{BASE}/{created['id']}/test")
    assert factory.built[-1].key == KEY
    assert factory.built[-1].config == {"temperature": 0.4}

    replaced = client.put(f"{BASE}/{created['id']}", json=claude(api_key="sk-new-key-7777"))
    assert replaced.json()["key_hint"] == "…7777"


# Scenario: Deactivate
def test_deactivate_keeps_configuration_and_key(client: TestClient) -> None:
    created = create(client, claude())
    body = client.put(f"{BASE}/{created['id']}", json=claude(api_key=None, is_active=False)).json()
    assert body["is_active"] is False and body["key_hint"] == "…1234"
    agent = client.get("/api/agents/assistant/provider").json()
    assert (agent["effective"], agent["effective_reason"]) == (None, "none")
    client.put(f"{BASE}/{created['id']}", json=claude(api_key=None, is_active=True))
    agent = client.get("/api/agents/assistant/provider").json()
    assert agent["effective"]["name"] == "Claude main"


def test_unknown_id_is_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"{BASE}/{missing}").status_code == 404
    assert client.put(f"{BASE}/{missing}", json=claude()).status_code == 404
    assert client.delete(f"{BASE}/{missing}").status_code == 404
    assert client.post(f"{BASE}/{missing}/test").status_code == 404
    assert client.get(f"{BASE}/{missing}/models").status_code == 404
    assert client.get(f"{BASE}/not-a-uuid").status_code == 422


# --- validation ----------------------------------------------------------------------------


# Scenario: Missing key
def test_missing_key(client: TestClient) -> None:
    body = {"name": "GPT", "provider_type": "openai", "model_name": "gpt-5.5"}
    assert "api_key" in errors(client.post(BASE, json=body))
    assert client.get(BASE).json() == []


# Scenario: Out of range
def test_out_of_range_temperature(client: TestClient) -> None:
    response = client.post(BASE, json=claude(config={"temperature": 3}))
    assert errors(response) == {"temperature": "must be between 0 and 2"}


def test_required_fields_and_types(client: TestClient) -> None:
    found = errors(client.post(BASE, json={"provider_type": "custom", "api_key": ""}))
    assert {"name", "model_name", "base_url"} <= set(found)
    assert "provider_type" in errors(client.post(BASE, json=claude(provider_type="acme")))
    assert "model_name" in errors(client.post(BASE, json=claude(model_name="m; rm -rf")))
    # Wrong JSON types are reported per field too.
    assert "is_active" in errors(client.post(BASE, json=claude(is_active="maybe")))
    assert "config" in errors(client.post(BASE, json=claude(config=[1])))


# Scenario: Unsupported parameter
def test_unsupported_parameter(client: TestClient) -> None:
    response = client.post(BASE, json=claude(config={"frequency_penalty": 0.5}))
    assert errors(response) == {
        "frequency_penalty": "frequency_penalty is not supported by Anthropic"
    }


# Scenario: Metadata address
def test_metadata_address_is_refused(client: TestClient) -> None:
    body = {
        "name": "Sneaky",
        "provider_type": "custom",
        "model_name": "m",
        "base_url": "http://169.254.169.254/v1",
    }
    message = errors(client.post(BASE, json=body))["base_url"]
    assert "private and link-local addresses are only allowed for Local" in message
    assert client.get(BASE).json() == []


# Scenario: Local server
def test_local_server_is_accepted(client: TestClient) -> None:
    created = create(client, local())
    assert created["base_url"] == "http://localhost:11434/v1"
    assert created["has_key"] is False and created["key_hint"] is None


def test_custom_https_public_url_is_accepted(client: TestClient) -> None:
    created = create(
        client,
        {
            "name": "DeepSeek",
            "provider_type": "custom",
            "model_name": "deepseek-chat",
            "base_url": "https://api.deepseek.com",
            "api_key": KEY,
            "config": {"seed": 3, "stop": ["END"], "extra": {"x": 1}},
        },
    )
    assert created["config"] == {"seed": 3, "stop": ["END"], "extra": {"x": 1}}


# --- secrets --------------------------------------------------------------------------------


# Scenario: Key never returned or logged
def test_key_never_returned_or_logged(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    use_factory(client, Turn("OK"))
    created = client.post(BASE, json=claude())
    provider_id = created.json()["id"]
    responses = [
        created,
        client.get(BASE),
        client.get(f"{BASE}/{provider_id}"),
        client.put(f"{BASE}/{provider_id}", json=claude(config={"top_k": 5})),
        client.post(f"{BASE}/{provider_id}/test"),
        client.post(f"{BASE}/test", json=claude(name="unsaved")),
        client.get("/api/agents"),
    ]
    for response in responses:
        assert response.status_code < 300, response.text
        assert KEY not in response.text and "abcd1234" not in response.text
    assert "…1234" in responses[1].text
    stored = db_rows("SELECT api_key_enc, key_hint FROM ai_providers")
    assert len(stored) == 1
    assert KEY not in stored[0].api_key_enc and stored[0].key_hint == "…1234"
    for record in caplog.records:
        assert KEY not in record.getMessage()
        assert KEY not in str(record.__dict__)


# --- connection test --------------------------------------------------------------------------


# Scenario: Success
def test_connection_test_success_is_stored(client: TestClient) -> None:
    factory = use_factory(client, Turn("OK"))
    created = create(client, claude(config={"timeout": 5}))
    result = client.post(f"{BASE}/{created['id']}/test").json()
    assert (result["status"], result["ok"], result["model"]) == ("ok", True, "claude-sonnet-5-5")
    assert result["latency_ms"] >= 0 and "OK" in result["message"] and result["tested_at"]
    assert factory.default.calls[0]["tools"] == []
    assert factory.built[0].config == {"timeout": 5}
    saved = client.get(f"{BASE}/{created['id']}").json()
    assert saved["last_test"]["status"] == "ok"
    assert saved["last_test"]["latency_ms"] == result["latency_ms"]
    assert saved["last_success_at"] is not None


@pytest.mark.parametrize(
    "category", ["auth_failed", "invalid_model", "rate_limited", "timeout", "unavailable"]
)
def test_connection_test_categories(client: TestClient, category: str) -> None:
    use_factory(client, Turn("OK"), ProviderError("provider says no", category))  # type: ignore[arg-type]
    created = create(client, claude())
    assert client.post(f"{BASE}/{created['id']}/test").json()["ok"] is True
    result = client.post(f"{BASE}/{created['id']}/test").json()
    assert (result["status"], result["ok"], result["message"]) == (
        category,
        False,
        "provider says no",
    )
    saved = client.get(f"{BASE}/{created['id']}").json()
    assert saved["last_test"]["status"] == category
    # The earlier success stays as "last successful test".
    assert saved["last_success_at"] is not None


# Scenario: Wrong key (through the real factory and adapter, with a stubbed SDK client)
def test_wrong_key_through_the_real_factory(client: TestClient) -> None:
    error = status_error(openai, "AuthenticationError", 401, "Incorrect API key provided")
    sdk_client, _ = openai_client(error)
    client.app.state.llm_factory = LLMFactory(  # type: ignore[attr-defined]
        resolve=fake_resolver(), openai_client=lambda **_: sdk_client
    )
    created = create(client, {**claude(), "provider_type": "openai", "model_name": "gpt-5.5"})
    result = client.post(f"{BASE}/{created['id']}/test").json()
    assert result["status"] == "auth_failed"
    assert "Incorrect API key" in result["message"]


def test_working_provider_through_the_real_factory(client: TestClient) -> None:
    sdk_client, create_call = openai_client(openai_answer("OK"))
    client.app.state.llm_factory = LLMFactory(  # type: ignore[attr-defined]
        resolve=fake_resolver(), openai_client=lambda **_: sdk_client
    )
    created = create(client, local(config={"temperature": 0.2}))
    assert client.post(f"{BASE}/{created['id']}/test").json()["status"] == "ok"
    assert create_call.kwargs["model"] == "qwen3"
    assert create_call.kwargs["temperature"] == 0.2
    assert "top_p" not in create_call.kwargs


def test_unreadable_key_is_invalid_config(client: TestClient) -> None:
    created = create(client, claude())
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text("UPDATE ai_providers SET api_key_enc = 'garbage'"))
    engine.dispose()
    result = client.post(f"{BASE}/{created['id']}/test").json()
    assert result["status"] == "invalid_config" and "enter it again" in result["message"]


# Scenario: Test before saving
def test_test_before_saving(client: TestClient) -> None:
    factory = use_factory(client, Turn("OK"), Turn("OK"))
    result = client.post(f"{BASE}/test", json=claude(name="", config={"temperature": 0.1}))
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "ok"
    assert client.get(BASE).json() == []
    assert factory.built[0].key == KEY and factory.built[0].config == {"temperature": 0.1}

    created = create(client, claude())
    edited = client.post(
        f"{BASE}/test",
        json={**claude(api_key="", model_name="claude-haiku-5-5"), "provider_id": created["id"]},
    )
    assert edited.json()["model"] == "claude-haiku-5-5"
    assert factory.built[-1].key == KEY
    saved = client.get(f"{BASE}/{created['id']}").json()
    assert saved["model_name"] == "claude-sonnet-5-5" and saved["last_test"] is None


def test_test_before_saving_validates(client: TestClient) -> None:
    use_factory(client)
    no_key = {"provider_type": "openai", "model_name": "gpt-5.5"}
    assert "api_key" in errors(client.post(f"{BASE}/test", json=no_key))
    assert "temperature" in errors(
        client.post(f"{BASE}/test", json=claude(config={"temperature": 9}))
    )


# --- models and information ---------------------------------------------------------------------


# Scenario: Load models
def test_load_models(client: TestClient) -> None:
    factory = use_factory(client)
    created = create(client, local())
    assert client.get(f"{BASE}/{created['id']}/models").json() == {"models": ["m-1", "m-2"]}
    factory.default.models = ProviderError("connection refused", "unavailable")
    failed = client.get(f"{BASE}/{created['id']}/models")
    assert failed.status_code == 502
    assert "unavailable" in failed.json()["detail"]


# Scenario: Never tested
def test_never_tested(client: TestClient) -> None:
    created = create(client, claude())
    assert client.get(f"{BASE}/{created['id']}").json()["last_test"] is None


# --- header guard -----------------------------------------------------------------------------


# Scenario: Missing header
def test_missing_header_is_forbidden(client: TestClient) -> None:
    created = create(client, claude())
    del client.headers["X-LearningHub"]
    pid = created["id"]
    calls = [
        client.post(BASE, json=claude(name="Other")),
        client.put(f"{BASE}/{pid}", json=claude(model_name="claude-haiku-5-5")),
        client.delete(f"{BASE}/{pid}"),
        client.post(f"{BASE}/{pid}/test"),
        client.post(f"{BASE}/test", json=claude()),
        client.put("/api/agents/assistant/provider", json={"primary_provider_id": pid}),
        client.post("/api/agent/chat", json={"messages": [{"role": "user", "content": "hi"}]}),
    ]
    assert [c.status_code for c in calls] == [403] * len(calls)
    wrong = client.post(BASE, json=claude(name="Other"), headers={"X-LearningHub": "yes"})
    assert wrong.status_code == 403
    # Reads stay open; nothing changed.
    listing = client.get(BASE).json()
    assert [(p["name"], p["model_name"]) for p in listing] == [("Claude main", "claude-sonnet-5-5")]
    assert listing[0]["used_by"] == []


# --- delete -----------------------------------------------------------------------------------


# Scenario: Provider in use
def test_delete_in_use_is_refused(client: TestClient) -> None:
    created = create(client, claude())
    client.put("/api/agents/assistant/provider", json={"primary_provider_id": created["id"]})
    response = client.delete(f"{BASE}/{created['id']}")
    assert response.status_code == 409
    body = response.json()
    assert "Learning assistant" in body["detail"]
    assert body["agents"] == [{"id": "assistant", "name": "Learning assistant", "role": "primary"}]
    assert client.get(f"{BASE}/{created['id']}").status_code == 200
    used = client.get(f"{BASE}/{created['id']}").json()["used_by"]
    assert used == [
        {"agent_id": "assistant", "agent_name": "Learning assistant", "role": "primary"}
    ]


def test_delete_unused(client: TestClient) -> None:
    created = create(client, claude())
    response = client.delete(f"{BASE}/{created['id']}")
    assert response.status_code == 204
    assert client.get(f"{BASE}/{created['id']}").status_code == 404
    assert db_rows("SELECT * FROM ai_providers") == []


# --- .env import --------------------------------------------------------------------------------


# Scenario: .env key imported
def test_env_key_imported_once(settings_factory: Any) -> None:
    settings = settings_factory(
        anthropic_api_key=SecretStr("sk-ant-env-key-5678"),
        openai_api_key=SecretStr("   "),
        ollama_url="http://localhost:11434/",
    )
    for _ in range(2):
        app = create_app(settings)
        with TestClient(app) as client:
            listing = client.get(BASE).json()
        app.state.engine.dispose()
    by_name = {p["name"]: p for p in listing}
    assert set(by_name) == {"Anthropic (from .env)", "Ollama (from .env)"}
    anthropic = by_name["Anthropic (from .env)"]
    assert anthropic["is_active"] is True and anthropic["key_hint"] == "…5678"
    assert anthropic["model_name"] == "claude-sonnet-5-5"
    assert by_name["Ollama (from .env)"]["base_url"] == "http://localhost:11434/v1"
    stored = db_rows("SELECT api_key_enc FROM ai_providers WHERE provider_type = 'anthropic'")
    assert "sk-ant-env-key-5678" not in stored[0].api_key_enc
    assert "sk-ant-env-key-5678" not in str(listing)


def test_env_import_does_not_overwrite_an_edited_configuration(settings_factory: Any) -> None:
    settings = settings_factory(deepseek_api_key=SecretStr("sk-deep-1111"))
    app = create_app(settings)
    with TestClient(app, headers={"X-LearningHub": "1"}) as client:
        imported = client.get(BASE).json()[0]
        assert (imported["name"], imported["provider_type"], imported["base_url"]) == (
            "DeepSeek (from .env)",
            "custom",
            "https://api.deepseek.com",
        )
        client.app.state.url_resolver = fake_resolver()  # type: ignore[attr-defined]
        edited = {
            "name": imported["name"],
            "provider_type": "custom",
            "model_name": "deepseek-reasoner",
            "base_url": "https://api.deepseek.com",
        }
        assert client.put(f"{BASE}/{imported['id']}", json=edited).status_code == 200
    app.state.engine.dispose()
    app = create_app(settings)
    with TestClient(app) as client:
        again = client.get(BASE).json()
    app.state.engine.dispose()
    assert [(p["name"], p["model_name"]) for p in again] == [
        ("DeepSeek (from .env)", "deepseek-reasoner")
    ]
