"""Chat models behind one interface, bound to a model, its parameters and a client.

Each adapter translates the neutral messages and tool specs to its API and the answer
back into a ``Turn``. Clients are injected so tests never touch the network.
"""

import json
from collections.abc import Callable, Sequence
from typing import Any

import anthropic
import openai

from app.agent.llm.errors import ProviderError, classify_anthropic, classify_openai
from app.agent.messages import Message, ToolCall, ToolSpec, Turn

ANTHROPIC_DEFAULT_MAX_TOKENS = 2048

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


def anthropic_params(config: dict[str, Any]) -> dict[str, Any]:
    """The request parameters for a configuration: only those set, max_tokens always."""
    params: dict[str, Any] = {
        "max_tokens": config.get("max_tokens") or ANTHROPIC_DEFAULT_MAX_TOKENS
    }
    for name in ("temperature", "top_p", "top_k"):
        if config.get(name) is not None:
            params[name] = config[name]
    if config.get("stop"):
        params["stop_sequences"] = list(config["stop"])
    if config.get("extra"):
        params["extra_body"] = dict(config["extra"])
    return params


# --- OpenAI-compatible (OpenAI, Gemini, Local, Custom) -----------------------


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


OPENAI_PLAIN = ("temperature", "top_p", "max_tokens", "frequency_penalty", "presence_penalty")


def openai_params(config: dict[str, Any]) -> dict[str, Any]:
    """The request parameters for a configuration: only those set."""
    params: dict[str, Any] = {}
    for name in OPENAI_PLAIN:
        if config.get(name) is not None:
            params[name] = config[name]
    if config.get("stop"):
        params["stop"] = list(config["stop"])
    if config.get("seed") is not None:
        params["seed"] = config["seed"]
    if config.get("response_format") == "json":
        params["response_format"] = {"type": "json_object"}
    if config.get("extra"):
        params["extra_body"] = dict(config["extra"])
    return params


# --- Adapters ------------------------------------------------------------------


class _Adapter:
    def __init__(
        self,
        client: Any,
        model: str,
        config: dict[str, Any],
        secret: str | None,
        classify: Callable[[Exception], ProviderError],
        sdk_error: type[Exception],
    ) -> None:
        self._client = client
        self.model = model
        self._config = dict(config)
        self._secret = secret
        self._classify = classify
        self._sdk_error = sdk_error

    def _error(self, exc: Exception) -> ProviderError:
        error = self._classify(exc)
        text = str(error)
        if self._secret and self._secret in text:
            # Some providers echo the key they refused; never pass it on.
            error = ProviderError(text.replace(self._secret, "(key)"), error.category)
        return error

    def _call(self, fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except self._sdk_error as exc:
            raise self._error(exc) from exc

    def list_models(self) -> list[str]:
        page = self._call(lambda: list(self._client.models.list()))
        return sorted({str(m.id) for m in page})


class AnthropicChat(_Adapter):
    def __init__(
        self, client: Any, model: str, config: dict[str, Any], secret: str | None = None
    ) -> None:
        super().__init__(
            client, model, config, secret, classify_anthropic, anthropic.AnthropicError
        )

    def request(
        self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "system": system,
            "messages": to_anthropic_messages(messages),
            **anthropic_params(self._config),
        }
        if tools:
            kwargs["tools"] = to_anthropic_tools(tools)
        return kwargs

    def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> Turn:
        kwargs = self.request(system, messages, tools)
        response = self._call(lambda: self._client.messages.create(**kwargs))
        return from_anthropic(response)


class OpenAICompatibleChat(_Adapter):
    def __init__(
        self, client: Any, model: str, config: dict[str, Any], secret: str | None = None
    ) -> None:
        super().__init__(client, model, config, secret, classify_openai, openai.OpenAIError)

    def request(
        self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": to_openai_messages(system, messages),
            **openai_params(self._config),
        }
        if tools:
            kwargs["tools"] = to_openai_tools(tools)
        return kwargs

    def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> Turn:
        kwargs = self.request(system, messages, tools)
        response = self._call(lambda: self._client.chat.completions.create(**kwargs))
        try:
            return from_openai(response)
        except (AttributeError, IndexError, TypeError) as exc:
            raise ProviderError(
                "the provider sent an answer in an unexpected format", "unavailable"
            ) from exc
