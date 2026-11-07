"""Which provider an agent uses, and the sticky fallback on recoverable errors.

Order: the override given with the request, then the agent's primary when it is active,
then the first active configuration by creation time. The agent's fallback is used only
after a recoverable error (timeout, rate limit, unavailable) and then for the rest of the
request.
"""

import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import ChatModel, ChatModelFactory, ProviderSettings
from app.agent.llm.logs import event
from app.agent.messages import Message, ToolSpec, Turn
from app.agent.secrets import SecretBox, SecretUnreadable
from app.db import AgentProvider, AIProvider

EffectiveReason = Literal["override", "primary", "default", "none"]

NO_PROVIDER = "No active AI provider: add one or switch one on in Settings."


class ResolveError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def settings_of(row: AIProvider, box: SecretBox) -> ProviderSettings:
    """Build settings from a row; an unreadable key is an invalid configuration."""
    key: str | None = None
    if row.api_key_enc:
        try:
            key = box.decrypt(row.api_key_enc)
        except SecretUnreadable as exc:
            raise ProviderError(str(exc), "invalid_config") from exc
    return ProviderSettings(
        id=str(row.id),
        name=row.name,
        type=row.provider_type,
        model=row.model_name,
        key=key,
        base_url=row.base_url,
        config=dict(row.config or {}),
    )


def assignments(session: Session, agent_id: str) -> dict[str, AIProvider]:
    rows = session.execute(
        select(AgentProvider.role, AIProvider)
        .join(AIProvider, AIProvider.id == AgentProvider.provider_id)
        .where(AgentProvider.agent_id == agent_id)
    )
    return {role: provider for role, provider in rows}


def first_active(session: Session) -> AIProvider | None:
    return session.scalars(
        select(AIProvider)
        .where(AIProvider.is_active.is_(True))
        .order_by(AIProvider.created_at, AIProvider.name)
        .limit(1)
    ).first()


def effective(session: Session, agent_id: str) -> tuple[AIProvider | None, EffectiveReason]:
    """The provider an agent uses when the request names none."""
    primary = assignments(session, agent_id).get("primary")
    if primary is not None and primary.is_active:
        return primary, "primary"
    default = first_active(session)
    return (default, "default") if default is not None else (None, "none")


@dataclass
class Candidate:
    row: AIProvider
    model: ChatModel | None = None


def describe(row: AIProvider) -> str:
    return f"{row.name} ({row.model_name})"


class AgentModel:
    """A chat model for one request: the chosen provider, then the fallback when allowed."""

    def __init__(
        self,
        agent_id: str,
        primary: AIProvider,
        fallback: AIProvider | None,
        box: SecretBox,
        factory: ChatModelFactory,
    ) -> None:
        self.agent_id = agent_id
        self._box = box
        self._factory = factory
        self.primary = Candidate(primary)
        self.fallback = Candidate(fallback) if fallback is not None else None
        self.current = self.primary
        self.fallback_used = False
        self._primary_error: ProviderError | None = None

    @property
    def model(self) -> str:
        return self.current.row.model_name

    @property
    def provider(self) -> AIProvider:
        return self.current.row

    def _build(self, candidate: Candidate) -> ChatModel:
        if candidate.model is None:
            candidate.model = self._factory.create(settings_of(candidate.row, self._box))
        return candidate.model

    def _complete_with(
        self,
        candidate: Candidate,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec],
    ) -> Turn:
        row = candidate.row
        started = time.monotonic()
        try:
            turn = self._build(candidate).complete(system, messages, tools)
        except ProviderError as exc:
            event(
                "llm.call_failed",
                agent_id=self.agent_id,
                provider_id=row.id,
                provider_type=row.provider_type,
                model=row.model_name,
                duration_ms=int((time.monotonic() - started) * 1000),
                category=exc.category,
            )
            raise
        event(
            "llm.call",
            agent_id=self.agent_id,
            provider_id=row.id,
            provider_type=row.provider_type,
            model=row.model_name,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return turn

    def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> Turn:
        if self.current is self.primary:
            try:
                return self._complete_with(self.primary, system, messages, tools)
            except ProviderError as exc:
                if not exc.recoverable or self.fallback is None:
                    raise ProviderError(
                        f"{describe(self.primary.row)}: {exc.category}: {exc}", exc.category
                    ) from exc
                self._primary_error = exc
                event(
                    "llm.fallback",
                    agent_id=self.agent_id,
                    provider_id=self.primary.row.id,
                    fallback_provider_id=self.fallback.row.id,
                    provider_type=self.fallback.row.provider_type,
                    model=self.fallback.row.model_name,
                    category=exc.category,
                )
                self.current = self.fallback
                self.fallback_used = True
        try:
            return self._complete_with(self.current, system, messages, tools)
        except ProviderError as exc:
            first = self._primary_error
            primary_part = (
                f"{describe(self.primary.row)} failed: {first.category} ({first}); "
                if first
                else ""
            )
            raise ProviderError(
                f"{primary_part}fallback {describe(self.current.row)} failed: "
                f"{exc.category} ({exc})",
                exc.category,
            ) from exc

    def list_models(self) -> list[str]:
        return self._build(self.current).list_models()


def resolve_chain(
    session: Session,
    box: SecretBox,
    factory: ChatModelFactory,
    agent_id: str,
    override_id: uuid.UUID | None = None,
) -> AgentModel:
    """The model for one agent request, or ResolveError (404 / 409) before any model call."""
    if override_id is not None:
        row = session.get(AIProvider, override_id)
        if row is None:
            raise ResolveError(404, f"no AI provider with id {override_id}")
        if not row.is_active:
            raise ResolveError(409, f"{row.name} is switched off in Settings")
        return AgentModel(agent_id, row, None, box, factory)
    chosen, _reason = effective(session, agent_id)
    if chosen is None:
        raise ResolveError(409, NO_PROVIDER)
    fallback = assignments(session, agent_id).get("fallback")
    if fallback is not None and (not fallback.is_active or fallback.id == chosen.id):
        fallback = None
    return AgentModel(agent_id, chosen, fallback, box, factory)
