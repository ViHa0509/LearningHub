"""One-time import of ``LH_*`` provider values from backend/.env as configurations.

A configuration "<Label> (from .env)" is created only when no configuration has that
name, so editing .env later does not change what the app stores.
"""

import uuid
from dataclasses import dataclass

from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.llm import catalog
from app.agent.llm.factory import key_kind
from app.agent.secrets import SecretBox, key_hint
from app.config import Settings
from app.db import AIProvider


@dataclass(frozen=True)
class EnvSource:
    label: str
    provider_type: str
    base_url: str | None
    model: str


def _secret(value: SecretStr | None) -> str | None:
    text = value.get_secret_value().strip() if value is not None else ""
    return text or None


def _ollama_url(url: str) -> str:
    url = url.strip().rstrip("/")
    return url if url.endswith("/v1") else url + "/v1"


def env_sources(settings: Settings) -> list[tuple[EnvSource, str | None]]:
    """(source, key) for every LH_* provider value that is set and non-blank."""
    found: list[tuple[EnvSource, str | None]] = []
    keyed = (
        ("Anthropic", "anthropic", None, settings.anthropic_api_key),
        ("OpenAI", "openai", None, settings.openai_api_key),
        ("DeepSeek", "custom", "https://api.deepseek.com", settings.deepseek_api_key),
    )
    for label, provider_type, base_url, value in keyed:
        key = _secret(value)
        if key is not None:
            model = "deepseek-chat" if label == "DeepSeek" else catalog.default_model(provider_type)
            found.append((EnvSource(label, provider_type, base_url, model or label.lower()), key))
    ollama = (settings.ollama_url or "").strip()
    if ollama:
        model = catalog.default_model("local") or "gemma3"
        found.append((EnvSource("Ollama", "local", _ollama_url(ollama), model), None))
    return found


def import_env_providers(session: Session, settings: Settings, box: SecretBox) -> list[str]:
    """Create the missing "(from .env)" configurations; returns the names created."""
    created: list[str] = []
    for source, key in env_sources(settings):
        name = f"{source.label} (from .env)"
        if session.scalars(select(AIProvider.id).where(AIProvider.name == name)).first():
            continue
        session.add(
            AIProvider(
                id=uuid.uuid4(),
                name=name,
                provider_type=source.provider_type,
                model_name=source.model,
                api_key_enc=box.encrypt(key) if key else None,
                key_hint=key_hint(key) if key else None,
                key_kind=key_kind(key) if key else None,
                base_url=source.base_url,
                config={},
                is_active=True,
            )
        )
        created.append(name)
    session.commit()
    return created
