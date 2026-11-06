"""Spec: agent-chat - Providers are configured on the backend (adapters and listing)."""

import json
from types import SimpleNamespace
from typing import Any

import anthropic
import openai
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.agent.messages import Message, ProviderError, ToolCall, ToolSpec
from app.agent.providers import (
    AnthropicProvider,
    OpenAICompatibleProvider,
    build_providers,
    to_anthropic_messages,
    to_openai_messages,
)
from app.config import Settings
from app.main import create_app

TOOL = ToolSpec("search_notes", "Search notes.", {"type": "object", "properties": {}})
CONVERSATION = [
    Message(role="user", text="what about redis?"),
    Message(
        role="assistant",
        text="Let me look.",
        tool_calls=(
            ToolCall("c1", "search_notes", {"query": "redis"}),
            ToolCall("c2", "read_lesson", {"node_id": "backend/redis"}),
        ),
    ),
    Message(role="tool", text='{"notes": []}', tool_call_id="c1"),
    Message(role="tool", text='{"body": ""}', tool_call_id="c2"),
]


class Recorder:
    """Stands in for an SDK method: records kwargs, returns or raises a canned value."""

    def __init__(self, result: Any) -> None:
        self.result = result
        self.kwargs: dict[str, Any] = {}

    def __call__(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def anthropic_client(result: Any) -> tuple[Any, Recorder]:
    create = Recorder(result)
    return SimpleNamespace(messages=SimpleNamespace(create=create)), create


def openai_client(result: Any) -> tuple[Any, Recorder]:
    create = Recorder(result)
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))), create


def test_anthropic_groups_tool_results_into_one_user_message() -> None:
    out = to_anthropic_messages(CONVERSATION)
    assert [m["role"] for m in out] == ["user", "assistant", "user"]
    assert out[1]["content"] == [
        {"type": "text", "text": "Let me look."},
        {"type": "tool_use", "id": "c1", "name": "search_notes", "input": {"query": "redis"}},
        {
            "type": "tool_use",
            "id": "c2",
            "name": "read_lesson",
            "input": {"node_id": "backend/redis"},
        },
    ]
    assert [b["tool_use_id"] for b in out[2]["content"]] == ["c1", "c2"]


def test_anthropic_request_and_answer() -> None:
    response = SimpleNamespace(
        content=[
            SimpleNamespace(type="text", text="Searching."),
            SimpleNamespace(type="tool_use", id="t9", name="search_notes", input={"query": "ttl"}),
        ]
    )
    client, create = anthropic_client(response)
    turn = AnthropicProvider(client).complete("SYS", CONVERSATION[:1], [TOOL], "claude-sonnet-5-5")
    assert create.kwargs["system"] == "SYS"
    assert create.kwargs["model"] == "claude-sonnet-5-5"
    assert create.kwargs["tools"] == [
        {"name": "search_notes", "description": "Search notes.", "input_schema": TOOL.parameters}
    ]
    assert turn.text == "Searching."
    assert turn.tool_calls == (ToolCall("t9", "search_notes", {"query": "ttl"}),)


def test_anthropic_error_becomes_provider_error() -> None:
    client, _ = anthropic_client(anthropic.AnthropicError("invalid x-api-key"))
    with pytest.raises(ProviderError, match="invalid x-api-key"):
        AnthropicProvider(client).complete("SYS", CONVERSATION[:1], [TOOL], "m")


def test_openai_messages_carry_system_tool_calls_and_results() -> None:
    out = to_openai_messages("SYS", CONVERSATION)
    assert out[0] == {"role": "system", "content": "SYS"}
    assert out[2]["tool_calls"][0] == {
        "id": "c1",
        "type": "function",
        "function": {"name": "search_notes", "arguments": json.dumps({"query": "redis"})},
    }
    assert out[3] == {"role": "tool", "tool_call_id": "c1", "content": '{"notes": []}'}
    assert out[4]["tool_call_id"] == "c2"


def test_openai_request_and_answer_with_bad_arguments() -> None:
    call = SimpleNamespace(
        id="x1", function=SimpleNamespace(name="read_note", arguments="{not json")
    )
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call]))]
    )
    client, create = openai_client(response)
    turn = OpenAICompatibleProvider(client).complete("SYS", CONVERSATION[:1], [TOOL], "gpt-5.5")
    assert create.kwargs["tools"][0]["function"]["name"] == "search_notes"
    assert turn.text == ""
    assert turn.tool_calls == (ToolCall("x1", "read_note", {"_unparsed_arguments": "{not json"}),)


def test_openai_error_becomes_provider_error() -> None:
    client, _ = openai_client(openai.OpenAIError("rate limited"))
    with pytest.raises(ProviderError, match="rate limited"):
        OpenAICompatibleProvider(client).complete("SYS", CONVERSATION[:1], [TOOL], "m")


def test_build_providers_only_for_configured_settings(settings_factory: Any) -> None:
    assert build_providers(settings_factory()) == {}
    configured = build_providers(
        settings_factory(anthropic_api_key=SecretStr("sk-a"), ollama_url="http://localhost:11434/")
    )
    assert set(configured) == {"anthropic", "ollama"}


# Scenario: No provider configured
def test_list_providers_none_available(client: TestClient) -> None:
    body = client.get("/api/agent/providers").json()
    assert [p["id"] for p in body] == ["anthropic", "openai", "deepseek", "ollama"]
    assert not any(p["available"] for p in body)
    assert {p["setting"] for p in body} == {
        "LH_ANTHROPIC_API_KEY",
        "LH_OPENAI_API_KEY",
        "LH_DEEPSEEK_API_KEY",
        "LH_OLLAMA_URL",
    }


# Scenario: One provider configured
def test_list_providers_one_available_without_key(settings_factory: Any) -> None:
    settings: Settings = settings_factory(anthropic_api_key=SecretStr("sk-ant-secret-123"))
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/api/agent/providers")
    app.state.engine.dispose()
    body = {p["id"]: p for p in response.json()}
    assert body["anthropic"]["available"] is True
    assert body["anthropic"]["default_model"] == "claude-sonnet-5-5"
    assert "claude-haiku-5-5" in body["anthropic"]["models"]
    assert not any(body[p]["available"] for p in ("openai", "deepseek", "ollama"))
    assert "sk-ant-secret-123" not in response.text
