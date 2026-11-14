"""Which provider an agent uses, and the sticky fallback on recoverable errors.

Order: the override given with the request, then the agent's primary when it is active,
for an agent without any assignment of its own the assistant's primary (and fallback), then
the first active configuration by creation time. The agent's fallback is used only
after a recoverable error (timeout, rate limit, unavailable) and then for the rest of the
request.
"""

import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import ChatModel, ChatModelFactory, ProviderSettings, runs_own_loop
from app.agent.llm.logs import event
from app.agent.llm.params import CLAUDE_CODE_TYPE
from app.agent.loop import tool_loop
from app.agent.messages import Message, ToolSpec, Turn
from app.agent.results import AgentResult
from app.agent.secrets import SecretBox, SecretUnreadable
from app.agent.tools import AgentTools
from app.db import AgentProvider, AgentSetting, AIProvider, User

T = TypeVar("T")

EffectiveReason = Literal["override", "primary", "assistant", "default", "none"]

# Agents without an assignment of their own follow this one (the chat panel's agent).
DEFAULT_AGENT = "assistant"

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


def assignments(session: Session, user_id: uuid.UUID, agent_id: str) -> dict[str, AIProvider]:
    rows = session.execute(
        select(AgentProvider.role, AIProvider)
        .join(AIProvider, AIProvider.id == AgentProvider.provider_id)
        .where(
            AgentProvider.user_id == user_id,
            AgentProvider.agent_id == agent_id,
            AIProvider.user_id == user_id,
        )
    )
    return {role: provider for role, provider in rows}


def web_search_enabled(session: Session, user_id: uuid.UUID, agent_id: str) -> bool:
    """The agent's Internet search switch; off when never saved."""
    row = session.get(AgentSetting, (user_id, agent_id))
    return bool(row is not None and row.web_search)


def usable(row: AIProvider, session: Session) -> bool:
    """False for a Claude Code provider that does not belong to the admin (admin-only type)."""
    if row.provider_type != CLAUDE_CODE_TYPE:
        return True
    owner = session.get(User, row.user_id)
    return owner is not None and owner.role == "admin"


def first_active(session: Session, user_id: uuid.UUID) -> AIProvider | None:
    rows = session.scalars(
        select(AIProvider)
        .where(AIProvider.user_id == user_id, AIProvider.is_active.is_(True))
        .order_by(AIProvider.created_at, AIProvider.name)
    )
    return next((row for row in rows if usable(row, session)), None)


def own_or_inherited(
    session: Session, user_id: uuid.UUID, agent_id: str
) -> tuple[dict[str, AIProvider], bool]:
    """The user's assignments of the agent, or their assistant's when it has none (True)."""
    own = assignments(session, user_id, agent_id)
    if own or agent_id == DEFAULT_AGENT:
        return own, False
    return assignments(session, user_id, DEFAULT_AGENT), True


def effective(
    session: Session, user_id: uuid.UUID, agent_id: str
) -> tuple[AIProvider | None, EffectiveReason]:
    """The provider an agent uses for this user when the request names none."""
    assigned, inherited = own_or_inherited(session, user_id, agent_id)
    primary = assigned.get("primary")
    if primary is not None and primary.is_active and usable(primary, session):
        return primary, "assistant" if inherited else "primary"
    default = first_active(session, user_id)
    return (default, "default") if default is not None else (None, "none")


@dataclass
class Candidate:
    row: AIProvider
    model: ChatModel | None = None


def describe(row: AIProvider) -> str:
    return f"{row.name} ({row.model_name})"


class HandOver(Exception):
    """The request switched to a fallback that runs the agent loop the other way."""


def merged(before: AgentResult, after: AgentResult) -> AgentResult:
    """Steps a failed primary already ran stay in the trace before the fallback's."""
    changed = list(before.changed_lessons)
    changed += [c for c in after.changed_lessons if c not in changed]
    return AgentResult(
        reply=after.reply,
        steps=[*before.steps, *after.steps],
        changed_lessons=changed,
        stopped=after.stopped,
    )


class AgentModel:
    """A chat model for one request: the chosen provider, then the fallback when allowed.

    ``run`` drives the request: with the app's tool loop for API providers, or as one run
    for a provider that runs its own loop (Claude Code). Either may fall back to the other.
    """

    runs_own_loop = True

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

    def _current_runs_own_loop(self) -> bool:
        try:
            return runs_own_loop(self._build(self.current))
        except ProviderError:
            return False  # the call itself reports the error

    def _call(self, candidate: Candidate, action: Callable[[ChatModel], T]) -> T:
        row = candidate.row
        started = time.monotonic()
        try:
            value = action(self._build(candidate))
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
        return value

    def _with_fallback(self, action: Callable[[ChatModel], T], own_loop: bool) -> T:
        if self.current is self.primary:
            try:
                return self._call(self.primary, action)
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
                if self._current_runs_own_loop() != own_loop:
                    raise HandOver from exc
        try:
            return self._call(self.current, action)
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

    def complete(
        self,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec],
        web_search: bool = False,
    ) -> Turn:
        def call(model: ChatModel) -> Turn:
            if web_search and getattr(model, "supports_web_search", False):
                turn: Turn = model.complete(system, messages, tools, web_search=True)  # type: ignore[call-arg]
                return turn
            return model.complete(system, messages, tools)

        return self._with_fallback(call, own_loop=False)

    def run(
        self,
        system: str,
        conversation: Sequence[Message],
        tools: AgentTools | None,
        max_steps: int,
        *,
        web_search: bool = False,
    ) -> AgentResult:
        """``web_search`` reaches only a model that runs its own loop (Claude Code); the API
        tool loop ignores it."""
        if tools is None:
            raise ValueError("the agent tools are required")
        done = AgentResult(reply="")

        def own_run(model: ChatModel) -> AgentResult:
            if not runs_own_loop(model):
                raise ProviderError("this provider cannot run the agent loop", "invalid_config")
            return model.run(system, conversation, tools, max_steps, web_search=web_search)

        # At most one hand-over: the switch to the fallback happens once per request.
        for _ in range(2):
            try:
                if self._current_runs_own_loop():
                    return merged(done, self._with_fallback(own_run, own_loop=True))
                return tool_loop(self, system, conversation, tools, max_steps, done)
            except HandOver:
                continue
        raise AssertionError("unreachable: the fallback is chosen only once")

    def list_models(self) -> list[str]:
        return self._build(self.current).list_models()


def resolve_chain(
    session: Session,
    user_id: uuid.UUID,
    box: SecretBox,
    factory: ChatModelFactory,
    agent_id: str,
    override_id: uuid.UUID | None = None,
) -> AgentModel:
    """The model for one agent request, or ResolveError (404 / 409) before any model call."""
    if override_id is not None:
        row = session.scalars(
            select(AIProvider).where(AIProvider.id == override_id, AIProvider.user_id == user_id)
        ).first()
        if row is None:
            raise ResolveError(404, f"no AI provider with id {override_id}")
        if not usable(row, session):
            raise ResolveError(409, NO_PROVIDER)
        if not row.is_active:
            raise ResolveError(409, f"{row.name} is switched off in Settings")
        return AgentModel(agent_id, row, None, box, factory)
    chosen, _reason = effective(session, user_id, agent_id)
    if chosen is None:
        raise ResolveError(409, NO_PROVIDER)
    fallback = own_or_inherited(session, user_id, agent_id)[0].get("fallback")
    if fallback is not None and (
        not fallback.is_active or fallback.id == chosen.id or not usable(fallback, session)
    ):
        fallback = None
    return AgentModel(agent_id, chosen, fallback, box, factory)
