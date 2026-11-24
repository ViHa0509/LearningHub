"""Which provider an agent uses, and the sticky fallback on recoverable errors.

Order: the override given with the request, then the agent's primary when it is active,
for an agent without any assignment of its own the assistant's primary (and fallback), then
the first active configuration by creation time. The agent's fallback is used only
after a recoverable error (timeout, rate limit, unavailable) and then for the rest of the
request.

Shared mode: a user (not the admin) with no usable active configuration of their own runs
each agent as the admin set it up, on the admin's shared, active, non-Claude-Code rows only.
This module is the one place that reads another user's rows, and only those. Each request in
shared mode takes one count of the user's daily limit before any model is built.
"""

import logging
import math
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from typing import Any, Literal, TypeVar

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import ChatModel, ChatModelFactory, ProviderSettings, runs_own_loop
from app.agent.llm.logs import LOG, event
from app.agent.llm.params import CLAUDE_CODE_TYPE
from app.agent.loop import tool_loop
from app.agent.messages import Message, ToolSpec, Turn
from app.agent.results import AgentResult
from app.agent.secrets import SecretBox, SecretUnreadable
from app.agent.tools import AgentTools
from app.db import AgentProvider, AgentSetting, AIProvider, SharedUsage, User
from app.notifications import notify

T = TypeVar("T")

EffectiveReason = Literal["override", "primary", "assistant", "default", "shared", "none"]
SharedMode = Literal["own", "shared", "none"]

# Categories that always notify the user (the key, the quota or the rate limit); a recoverable
# error notifies when the fallback takes over. ProviderError has no separate quota category:
# a quota answer is classified rate_limited.
PROBLEMS = frozenset({"auth_failed", "rate_limited"})

# Agents without an assignment of their own follow this one (the chat panel's agent).
DEFAULT_AGENT = "assistant"

NO_PROVIDER = "No active AI provider: add one or switch one on in Settings."

# A user who ran on a shared configuration this many days back sees the withdrawn warning.
WITHDRAWN_DAYS = 30


def limit_message(limit: int) -> str:
    return (
        f"Daily limit reached: you have used today's {limit} requests on the shared provider. "
        "Add your own provider in Settings, or try again tomorrow."
    )


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


# --- shared mode -----------------------------------------------------------------------


@dataclass
class SharedSetup:
    """How one agent runs for a user in shared mode: the admin's shared rows and switch."""

    primary: AIProvider
    fallback: AIProvider | None
    web_search: bool


def the_admin(session: Session) -> User | None:
    return session.scalars(
        select(User).where(User.role == "admin").order_by(User.created_at, User.id).limit(1)
    ).first()


def shared_rows(session: Session, admin_id: uuid.UUID) -> list[AIProvider]:
    """The admin's configurations other users may run on: shared, active, not Claude Code."""
    return list(
        session.scalars(
            select(AIProvider)
            .where(
                AIProvider.user_id == admin_id,
                AIProvider.shared.is_(True),
                AIProvider.is_active.is_(True),
                AIProvider.provider_type != CLAUDE_CODE_TYPE,
            )
            .order_by(AIProvider.created_at, AIProvider.name)
        )
    )


def in_shared_mode(session: Session, user_id: uuid.UUID) -> uuid.UUID | None:
    """The admin's id when this user runs on shared rows (not the admin, no usable active row
    of their own); else None. The admin's shared rows are their own: never shared mode."""
    admin = the_admin(session)
    if admin is None or admin.id == user_id:
        return None
    if first_active(session, user_id) is not None:
        return None
    return admin.id


def shared_setup(session: Session, user_id: uuid.UUID, agent_id: str) -> SharedSetup | None:
    """The agent's setup in shared mode, or None (not in shared mode, or nothing shared).

    Primary: the admin's primary for the agent (or the assistant's when the agent has no
    assignment of the admin's) when it is shared, else the first shared row. Fallback: the
    admin's matching fallback when it is shared and differs. Internet search: the admin's.
    """
    admin_id = in_shared_mode(session, user_id)
    if admin_id is None:
        return None
    rows = shared_rows(session, admin_id)
    if not rows:
        return None
    allowed = {row.id: row for row in rows}
    assigned, _inherited = own_or_inherited(session, admin_id, agent_id)
    wanted = assigned.get("primary")
    primary = allowed.get(wanted.id, rows[0]) if wanted is not None else rows[0]
    wanted_fallback = assigned.get("fallback")
    fallback = allowed.get(wanted_fallback.id) if wanted_fallback is not None else None
    if fallback is not None and fallback.id == primary.id:
        fallback = None
    return SharedSetup(primary, fallback, web_search_enabled(session, admin_id, agent_id))


