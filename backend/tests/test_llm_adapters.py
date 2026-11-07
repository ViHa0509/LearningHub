"""Spec: ai-providers - adapters and the LLM factory (stubbed SDK clients, no network)."""

import json
from types import SimpleNamespace
from typing import Any

import anthropic
import openai
import pytest

from app.agent.llm.adapters import (
    AnthropicChat,
    OpenAICompatibleChat,
    to_anthropic_messages,
    to_openai_messages,
)
from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import LLMFactory, ProviderSettings
from app.agent.messages import Message, ToolCall, ToolSpec
from tests.agent_fakes import (
    anthropic_answer,
    anthropic_client,
    fake_resolver,
    openai_answer,
    openai_client,
    status_error,
    timeout_error,
)

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
KEY = "sk-test-abcd1234"


# --- translation (unchanged behavior) ---------------------------------------------------


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
    turn = AnthropicChat(client, "claude-sonnet-5-5", {}).complete("SYS", CONVERSATION[:1], [TOOL])
    assert create.kwargs["system"] == "SYS"
    assert create.kwargs["model"] == "claude-sonnet-5-5"
    assert create.kwargs["tools"] == [
        {"name": "search_notes", "description": "Search notes.", "input_schema": TOOL.parameters}
    ]
    assert turn.text == "Searching."
    assert turn.tool_calls == (ToolCall("t9", "search_notes", {"query": "ttl"}),)


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
    turn = OpenAICompatibleChat(client, "gpt-5.5", {}).complete("SYS", CONVERSATION[:1], [TOOL])
    assert create.kwargs["tools"][0]["function"]["name"] == "search_notes"
    assert turn.text == ""
    assert turn.tool_calls == (ToolCall("x1", "read_note", {"_unparsed_arguments": "{not json"}),)


# --- parameters sent ---------------------------------------------------------------------


# Scenario: Unset parameters are not sent
def test_openai_sends_only_set_parameters() -> None:
    client, create = openai_client(openai_answer("hi"))
    OpenAICompatibleChat(client, "gpt-5.5", {"temperature": 0.2}).complete(
        "SYS", CONVERSATION[:1], []
    )
    assert set(create.kwargs) == {"model", "messages", "temperature"}
    assert create.kwargs["temperature"] == 0.2


def test_openai_sends_every_supported_parameter() -> None:
    config = {
        "temperature": 0.5,
        "max_tokens": 300,
        "top_p": 0.9,
        "frequency_penalty": 0.1,
        "presence_penalty": -0.1,
        "stop": ["END"],
        "seed": 42,
        "response_format": "json",
        "timeout": 5,
        "context_window": 8000,
        "extra": {"reasoning_effort": "low"},
    }
    client, create = openai_client(openai_answer("hi"))
    OpenAICompatibleChat(client, "gpt-5.5", config).complete("SYS", CONVERSATION[:1], [TOOL])
    sent = dict(create.kwargs)
    assert {k: sent[k] for k in sent if k not in ("messages", "tools")} == {
        "model": "gpt-5.5",
        "temperature": 0.5,
        "max_tokens": 300,
        "top_p": 0.9,
        "frequency_penalty": 0.1,
        "presence_penalty": -0.1,
        "stop": ["END"],
        "seed": 42,
        "response_format": {"type": "json_object"},
        "extra_body": {"reasoning_effort": "low"},
    }


def test_openai_text_response_format_is_not_sent() -> None:
    client, create = openai_client(openai_answer("hi"))
    OpenAICompatibleChat(client, "m", {"response_format": "text"}).complete("S", [], [])
    assert "response_format" not in create.kwargs


def test_anthropic_sends_only_set_parameters_and_a_default_max_tokens() -> None:
    client, create = anthropic_client(anthropic_answer("hi"))
    AnthropicChat(client, "claude-sonnet-5-5", {"temperature": 0.2}).complete(
        "SYS", CONVERSATION[:1], []
    )
    assert set(create.kwargs) == {"model", "system", "messages", "max_tokens", "temperature"}
    assert create.kwargs["max_tokens"] == 2048
    assert create.kwargs["temperature"] == 0.2


def test_anthropic_sends_every_supported_parameter() -> None:
    config = {
        "temperature": 1.0,
        "max_tokens": 500,
        "top_p": 0.8,
        "top_k": 40,
        "stop": ["###"],
        "timeout": 10,
        "extra": {"metadata": {"user_id": "u"}},
    }
    client, create = anthropic_client(anthropic_answer("hi"))
    AnthropicChat(client, "claude-sonnet-5-5", config).complete("SYS", CONVERSATION[:1], [])
    sent = {k: v for k, v in create.kwargs.items() if k not in ("messages", "system")}
    assert sent == {
        "model": "claude-sonnet-5-5",
        "max_tokens": 500,
        "temperature": 1.0,
        "top_p": 0.8,
        "top_k": 40,
        "stop_sequences": ["###"],
        "extra_body": {"metadata": {"user_id": "u"}},
    }


