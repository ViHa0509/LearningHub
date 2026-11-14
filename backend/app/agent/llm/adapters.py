"""Chat models behind one interface, bound to a model, its parameters and a client.

Each adapter translates the neutral messages and tool specs to its API and the answer
back into a ``Turn``. Clients are injected so tests never touch the network.
"""

import json
from collections.abc import Callable, Sequence
from functools import partial
from typing import Any

import anthropic
import openai

from app.agent.llm.errors import ProviderError, classify_anthropic, classify_openai
from app.agent.messages import Message, ToolCall, ToolSpec, Turn

ANTHROPIC_DEFAULT_MAX_TOKENS = 2048
# Anthropic's own web search (a server tool: it runs at Anthropic, results come back as blocks).
WEB_SEARCH_MAX_USES = 5
# The dynamic-filtering version needs a recent model; older models take the basic one.
_WEB_SEARCH_NEW = (
    "claude-fable",
    "claude-mythos",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
)
MAX_PAUSED_TURNS = 3


def web_search_tool(model: str) -> dict[str, Any]:
    version = "web_search_20260209" if model.startswith(_WEB_SEARCH_NEW) else "web_search_20250305"
    return {"type": version, "name": "web_search", "max_uses": WEB_SEARCH_MAX_USES}


# --- Anthropic ---------------------------------------------------------------


def to_anthropic_messages(messages: Sequence[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        if m.role == "user":
            out.append({"role": "user", "content": m.text})
        elif m.role == "assistant" and m.raw:
            # Server tool blocks (web search) go back exactly as the API returned them.
            out.append({"role": "assistant", "content": [dict(b) for b in m.raw]})
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


def _block_dict(block: Any) -> dict[str, Any]:
    """A response block as request JSON (SDK models dump themselves; test doubles are plain)."""
    if hasattr(block, "model_dump"):
        dumped: dict[str, Any] = block.model_dump(mode="json", exclude_none=True)
        return dumped

    def plain(value: Any) -> Any:
        if isinstance(value, list):
            return [plain(v) for v in value]
        if hasattr(value, "__dict__"):
            return {k: plain(v) for k, v in vars(value).items() if v is not None}
        return value

    result: dict[str, Any] = plain(block)
    return result


def from_anthropic(response: Any) -> Turn:
    texts: list[str] = []
    calls: list[ToolCall] = []
    searches: list[str] = []
    sources: list[tuple[str, str]] = []
    server_blocks = False
    for block in response.content:
        if block.type == "text":
            texts.append(block.text)
        elif block.type == "tool_use":
            calls.append(ToolCall(id=block.id, name=block.name, input=dict(block.input or {})))
        elif block.type == "server_tool_use":
            server_blocks = True
            query = (getattr(block, "input", None) or {}).get("query")
            if block.name == "web_search" and query:
                searches.append(str(query))
        elif block.type == "web_search_tool_result":
            server_blocks = True
            # A list of results on success; an error object otherwise (it does not raise).
            if isinstance(block.content, list):
                for found in block.content:
                    url = getattr(found, "url", None)
                    if url and all(url != u for _, u in sources):
                        sources.append((str(getattr(found, "title", "") or url), str(url)))
        elif block.type in ("thinking", "redacted_thinking"):
            server_blocks = True  # kept in raw, so a later request can send it back unchanged
    raw = tuple(_block_dict(b) for b in response.content) if server_blocks else ()
    return Turn(
        text="\n".join(texts).strip(),
        tool_calls=tuple(calls),
        searches=tuple(searches),
        sources=tuple(sources),
        raw=raw,
    )


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
        # Prompt caching: the tools, system prompt and conversation so far are read from the
        # cache on the next call (each tool step of a run, the next message within minutes).
        # A prefix below the model's minimum is simply not cached. Off with "prompt_cache": false.
        if self._config.get("prompt_cache", True) is not False:
            kwargs["cache_control"] = {"type": "ephemeral"}
        return kwargs

    # The agent's Internet search switch works with this adapter (Anthropic's web search tool).
    supports_web_search = True

    def complete(
        self,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec],
        web_search: bool = False,
    ) -> Turn:
        kwargs = self.request(system, messages, tools)
        if web_search:
            kwargs["tools"] = [*kwargs.get("tools", []), web_search_tool(self.model)]
        response = self._call(lambda: self._client.messages.create(**kwargs))
        turn = from_anthropic(response)
        # A long search turn can pause; it goes on from the paused content, a few times at most.
        searches, sources = list(turn.searches), list(turn.sources)
        for _ in range(MAX_PAUSED_TURNS):
            if getattr(response, "stop_reason", None) != "pause_turn":
                break
            paused = [_block_dict(b) for b in response.content]
            kwargs = {
                **kwargs,
                "messages": [*kwargs["messages"], {"role": "assistant", "content": paused}],
            }
            response = self._call(partial(self._client.messages.create, **kwargs))
            turn = from_anthropic(response)
            searches += [q for q in turn.searches if q not in searches]
            sources += [s for s in turn.sources if s not in sources]
        return Turn(
            text=turn.text,
            tool_calls=turn.tool_calls,
            searches=tuple(searches),
            sources=tuple(sources),
            raw=turn.raw,
        )


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