def shared_mode(session: Session, user_id: uuid.UUID) -> SharedMode:
    """own: a usable active row of the user's own; shared: shared rows to run on; none."""
    if first_active(session, user_id) is not None:
        return "own"
    admin_id = in_shared_mode(session, user_id)
    if admin_id is not None and shared_rows(session, admin_id):
        return "shared"
    return "none"


def utc_today() -> date:
    return datetime.now(UTC).date()


def resets_at(day: date) -> datetime:
    """The next 00:00 UTC after ``day``."""
    return datetime.combine(day + timedelta(days=1), dtime(0), tzinfo=UTC)


def used_on(session: Session, user_id: uuid.UUID, day: date) -> int:
    row = session.get(SharedUsage, (user_id, day))
    return row.runs if row is not None else 0


def used_recently(session: Session, user_id: uuid.UUID, day: date) -> bool:
    """A shared request of the user within the last WITHDRAWN_DAYS days."""
    found = session.scalars(
        select(SharedUsage.day).where(
            SharedUsage.user_id == user_id,
            SharedUsage.day >= day - timedelta(days=WITHDRAWN_DAYS),
        )
    ).first()
    return found is not None


COUNT_SQL = text(
    "INSERT INTO shared_usage (user_id, day, runs) VALUES (:user_id, :day, 1) "
    "ON CONFLICT (user_id, day) DO UPDATE SET runs = shared_usage.runs + 1 "
    "WHERE shared_usage.runs < :limit "
    "RETURNING runs"
)


def count_shared(session: Session, user_id: uuid.UUID, limit: int, day: date) -> int | None:
    """One atomic count: the new number of runs, or None when the limit was already reached.
    Concurrent requests serialize on the row, so at most ``limit`` ever pass. Not committed."""
    runs = session.execute(COUNT_SQL, {"user_id": user_id, "day": day, "limit": limit}).scalar()
    # A first request of the day inserts 1 even with limit 1; limit >= 1 is enforced.
    return int(runs) if runs is not None else None


def _notify_limit(session: Session, user_id: uuid.UUID, runs: int, limit: int, day: date) -> None:
    """One notice at 80% of the limit and one when it is reached, each at most once a day."""
    if runs == limit:
        key = "limit100"
    elif runs == math.ceil(0.8 * limit):
        key = "limit80"
    else:
        return
    params = {"used": runs, "limit": limit, "resets_at": resets_at(day).isoformat()}
    notify(session, user_id, "shared_limit", params, "#/settings", f"{key}:{day.isoformat()}")


