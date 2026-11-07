"""Which providers the agent may use right now, merged from app settings and backend/.env.

A key saved in the app wins over the ``LH_*`` setting. The registry is rebuilt after
every settings change, so a new key works without restarting the backend.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import anthropic
import openai
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.providers import (
    CATALOG,
    AnthropicProvider,
    ChatProvider,
    OpenAICompatibleProvider,
    ProviderInfo,
)
from app.agent.secrets import SecretBox, SecretUnreadable, key_hint
from app.config import Settings
from app.db import ProviderConfig

# (provider id, key, base url) -> provider. Creating a client makes no request.
ProviderFactory = Callable[[str, str | None, str | None], ChatProvider]

DEEPSEEK_URL = "https://api.deepseek.com"


def default_factory(provider_id: str, key: str | None, base_url: str | None) -> ChatProvider:
    if provider_id == "anthropic":
        return AnthropicProvider(anthropic.Anthropic(api_key=key))
    if provider_id == "openai":
        return OpenAICompatibleProvider(openai.OpenAI(api_key=key))
    if provider_id == "deepseek":
        return OpenAICompatibleProvider(openai.OpenAI(api_key=key, base_url=DEEPSEEK_URL))
    if provider_id == "ollama":
        url = (base_url or "").rstrip("/") + "/v1"
        return OpenAICompatibleProvider(openai.OpenAI(api_key="ollama", base_url=url))
    raise ValueError(f"unknown provider '{provider_id}'")


def _secret(value: SecretStr | None) -> str | None:
    """The value, or None when unset or blank (an empty LH_*_API_KEY means not configured)."""
    text = value.get_secret_value().strip() if value is not None else ""
    return text or None


def env_value(settings: Settings, provider_id: str) -> str | None:
    """The key (or Ollama URL) set in backend/.env for a provider."""
    if provider_id == "anthropic":
        return _secret(settings.anthropic_api_key)
    if provider_id == "openai":
        return _secret(settings.openai_api_key)
    if provider_id == "deepseek":
        return _secret(settings.deepseek_api_key)
    if provider_id == "ollama":
        return (settings.ollama_url or "").strip() or None
    return None


@dataclass(frozen=True)
class EffectiveConfig:
    info: ProviderInfo
    source: Literal["app", "env"] | None
    overrides_env: bool
    key_hint: str | None
    base_url: str | None
    model: str
    enabled: bool
    key_error: str | None
    # Never leaves the backend.
    key: str | None

    @property
    def configured(self) -> bool:
        return self.source is not None and self.key_error is None

    @property
    def available(self) -> bool:
        return self.configured and self.enabled



class ProviderRegistry:
    def __init__(self, settings: Settings, box: SecretBox, factory: ProviderFactory) -> None:
        self.settings = settings
        self.box = box
        self.factory = factory
        self._configs: dict[str, EffectiveConfig] = {}
        self._providers: dict[str, ChatProvider] = {}
        self.load_rows([])

    def reload(self, session: Session) -> None:
        self.load_rows(list(session.scalars(select(ProviderConfig))))

    def load_rows(self, rows: list[ProviderConfig]) -> None:
        by_id = {row.provider_id: row for row in rows}
        configs = {info.id: self._effective(info, by_id.get(info.id)) for info in CATALOG}
        self._configs = configs
        self._providers = {
            pid: self.factory(pid, c.key, c.base_url) for pid, c in configs.items() if c.available
        }

    def _effective(self, info: ProviderInfo, row: ProviderConfig | None) -> EffectiveConfig:
        env = env_value(self.settings, info.id)
        is_url = info.id == "ollama"
        app_value: str | None = None
        key_error: str | None = None
        if row is not None and is_url:
            app_value = row.base_url
        elif row is not None and row.api_key_enc:
            try:
                app_value = self.box.decrypt(row.api_key_enc)
            except SecretUnreadable as exc:
                key_error = str(exc)
        source: Literal["app", "env"] | None
        if app_value or key_error:
            source, value = "app", app_value
        elif env:
            source, value = "env", env
        else:
            source, value = None, None
        hint = None
        if value and not is_url:
            hint = row.key_hint if source == "app" and row is not None else key_hint(value)
        return EffectiveConfig(
            info=info,
            source=source,
            overrides_env=source == "app" and env is not None,
            key_hint=hint,
            base_url=value if is_url else None,
            model=(row.model if row is not None and row.model else info.default_model),
            enabled=row.enabled if row is not None else True,
            key_error=key_error,
            key=None if is_url else value,
        )

    def configs(self) -> list[EffectiveConfig]:
        return [self._configs[info.id] for info in CATALOG]

    def config(self, provider_id: str) -> EffectiveConfig | None:
        return self._configs.get(provider_id)

    def provider(self, provider_id: str) -> ChatProvider | None:
        """The provider for the chat: configured and switched on."""
        return self._providers.get(provider_id)

    def build(self, provider_id: str) -> ChatProvider | None:
        """A provider for a connection test: configured, switched on or not."""
        config = self._configs.get(provider_id)
        if config is None or not config.configured:
            return None
        return self.factory(provider_id, config.key, config.base_url)
