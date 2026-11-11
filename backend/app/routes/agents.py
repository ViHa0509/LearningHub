"""Agents and their primary and fallback providers."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.agent.agents import AGENTS, AgentDef
from app.agent.resolve import assignments, effective, web_search_enabled
from app.auth.current import CurrentUser
from app.db import AgentProvider, AgentSetting, AIProvider, get_session
from app.routes.guard import require_app_header

router = APIRouter(prefix="/api/agents", tags=["agents"])


class ProviderRef(BaseModel):
    id: uuid.UUID
    name: str
    provider_type: str
    model_name: str
    is_active: bool
    last_test_status: str | None


class AgentOut(BaseModel):
    id: str
    name: str
    description: str
    primary: ProviderRef | None
    fallback: ProviderRef | None
    effective: ProviderRef | None
    effective_reason: Literal["override", "primary", "assistant", "default", "none"]
    web_search: bool


class SettingsIn(BaseModel):
    web_search: bool


class AssignmentIn(BaseModel):
    primary_provider_id: uuid.UUID | None = None
    fallback_provider_id: uuid.UUID | None = None


def ref(row: AIProvider | None) -> ProviderRef | None:
    if row is None:
        return None
    return ProviderRef(
        id=row.id,
        name=row.name,
        provider_type=row.provider_type,
        model_name=row.model_name,
        is_active=row.is_active,
        last_test_status=row.last_test_status,
    )


def agent_out(session: Session, user_id: uuid.UUID, agent: AgentDef) -> AgentOut:
    assigned = assignments(session, user_id, agent.id)
    chosen, reason = effective(session, user_id, agent.id)
    return AgentOut(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        primary=ref(assigned.get("primary")),
        fallback=ref(assigned.get("fallback")),
        effective=ref(chosen),
        effective_reason=reason,
        web_search=web_search_enabled(session, user_id, agent.id),
    )


def get_agent(agent_id: str) -> AgentDef:
    agent = AGENTS.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"unknown agent '{agent_id}'")
    return agent


@router.get("", response_model=list[AgentOut])
def list_agents(
    session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> list[AgentOut]:
    return [agent_out(session, user.id, agent) for agent in AGENTS.values()]


@router.get("/{agent_id}/provider", response_model=AgentOut)
def read_assignment(
    agent_id: str, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> AgentOut:
    return agent_out(session, user.id, get_agent(agent_id))


@router.put(
    "/{agent_id}/provider",
    response_model=AgentOut,
    dependencies=[Depends(require_app_header)],
)
def save_assignment(
    agent_id: str,
    payload: AssignmentIn,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> AgentOut:
    """Set or clear (null) the primary and fallback; both must be the user's and differ."""
    agent = get_agent(agent_id)
    errors: list[dict[str, str]] = []
    wanted = {"primary": payload.primary_provider_id, "fallback": payload.fallback_provider_id}
    for provider_id in wanted.values():
        if provider_id is None:
            continue
        owned = session.scalars(
            select(AIProvider.id).where(AIProvider.id == provider_id, AIProvider.user_id == user.id)
        ).first()
        if owned is None:  # another user's provider looks like a missing one
            raise HTTPException(status_code=404, detail=f"no AI provider with id {provider_id}")
    if (
        payload.primary_provider_id is not None
        and payload.primary_provider_id == payload.fallback_provider_id
    ):
        errors.append(
            {"field": "fallback_provider_id", "msg": "the fallback must differ from the primary"}
        )
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    session.execute(
        delete(AgentProvider).where(
            AgentProvider.user_id == user.id, AgentProvider.agent_id == agent.id
        )
    )
    for role, provider_id in wanted.items():
        if provider_id is not None:
            session.add(
                AgentProvider(
                    user_id=user.id, agent_id=agent.id, role=role, provider_id=provider_id
                )
            )
    session.commit()
    return agent_out(session, user.id, agent)


@router.put(
    "/{agent_id}/settings",
    response_model=AgentOut,
    dependencies=[Depends(require_app_header)],
)
def save_settings(
    agent_id: str,
    payload: SettingsIn,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> AgentOut:
    """Save the agent's switches (Internet search)."""
    agent = get_agent(agent_id)
    row = session.get(AgentSetting, (user.id, agent.id))
    if row is None:
        session.add(AgentSetting(user_id=user.id, agent_id=agent.id, web_search=payload.web_search))
    else:
        row.web_search = payload.web_search
    session.commit()
    return agent_out(session, user.id, agent)