def take_shared_count(session: Session, user_id: uuid.UUID, limit: int) -> None:
    """Count one shared request (committed at once, so a later failure still counts), or
    ResolveError 429 over the limit. Only the user id is logged, never request text."""
    day = utc_today()
    runs = count_shared(session, user_id, limit, day)
    if runs is not None:
        _notify_limit(session, user_id, runs, limit, day)
    session.commit()
    if runs is None:
        LOG.log(logging.INFO, "shared limit", extra={"user_id": str(user_id)})
        raise ResolveError(429, limit_message(limit))


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
    notes = list(before.changed_notes)
    notes += [c for c in after.changed_notes if c not in notes]
    surfaces = list(before.surfaces)
    surfaces += [x for x in after.surfaces if x not in surfaces]
    return AgentResult(
        reply=after.reply,
        steps=[*before.steps, *after.steps],
        changed_lessons=changed,
        changed_notes=notes,
        stopped=after.stopped,
        proposed_topics=after.proposed_topics or before.proposed_topics,
        surfaces=surfaces,
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
        # Shared mode: the rows are the admin's; no model is built before the count is taken.
        self.shared = False
        self.counted = False
        # The Internet search switch that applies to this request.
        self.web_search = False
        # Called with (row, category, fallback_follows) when a provider of the user failed.
        self.on_problem: Callable[[AIProvider, str, bool], None] | None = None

    def _problem(self, row: AIProvider, exc: ProviderError, fallback: bool) -> None:
        """Tell the user's provider problem: a key, quota or rate limit error, or a fallback
        taking over. Not in shared mode: those rows are the admin's, the member cannot act."""
        if (
            self.on_problem is not None
            and not self.shared
            and (fallback or exc.category in PROBLEMS)
        ):
            self.on_problem(row, exc.category, fallback)

    def count(self, session: Session, user_id: uuid.UUID, limit: int) -> None:
        """Take the daily count when the request runs on shared rows (ResolveError 429)."""
        if self.shared and not self.counted:
            take_shared_count(session, user_id, limit)
        self.counted = True

    def count_as_part_of_request(self) -> None:
        """For a run inside a request that already took its count (the `a2ui` agent called from
        the assistant's tool): one chat request is one count, so no second count is taken."""
        self.counted = True

    @property
    def model(self) -> str:
        return self.current.row.model_name

    @property
    def provider(self) -> AIProvider:
        return self.current.row

    def _build(self, candidate: Candidate) -> ChatModel:
        if self.shared and not self.counted:
            raise RuntimeError("a shared request must be counted before a model is built")
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
                self._problem(self.primary.row, exc, exc.recoverable and self.fallback is not None)
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
            if self.current is not self.primary:
                self._problem(self.current.row, exc, False)
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


def problem_reporter(
    session: Session, user_id: uuid.UUID
) -> Callable[[AIProvider, str, bool], None]:
    """Stores a provider problem in its own short transaction: the request that met the error
    often rolls back, and the notice must stay. Never the provider's own message."""
    bind = session.get_bind()

    def report(row: AIProvider, category: str, fallback: bool) -> None:
        params: dict[str, Any] = {
            "provider_id": str(row.id),
            "name": row.name,
            "category": category,
            "fallback": fallback,
        }
        day = utc_today().isoformat()
        try:
            with Session(bind) as own:
                notify(
                    own,
                    user_id,
                    "provider_problem",
                    params,
                    f"#/settings/providers/{row.id}",
                    f"provider:{row.id}:{day}",
                )
                own.commit()
        except SQLAlchemyError:
            LOG.warning("provider notification not stored", extra={"user_id": str(user_id)})

    return report


def resolve_chain(
    session: Session,
    user_id: uuid.UUID,
    box: SecretBox,
    factory: ChatModelFactory,
    agent_id: str,
    override_id: uuid.UUID | None = None,
) -> AgentModel:
    """The model for one agent request, or ResolveError (404 / 409) before any model call.

    The caller must call ``count`` on the result before running it: in shared mode that takes
    the daily count (429 over the limit); a model is never built before.
    """
    if override_id is not None:
        # An override names only the user's own rows; a shared row's id is 404 like any other.
        row = session.scalars(
            select(AIProvider).where(AIProvider.id == override_id, AIProvider.user_id == user_id)
        ).first()
        if row is None:
            raise ResolveError(404, f"no AI provider with id {override_id}")
        if not usable(row, session):
            raise ResolveError(409, NO_PROVIDER)
        if not row.is_active:
            raise ResolveError(409, f"{row.name} is switched off in Settings")
        model = AgentModel(agent_id, row, None, box, factory)
        model.web_search = web_search_enabled(session, user_id, agent_id)
        model.on_problem = problem_reporter(session, user_id)
        return model
    chosen, _reason = effective(session, user_id, agent_id)
    if chosen is None:
        setup = shared_setup(session, user_id, agent_id)
        if setup is None:
            raise ResolveError(409, NO_PROVIDER)
        model = AgentModel(agent_id, setup.primary, setup.fallback, box, factory)
        model.shared = True
        model.web_search = setup.web_search
        model.on_problem = problem_reporter(session, user_id)
        return model
    fallback = own_or_inherited(session, user_id, agent_id)[0].get("fallback")
    if fallback is not None and (
        not fallback.is_active or fallback.id == chosen.id or not usable(fallback, session)
    ):
        fallback = None
    model = AgentModel(agent_id, chosen, fallback, box, factory)
    model.web_search = web_search_enabled(session, user_id, agent_id)
    model.on_problem = problem_reporter(session, user_id)
    return model