# --- errors and model listing ---------------------------------------------------------------


def test_adapter_errors_are_classified_and_never_carry_the_key() -> None:
    error = status_error(openai, "AuthenticationError", 401, f"Incorrect API key provided: {KEY}")
    client, _ = openai_client(error)
    with pytest.raises(ProviderError) as caught:
        OpenAICompatibleChat(client, "m", {}, KEY).complete("S", [], [])
    assert caught.value.category == "auth_failed"
    assert KEY not in str(caught.value)

    client, _ = anthropic_client(timeout_error(anthropic))
    with pytest.raises(ProviderError) as timed_out:
        AnthropicChat(client, "m", {}, KEY).complete("S", [], [])
    assert timed_out.value.category == "timeout"


def test_list_models() -> None:
    page = [SimpleNamespace(id="b-model"), SimpleNamespace(id="a-model")]
    client = SimpleNamespace(models=SimpleNamespace(list=lambda: iter(page)))
    assert OpenAICompatibleChat(client, "m", {}).list_models() == ["a-model", "b-model"]
    assert AnthropicChat(client, "m", {}).list_models() == ["a-model", "b-model"]

    def refuse() -> Any:
        raise status_error(openai, "AuthenticationError", 401)

    broken = SimpleNamespace(models=SimpleNamespace(list=refuse))
    with pytest.raises(ProviderError) as caught:
        OpenAICompatibleChat(broken, "m", {}).list_models()
    assert caught.value.category == "auth_failed"


# --- factory --------------------------------------------------------------------------------


class ClientSpy:
    """Stands in for an SDK client class: records constructor kwargs."""

    def __init__(self) -> None:
        self.kwargs: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> Any:
        self.kwargs.append(kwargs)
        client, _ = openai_client(openai_answer("ok"))
        return client


def factory() -> tuple[LLMFactory, ClientSpy, ClientSpy]:
    anth, oai = ClientSpy(), ClientSpy()
    resolve = fake_resolver({"internal.example.com": "10.0.0.1"})
    return LLMFactory(resolve=resolve, anthropic_client=anth, openai_client=oai), anth, oai


def settings(provider_type: str, **values: Any) -> ProviderSettings:
    base: dict[str, Any] = {"id": None, "name": "x", "type": provider_type, "model": "m"}
    base.update(values)
    return ProviderSettings(**base)


def test_factory_builds_anthropic_with_timeout_and_no_retries() -> None:
    f, anth, oai = factory()
    model = f.create(settings("anthropic", key=KEY, config={"timeout": 12}))
    assert isinstance(model, AnthropicChat)
    assert anth.kwargs == [{"api_key": KEY, "timeout": 12.0, "max_retries": 0}]
    assert oai.kwargs == []


@pytest.mark.parametrize(
    ("provider_type", "key", "base_url", "expected_key", "expected_url"),
    [
        ("openai", KEY, None, KEY, "https://api.openai.com/v1"),
        (
            "gemini",
            KEY,
            None,
            KEY,
            "https://generativelanguage.googleapis.com/v1beta/openai/",
        ),
        ("local", None, "http://127.0.0.1:8002/v1", "local", "http://127.0.0.1:8002/v1"),
        ("custom", None, "https://api.deepseek.com", "not-needed", "https://api.deepseek.com"),
        ("custom", KEY, "https://api.deepseek.com", KEY, "https://api.deepseek.com"),
    ],
)
def test_factory_builds_openai_compatible_clients(
    provider_type: str, key: str | None, base_url: str | None, expected_key: str, expected_url: str
) -> None:
    f, _, oai = factory()
    model = f.create(settings(provider_type, key=key, base_url=base_url))
    assert isinstance(model, OpenAICompatibleChat)
    assert oai.kwargs == [
        {"api_key": expected_key, "base_url": expected_url, "timeout": 60.0, "max_retries": 0}
    ]


def test_factory_refuses_invalid_settings_before_building_a_client() -> None:
    f, anth, oai = factory()
    cases = [
        settings("openai"),  # no key
        settings("local"),  # no base URL
        settings("custom", base_url="https://internal.example.com/v1"),  # SSRF re-check
        settings("nonsense"),
    ]
    for case in cases:
        with pytest.raises(ProviderError) as caught:
            f.create(case)
        assert caught.value.category == "invalid_config"
    assert anth.kwargs == [] and oai.kwargs == []


def test_settings_repr_hides_the_key() -> None:
    assert KEY not in repr(settings("openai", key=KEY))
