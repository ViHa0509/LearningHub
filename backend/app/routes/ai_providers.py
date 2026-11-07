"""Provider configurations: CRUD, types, connection test and model listing."""

import re
import time
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agent.agents import AGENTS
from app.agent.llm import catalog
from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import (
    ChatModelFactory,
    ProviderSettings,
    is_setup_token,
    key_kind,
    normalize_key,
)
from app.agent.llm.logs import event
from app.agent.llm.params import PROVIDER_TYPES, FieldError, clean_config, validate_config
from app.agent.llm.urls import Resolver, validate_base_url
from app.agent.messages import Message
from app.agent.resolve import settings_of
from app.agent.secrets import SecretBox, key_hint
from app.db import AgentProvider, AIProvider, get_session
from app.routes.guard import box_of, factory_of, require_app_header, resolver_of

router = APIRouter(prefix="/api/ai-providers", tags=["ai-providers"])
guarded = [Depends(require_app_header)]

MODEL = re.compile(r"^[A-Za-z0-9._:/@+-]{1,200}$")
MAX_NAME = 100
MAX_KEY = 500
MAX_URL = 500
MAX_MESSAGE = 500
TEST_SYSTEM = "You are a connection test. Answer with one word."
TEST_PROMPT = "Reply with the word OK."


class ProviderIn(BaseModel):
    """Settings of one configuration. An empty or absent api_key keeps the stored key."""

    name: str = ""
    provider_type: str = ""
    model_name: str = ""
    api_key: str | None = None
    base_url: str | None = None
    is_active: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class ProviderTestIn(ProviderIn):
    """Unsaved settings to test; provider_id reuses that configuration's stored key."""

    provider_id: uuid.UUID | None = None


class LastTest(BaseModel):
    status: str
    message: str | None
    latency_ms: int | None
    at: datetime


class UsedBy(BaseModel):
    agent_id: str
    agent_name: str
    role: str


class ProviderOut(BaseModel):
    id: uuid.UUID
    name: str
    provider_type: str
    model_name: str
    key_hint: str | None
    key_kind: str | None
    has_key: bool
    base_url: str | None
    config: dict[str, Any]
    is_active: bool
    last_test: LastTest | None
    last_success_at: datetime | None
    used_by: list[UsedBy]
    created_at: datetime
    updated_at: datetime


class TestResult(BaseModel):
    status: str
    ok: bool
    message: str
    latency_ms: int
    model: str
    tested_at: datetime


class ModelOut(BaseModel):
    id: str
    context_window: int | None
    max_output: int | None


class TypeOut(BaseModel):
    type: str
    label: str
    needs_key: bool
    needs_base_url: bool
    default_base_url: str | None
    params: list[str]
    capabilities: list[str]
    models: list[ModelOut]


class ModelsOut(BaseModel):
    models: list[str]


# --- helpers ---------------------------------------------------------------------


def used_by(session: Session, provider_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[UsedBy]]:
    out: dict[uuid.UUID, list[UsedBy]] = {pid: [] for pid in provider_ids}
    if not provider_ids:
        return out
    rows = session.scalars(
        select(AgentProvider)
        .where(AgentProvider.provider_id.in_(provider_ids))
        .order_by(AgentProvider.agent_id, AgentProvider.role.desc())
    )
    for row in rows:
        agent = AGENTS.get(row.agent_id)
        out[row.provider_id].append(
            UsedBy(
                agent_id=row.agent_id,
                agent_name=agent.name if agent else row.agent_id,
                role=row.role,
            )
        )
    return out


