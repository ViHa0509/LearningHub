"""One place that turns a provider configuration into a chat model.

The factory is stored in ``app.state.llm_factory`` so tests can replace it. SDK clients are
built with the configured timeout and no retries, so a connection test and the fallback see
real failures instead of SDK retries. Building a client makes no request.
"""

import socket
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import anthropic
import openai

from app.agent.llm.adapters import AnthropicChat, OpenAICompatibleChat
from app.agent.llm.errors import ProviderError
from app.agent.llm.logs import event
from app.agent.llm.params import PROVIDER_TYPES
from app.agent.llm.urls import Resolver, validate_base_url
from app.agent.messages import Message, ToolSpec, Turn

DEFAULT_TIMEOUT = 60.0
LOCAL_KEY = "local"
# The openai SDK refuses to start without a key; servers that need none ignore it.
NO_KEY = "not-needed"


class ChatModel(Protocol):
    @property
    def model(self) -> str: ...

    def complete(
        self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]
    ) -> Turn: ...

    def list_models(self) -> list[str]: ...


@dataclass(frozen=True)
class ProviderSettings:
    """Everything needed to build a client. ``key`` never leaves the backend."""

    id: str | None
    name: str
    type: str
    model: str
    key: str | None = field(default=None, repr=False)
    base_url: str | None = None
    config: dict[str, Any] = field(default_factory=dict)


class ChatModelFactory(Protocol):
    def create(self, settings: ProviderSettings) -> ChatModel: ...


class LLMFactory:
    def __init__(
        self,
        resolve: Resolver = socket.getaddrinfo,
        anthropic_client: Callable[..., Any] = anthropic.Anthropic,
        openai_client: Callable[..., Any] = openai.OpenAI,
    ) -> None:
        self.resolve = resolve
        self._anthropic_client = anthropic_client
        self._openai_client = openai_client

    def create(self, settings: ProviderSettings) -> ChatModel:
        """A chat model for the settings; ProviderError(invalid_config) when they cannot work."""
        info = PROVIDER_TYPES.get(settings.type)
        if info is None:
            raise ProviderError(f"unknown provider type '{settings.type}'", "invalid_config")
        key = (settings.key or "").strip() or None
        if info.needs_key and key is None:
            raise ProviderError(f"{info.label} needs an API key", "invalid_config")
        base_url = (settings.base_url or "").strip() or None
        if info.needs_base_url and base_url is None:
            raise ProviderError(f"{info.label} needs a base URL", "invalid_config")
        if base_url is not None:
            try:
                base_url = validate_base_url(settings.type, base_url, self.resolve)
            except ValueError as exc:
                raise ProviderError(f"base URL: {exc}", "invalid_config") from exc
        timeout = float(settings.config.get("timeout") or DEFAULT_TIMEOUT)
        options: dict[str, Any] = {"timeout": timeout, "max_retries": 0}
        event(
            "llm.provider_init",
            provider_id=settings.id,
            provider_type=settings.type,
            model=settings.model,
        )
        try:
            if settings.type == "anthropic":
                if base_url is not None:
                    options["base_url"] = base_url
                client = self._anthropic_client(api_key=key, **options)
                return AnthropicChat(client, settings.model, settings.config, key)
            api_key = key or (LOCAL_KEY if settings.type == "local" else NO_KEY)
            client = self._openai_client(
                api_key=api_key, base_url=base_url or info.default_base_url, **options
            )
        except (anthropic.AnthropicError, openai.OpenAIError) as exc:
            raise ProviderError("the provider client cannot be created", "invalid_config") from exc
        return OpenAICompatibleChat(client, settings.model, settings.config, key)
