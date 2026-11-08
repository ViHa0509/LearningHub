"""Agents and their primary and fallback providers."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.agent.agents import AGENTS, AgentDef
from app.agent.resolve import assignments, effective
from app.db import AgentProvider, AIProvider, get_session
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


def agent_out(session: Session, agent: AgentDef) -> AgentOut:
    assigned = assignments(session, agent.id)
    chosen, reason = effective(session, agent.id)
    return AgentOut(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        primary=ref(assigned.get("primary")),
        fallback=ref(assigned.get("fallback")),
        effective=ref(chosen),
        effective_reason=reason,
    )


def get_agent(agent_id: str) -> AgentDef:
    agent = AGENTS.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"unknown agent '{agent_id}'")
    return agent


@router.get("", response_model=list[AgentOut])
def list_agents(session: Annotated[Session, Depends(get_session)]) -> list[AgentOut]:
    return [agent_out(session, agent) for agent in AGENTS.values()]


@router.get("/{agent_id}/provider", response_model=AgentOut)
def read_assignment(agent_id: str, session: Annotated[Session, Depends(get_session)]) -> AgentOut:
    return agent_out(session, get_agent(agent_id))


@router.put(
    "/{agent_id}/provider",
    response_model=AgentOut,
    dependencies=[Depends(require_app_header)],
)
def save_assignment(
    agent_id: str, payload: AssignmentIn, session: Annotated[Session, Depends(get_session)]
) -> AgentOut:
    """Set or clear (null) the primary and fallback; both must exist and differ."""
    agent = get_agent(agent_id)
    errors: list[dict[str, str]] = []
    wanted = {"primary": payload.primary_provider_id, "fallback": payload.fallback_provider_id}
    for role, provider_id in wanted.items():
        if provider_id is not None and session.get(AIProvider, provider_id) is None:
            errors.append({"field": f"{role}_provider_id", "msg": "no AI provider with this id"})
    if (
        payload.primary_provider_id is not None
        and payload.primary_provider_id == payload.fallback_provider_id
    ):
        errors.append(
            {"field": "fallback_provider_id", "msg": "the fallback must differ from the primary"}
        )
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    session.execute(delete(AgentProvider).where(AgentProvider.agent_id == agent.id))
    for role, provider_id in wanted.items():
        if provider_id is not None:
            session.add(AgentProvider(agent_id=agent.id, role=role, provider_id=provider_id))
    session.commit()
    return agent_out(session, agent)