def to_out(row: AIProvider, uses: list[UsedBy]) -> ProviderOut:
    last_test = None
    if row.last_test_at is not None and row.last_test_status is not None:
        last_test = LastTest(
            status=row.last_test_status,
            message=row.last_test_message,
            latency_ms=row.last_test_latency_ms,
            at=row.last_test_at,
        )
    return ProviderOut(
        id=row.id,
        name=row.name,
        provider_type=row.provider_type,
        model_name=row.model_name,
        key_hint=row.key_hint,
        key_kind=(row.key_kind or "api_key") if row.api_key_enc is not None else None,
        has_key=row.api_key_enc is not None,
        base_url=row.base_url,
        config=dict(row.config or {}),
        is_active=row.is_active,
        last_test=last_test,
        last_success_at=row.last_success_at,
        used_by=uses,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def out_of(session: Session, row: AIProvider) -> ProviderOut:
    return to_out(row, used_by(session, [row.id])[row.id])


def get_row(session: Session, provider_id: uuid.UUID) -> AIProvider:
    row = session.get(AIProvider, provider_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"no AI provider with id {provider_id}")
    return row


class Checked(BaseModel):
    name: str
    provider_type: str
    model_name: str
    api_key: str | None
    base_url: str | None
    config: dict[str, Any]


def check(
    payload: ProviderIn, resolve: Resolver, *, has_stored_key: bool, require_name: bool = True
) -> Checked:
    """Validated, normalized settings, or HTTP 422 with ``detail: [{field, msg}]``."""
    errors: list[FieldError] = []
    name = payload.name.strip()
    if require_name and not name:
        errors.append(FieldError("name", "a name is required"))
    elif len(name) > MAX_NAME:
        errors.append(FieldError("name", f"at most {MAX_NAME} characters"))
    provider_type = payload.provider_type.strip()
    info = PROVIDER_TYPES.get(provider_type)
    if info is None:
        known = ", ".join(PROVIDER_TYPES)
        errors.append(FieldError("provider_type", f"choose one of: {known}"))
    model_name = payload.model_name.strip()
    if not model_name:
        errors.append(FieldError("model_name", "a model is required"))
    elif not MODEL.match(model_name):
        errors.append(
            FieldError("model_name", "model ids use letters, digits and . _ : / @ + - only")
        )
    api_key = normalize_key(payload.api_key or "") or None
    if api_key is not None and (len(api_key) > MAX_KEY or any(c.isspace() for c in api_key)):
        errors.append(FieldError("api_key", "the key must be one word of at most 500 characters"))
    if info is not None and info.needs_key and api_key is None and not has_stored_key:
        errors.append(FieldError("api_key", f"{info.label} needs an API key"))
    base_url = (payload.base_url or "").strip() or None
    if base_url is None:
        if info is not None and info.needs_base_url:
            errors.append(FieldError("base_url", f"{info.label} needs a base URL"))
    elif len(base_url) > MAX_URL:
        errors.append(FieldError("base_url", f"at most {MAX_URL} characters"))
    elif info is not None:
        try:
            base_url = validate_base_url(provider_type, base_url, resolve)
        except ValueError as exc:
            errors.append(FieldError("base_url", str(exc)))
    errors.extend(validate_config(provider_type, payload.config))
    if errors:
        raise HTTPException(status_code=422, detail=[e.as_dict() for e in errors])
    return Checked(
        name=name,
        provider_type=provider_type,
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        config=clean_config(payload.config),
    )


def name_taken(session: Session, name: str, exclude: uuid.UUID | None = None) -> None:
    query = select(AIProvider.id).where(AIProvider.name == name)
    if exclude is not None:
        query = query.where(AIProvider.id != exclude)
    if session.scalars(query).first() is not None:
        raise HTTPException(status_code=409, detail=f"the name '{name}' is already taken")


def commit_or_conflict(session: Session, name: str) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail=f"the name '{name}' is already taken") from exc


def apply(row: AIProvider, values: Checked, box: SecretBox, is_active: bool) -> None:
    row.name = values.name
    row.provider_type = values.provider_type
    row.model_name = values.model_name
    row.base_url = values.base_url
    row.config = values.config
    row.is_active = is_active
    if values.api_key is not None:
        row.api_key_enc = box.encrypt(values.api_key)
        row.key_hint = key_hint(values.api_key)
        row.key_kind = key_kind(values.api_key)


def run_test(settings: ProviderSettings, factory: ChatModelFactory) -> TestResult:
    """One short request; a provider refusal is a result, not an error."""
    started = time.monotonic()
    status = "ok"
    try:
        model = factory.create(settings)
        turn = model.complete(TEST_SYSTEM, [Message(role="user", text=TEST_PROMPT)], [])
        message = f"The model answered: {turn.text[:80] or '(empty)'}"
    except ProviderError as exc:
        status, message = exc.category, str(exc)[:MAX_MESSAGE]
        if status == "auth_failed" and settings.type == "anthropic" and settings.key:
            # Says how the key was sent, never the key: its kind, length and the same
            # last four characters as the saved hint, to compare with the original.
            key = settings.key
            sent = "a setup token (OAuth" if is_setup_token(key) else "an API key ("
            sep = ", " if is_setup_token(key) else ""
            detail = f"{sent}{sep}{len(key)} characters, ending {key_hint(key)})"
            message = f"Sent as {detail}. {message}"[:MAX_MESSAGE]
    latency = int((time.monotonic() - started) * 1000)
    event(
        "llm.test",
        provider_id=settings.id,
        provider_type=settings.type,
        model=settings.model,
        duration_ms=latency,
        category=None if status == "ok" else status,
    )
    return TestResult(
        status=status,
        ok=status == "ok",
        message=message,
        latency_ms=latency,
        model=settings.model,
        tested_at=datetime.now(UTC),
    )


# --- routes ------------------------------------------------------------------------


@router.get("/types", response_model=list[TypeOut])
def list_types() -> list[TypeOut]:
    return [
        TypeOut(
            type=info.type,
            label=info.label,
            needs_key=info.needs_key,
            needs_base_url=info.needs_base_url,
            default_base_url=info.default_base_url,
            params=list(info.params),
            capabilities=list(info.capabilities),
            models=[
                ModelOut(id=m.id, context_window=m.context_window, max_output=m.max_output)
                for m in catalog.presets(info.type)
            ],
        )
        for info in PROVIDER_TYPES.values()
    ]


