import re
import time
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.agent.loop import Page, run_agent
from app.agent.messages import Message, ProviderError
from app.agent.providers import CATALOG
from app.agent.ratelimit import RateLimiter
from app.agent.registry import EffectiveConfig, ProviderRegistry
from app.agent.secrets import key_hint
from app.agent.tools import AgentTools
from app.db import ProviderConfig, get_session
from app.roadmaps import RoadmapCatalog

router = APIRouter(prefix="/api/agent", tags=["agent"])

ID = r"^[A-Za-z0-9_-]{1,100}$"
MODEL = r"^[A-Za-z0-9._:/-]{1,100}$"


class ProviderOut(BaseModel):
    id: str
    label: str
    available: bool
    configured: bool
    enabled: bool
    source: Literal["app", "env"] | None
    overrides_env: bool
    key_hint: str | None
    key_error: str | None
    base_url: str | None
    setting: str
    models: list[str]
    model: str
    default_model: str


class ProviderUpdate(BaseModel):
    """Empty or missing fields keep what is stored; an empty model resets to the default."""

    api_key: str | None = Field(default=None, max_length=300)
    base_url: str | None = Field(default=None, max_length=300)
    model: str | None = Field(default=None, max_length=100)
    enabled: bool | None = None

    @field_validator("base_url")
    @classmethod
    def http_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not value.startswith(("http://", "https://")) or " " in value:
            raise ValueError("the URL must start with http:// or https://")
        return value

    @field_validator("model")
    @classmethod
    def model_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value and not re.match(MODEL, value):
            raise ValueError("model ids use letters, digits and . _ : / - only")
        return value


class TestOut(BaseModel):
    ok: bool
    model: str
    latency_ms: int
    message: str


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)


class PageIn(BaseModel):
    kind: Literal["home", "roadmap", "lesson", "note"] = "home"
    domain: str | None = Field(default=None, pattern=ID)
    node: str | None = Field(default=None, pattern=ID)
    note_id: str | None = Field(default=None, pattern=ID)


class ChatIn(BaseModel):
    provider: str
    model: str = Field(pattern=MODEL)
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=50)
    page: PageIn = PageIn()


class StepOut(BaseModel):
    tool: str
    input: dict[str, Any]
    summary: str


class ChatOut(BaseModel):
    reply: str
    steps: list[StepOut]
    changed_lessons: list[str]
    stopped: bool


def registry_of(request: Request) -> ProviderRegistry:
    registry: ProviderRegistry = request.app.state.registry
    return registry


def to_out(c: EffectiveConfig) -> ProviderOut:
    return ProviderOut(
        id=c.info.id,
        label=c.info.label,
        available=c.available,
        configured=c.configured,
        enabled=c.enabled,
        source=c.source,
        overrides_env=c.overrides_env,
        key_hint=c.key_hint,
        key_error=c.key_error,
        base_url=c.base_url,
        setting=c.info.setting,
        models=list(c.info.models),
        model=c.model,
        default_model=c.info.default_model,
    )


def require_config(registry: ProviderRegistry, provider_id: str) -> EffectiveConfig:
    config = registry.config(provider_id)
    if config is None:
        raise HTTPException(status_code=404, detail=f"unknown provider '{provider_id}'")
    return config


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(request: Request) -> list[ProviderOut]:
    return [to_out(c) for c in registry_of(request).configs()]


@router.put("/providers/{provider_id}", response_model=ProviderOut)
def save_provider(
    provider_id: str,
    payload: ProviderUpdate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> ProviderOut:
    registry = registry_of(request)
    require_config(registry, provider_id)
    row = session.get(ProviderConfig, provider_id)
    if row is None:
        row = ProviderConfig(provider_id=provider_id, enabled=True)
        session.add(row)
    if provider_id == "ollama":
        if payload.base_url:
            row.base_url = payload.base_url
    elif payload.api_key and payload.api_key.strip():
        key = payload.api_key.strip()
        row.api_key_enc = registry.box.encrypt(key)
        row.key_hint = key_hint(key)
    if payload.model is not None:
        row.model = payload.model or None
    if payload.enabled is not None:
        row.enabled = payload.enabled
    session.commit()
    registry.reload(session)
    return to_out(require_config(registry, provider_id))


@router.delete("/providers/{provider_id}", response_model=ProviderOut)
def remove_provider(
    provider_id: str, request: Request, session: Annotated[Session, Depends(get_session)]
) -> ProviderOut:
    """Forget what was saved in the app; a backend/.env key, if any, applies again."""
    registry = registry_of(request)
    require_config(registry, provider_id)
    row = session.get(ProviderConfig, provider_id)
    if row is not None:
        session.delete(row)
        session.commit()
    registry.reload(session)
    return to_out(require_config(registry, provider_id))


@router.post("/providers/{provider_id}/test", response_model=TestOut)
def test_provider(provider_id: str, request: Request) -> TestOut:
    """One short real call with the saved settings. A provider refusal is a result, not an error."""
    registry = registry_of(request)
    config = require_config(registry, provider_id)
    provider = registry.build(provider_id)
    if provider is None:
        raise HTTPException(
            status_code=409,
            detail=config.key_error or f"{config.info.label} is not configured yet",
        )
    started = time.monotonic()
    try:
        turn = provider.complete(
            "You are a connection test. Answer with one word.",
            [Message(role="user", text="Reply with the word OK.")],
            [],
            config.model,
        )
        ok, message = True, f"The model answered: {turn.text[:80] or '(empty)'}"
    except ProviderError as exc:
        ok, message = False, str(exc)
    latency = int((time.monotonic() - started) * 1000)
    return TestOut(ok=ok, model=config.model, latency_ms=latency, message=message)


@router.post("/chat", response_model=ChatOut)
def chat(
    payload: ChatIn, request: Request, session: Annotated[Session, Depends(get_session)]
) -> ChatOut:
    info = next((p for p in CATALOG if p.id == payload.provider), None)
    if info is None:
        raise HTTPException(status_code=400, detail=f"unknown provider '{payload.provider}'")
    registry = registry_of(request)
    config = require_config(registry, info.id)
    provider = registry.provider(info.id)
    if provider is None:
        detail = (
            f"{info.label} is switched off in Settings"
            if config.configured
            else f"{info.label} is not configured: add a key in Settings, "
            f"or set {info.setting} in backend/.env and restart the backend"
        )
        raise HTTPException(status_code=409, detail=detail)
    if payload.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="the last message must be the user's")
    limiter: RateLimiter = request.app.state.rate_limiter
    wait = limiter.acquire()
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many agent requests: at most {limiter.per_minute} per minute. "
            f"Try again in {wait} s.",
            headers={"Retry-After": str(wait)},
        )

    catalog: RoadmapCatalog = request.app.state.catalog
    conversation = [Message(role=m.role, text=m.content) for m in payload.messages]
    page = Page(**payload.page.model_dump())
    try:
        result = run_agent(
            provider,
            payload.model,
            conversation,
            AgentTools(session, catalog),
            catalog,
            page,
            request.app.state.settings.agent_max_steps,
        )
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=f"{info.label}: {exc}") from exc
    return ChatOut(
        reply=result.reply,
        steps=[StepOut(tool=s.tool, input=s.input, summary=s.summary) for s in result.steps],
        changed_lessons=result.changed_lessons,
        stopped=result.stopped,
    )
