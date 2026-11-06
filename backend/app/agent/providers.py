"""LLM providers behind one interface.

Each adapter translates the neutral messages and tool specs to its API and the
answer back into a ``Turn``. Clients are injected so tests never touch the network.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import anthropic
import openai
from pydantic import SecretStr

from app.agent.messages import Message, ProviderError, ToolCall, ToolSpec, Turn
from app.config import Settings

MAX_TOKENS = 2048


class ChatProvider(Protocol):
    def complete(
        self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec], model: str
    ) -> Turn: ...


@dataclass(frozen=True)
class ProviderInfo:
    id: str
    label: str
    setting: str
    models: tuple[str, ...]
    default_model: str


# Model ids other than Anthropic's are not verified on the dev machine (no keys yet).
CATALOG: tuple[ProviderInfo, ...] = (
    ProviderInfo(
        "anthropic",
        "Anthropic (Claude)",
        "LH_ANTHROPIC_API_KEY",
        ("claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"),
        "claude-sonnet-5-5",
    ),
    ProviderInfo("openai", "OpenAI", "LH_OPENAI_API_KEY", ("gpt-5.5", "gpt-5.5-mini"), "gpt-5.5"),
    ProviderInfo(
        "deepseek", "DeepSeek", "LH_DEEPSEEK_API_KEY", ("deepseek-chat",), "deepseek-chat"
    ),
    ProviderInfo("ollama", "Local (Ollama, Gemma)", "LH_OLLAMA_URL", ("gemma3",), "gemma3"),
)


# --- Anthropic ---------------------------------------------------------------


def to_anthropic_messages(messages: Sequence[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        if m.role == "user":
            out.append({"role": "user", "content": m.text})
        elif m.role == "assistant":
            content: list[dict[str, Any]] = []
            if m.text:
                content.append({"type": "text", "text": m.text})
            for call in m.tool_calls:
                content.append(
                    {"type": "tool_use", "id": call.id, "name": call.name, "input": call.input}
                )
            out.append({"role": "assistant", "content": content or m.text or "(no text)"})
        else:
            block = {"type": "tool_result", "tool_use_id": m.tool_call_id, "content": m.text}
            previous = out[-1] if out else None
            # Results of one assistant turn go back together in a single user message.
            if (
                previous is not None
                and previous["role"] == "user"
                and isinstance(previous["content"], list)
            ):
                previous["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
    return out


def to_anthropic_tools(tools: Sequence[ToolSpec]) -> list[dict[str, Any]]:
    return [
        {"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools
    ]


def from_anthropic(response: Any) -> Turn:
    texts: list[str] = []
    calls: list[ToolCall] = []
    for block in response.content:
        if block.type == "text":
            texts.append(block.text)
        elif block.type == "tool_use":
            calls.append(ToolCall(id=block.id, name=block.name, input=dict(block.input or {})))
    return Turn(text="\n".join(texts).strip(), tool_calls=tuple(calls))


class AnthropicProvider:
    def __init__(self, client: Any) -> None:
        self._client = client

    def complete(
        self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec], model: str
    ) -> Turn:
        try:
            response = self._client.messages.create(
                model=model,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=to_anthropic_messages(messages),
                tools=to_anthropic_tools(tools),
            )
        except anthropic.AnthropicError as exc:
            raise ProviderError(str(exc)) from exc
        return from_anthropic(response)


# --- OpenAI-compatible (OpenAI, DeepSeek, Ollama) ----------------------------


def to_openai_messages(system: str, messages: Sequence[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for m in messages:
        if m.role == "user":
            out.append({"role": "user", "content": m.text})
        elif m.role == "assistant":
            entry: dict[str, Any] = {"role": "assistant", "content": m.text or None}
            if m.tool_calls:
                entry["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": json.dumps(call.input)},
                    }
                    for call in m.tool_calls
                ]
            out.append(entry)
        else:
            out.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.text})
    return out


def to_openai_tools(tools: Sequence[ToolSpec]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
        }
        for t in tools
    ]


def from_openai(response: Any) -> Turn:
    message = response.choices[0].message
    calls: list[ToolCall] = []
    for call in message.tool_calls or []:
        try:
            arguments = json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError:
            arguments = {"_unparsed_arguments": call.function.arguments}
        if not isinstance(arguments, dict):
            arguments = {"_unparsed_arguments": call.function.arguments}
        calls.append(ToolCall(id=call.id, name=call.function.name, input=arguments))
    return Turn(text=(message.content or "").strip(), tool_calls=tuple(calls))


class OpenAICompatibleProvider:
    def __init__(self, client: Any) -> None:
        self._client = client

    def complete(
        self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec], model: str
    ) -> Turn:
        try:
            response = self._client.chat.completions.create(
                model=model,
                messages=to_openai_messages(system, messages),
                tools=to_openai_tools(tools),
            )
        except openai.OpenAIError as exc:
            raise ProviderError(str(exc)) from exc
        return from_openai(response)


# --- Registry -----------------------------------------------------------------


def _secret(value: SecretStr | None) -> str | None:
    """The key, or None when unset or blank (an empty LH_*_API_KEY means not configured)."""
    text = value.get_secret_value().strip() if value is not None else ""
    return text or None


def build_providers(settings: Settings) -> dict[str, ChatProvider]:
    """Providers whose key or URL is configured. Creating a client makes no request."""
    providers: dict[str, ChatProvider] = {}
    if key := _secret(settings.anthropic_api_key):
        providers["anthropic"] = AnthropicProvider(anthropic.Anthropic(api_key=key))
    if key := _secret(settings.openai_api_key):
        providers["openai"] = OpenAICompatibleProvider(openai.OpenAI(api_key=key))
    if key := _secret(settings.deepseek_api_key):
        providers["deepseek"] = OpenAICompatibleProvider(
            openai.OpenAI(api_key=key, base_url="https://api.deepseek.com")
        )
    if settings.ollama_url and settings.ollama_url.strip():
        providers["ollama"] = OpenAICompatibleProvider(
            openai.OpenAI(api_key="ollama", base_url=settings.ollama_url.rstrip("/") + "/v1")
        )
    return providers