@router.get("", response_model=list[ProviderOut])
def list_providers(session: Annotated[Session, Depends(get_session)]) -> list[ProviderOut]:
    rows = list(
        session.scalars(select(AIProvider).order_by(AIProvider.created_at, AIProvider.name))
    )
    uses = used_by(session, [r.id for r in rows])
    return [to_out(row, uses[row.id]) for row in rows]


@router.post("/test", response_model=TestResult, dependencies=guarded)
def test_unsaved(
    payload: ProviderTestIn,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> TestResult:
    stored = get_row(session, payload.provider_id) if payload.provider_id else None
    values = check(
        payload,
        resolver_of(request),
        has_stored_key=stored is not None and stored.api_key_enc is not None,
        require_name=False,
    )
    key = values.api_key
    if key is None and stored is not None:
        try:
            key = settings_of(stored, box_of(request)).key
        except ProviderError as exc:
            raise HTTPException(
                status_code=422, detail=[{"field": "api_key", "msg": str(exc)}]
            ) from exc
    settings = ProviderSettings(
        id=str(stored.id) if stored else None,
        name=values.name or (stored.name if stored else ""),
        type=values.provider_type,
        model=values.model_name,
        key=key,
        base_url=values.base_url,
        config=values.config,
    )
    return run_test(settings, factory_of(request))


@router.get("/{provider_id}", response_model=ProviderOut)
def read_provider(
    provider_id: uuid.UUID, session: Annotated[Session, Depends(get_session)]
) -> ProviderOut:
    return out_of(session, get_row(session, provider_id))


@router.post("", response_model=ProviderOut, status_code=201, dependencies=guarded)
def create_provider(
    payload: ProviderIn, request: Request, session: Annotated[Session, Depends(get_session)]
) -> ProviderOut:
    values = check(payload, resolver_of(request), has_stored_key=False)
    name_taken(session, values.name)
    row = AIProvider(id=uuid.uuid4())
    apply(row, values, box_of(request), payload.is_active)
    session.add(row)
    commit_or_conflict(session, values.name)
    return out_of(session, row)


@router.put("/{provider_id}", response_model=ProviderOut, dependencies=guarded)
def update_provider(
    provider_id: uuid.UUID,
    payload: ProviderIn,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> ProviderOut:
    row = get_row(session, provider_id)
    values = check(payload, resolver_of(request), has_stored_key=row.api_key_enc is not None)
    name_taken(session, values.name, exclude=row.id)
    apply(row, values, box_of(request), payload.is_active)
    commit_or_conflict(session, values.name)
    session.refresh(row)
    return out_of(session, row)


@router.delete("/{provider_id}", status_code=204, response_model=None, dependencies=guarded)
def delete_provider(
    provider_id: uuid.UUID, session: Annotated[Session, Depends(get_session)]
) -> Response:
    row = get_row(session, provider_id)
    uses = used_by(session, [row.id])[row.id]
    if uses:
        names = ", ".join(f"{u.agent_name} ({u.role})" for u in uses)
        return JSONResponse(
            status_code=409,
            content={
                "detail": f"{row.name} is used by {names}; choose another provider for "
                "these agents first",
                "agents": [{"id": u.agent_id, "name": u.agent_name, "role": u.role} for u in uses],
            },
        )
    session.delete(row)
    session.commit()
    return Response(status_code=204)


@router.post("/{provider_id}/test", response_model=TestResult, dependencies=guarded)
def test_saved(
    provider_id: uuid.UUID, request: Request, session: Annotated[Session, Depends(get_session)]
) -> TestResult:
    row = get_row(session, provider_id)
    try:
        settings = settings_of(row, box_of(request))
    except ProviderError as exc:
        result = TestResult(
            status=exc.category,
            ok=False,
            message=str(exc),
            latency_ms=0,
            model=row.model_name,
            tested_at=datetime.now(UTC),
        )
    else:
        result = run_test(settings, factory_of(request))
    row.last_test_at = result.tested_at
    row.last_test_status = result.status
    row.last_test_message = result.message
    row.last_test_latency_ms = result.latency_ms
    if result.ok:
        row.last_success_at = result.tested_at
    session.commit()
    return result


@router.get("/{provider_id}/models", response_model=ModelsOut)
def list_models(
    provider_id: uuid.UUID, request: Request, session: Annotated[Session, Depends(get_session)]
) -> ModelsOut | JSONResponse:
    row = get_row(session, provider_id)
    try:
        model = factory_of(request).create(settings_of(row, box_of(request)))
        return ModelsOut(models=model.list_models())
    except ProviderError as exc:
        return JSONResponse(
            status_code=502, content={"detail": f"{row.name}: {exc.category}: {exc}"}
        )
