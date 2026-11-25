"""Agents and their primary and fallback providers."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.agent.agents import AGENTS, AgentDef
from app.agent.resolve import (
    EffectiveReason,
    SharedMode,
    assignments,
    effective,
    resets_at,
    shared_mode,
    shared_setup,
    used_on,
    used_recently,
    utc_today,
    web_search_enabled,
)
from app.agent.tools import A2UI_READ_TOOLS, ASSISTANT_SPECS, KH_TOOL, OUTLINE_SPECS, SPECS
from app.auth.current import CurrentUser
from app.db import AgentProvider, AgentSetting, AIProvider, AreaAgentSetting, get_session
from app.learning.catalog import UserCatalog
from app.roadmaps import Domain
from app.routes.guard import require_app_header
from app.schemas import AgentToolOut, AreaAgentIn, AreaAgentOut

router = APIRouter(prefix="/api/agents", tags=["agents"])


class ProviderRef(BaseModel):
    id: uuid.UUID
    name: str
    provider_type: str
    model_name: str
    is_active: bool
    last_test_status: str | None
    # A configuration the admin shares, as a user in shared mode sees it (false for own rows).
    shared: bool = False


class AgentOut(BaseModel):
    id: str
    name: str
    description: str
    primary: ProviderRef | None
    fallback: ProviderRef | None
    effective: ProviderRef | None
    effective_reason: EffectiveReason
    web_search: bool


class SharedStatusOut(BaseModel):
    mode: SharedMode
    used_today: int
    daily_limit: int
    resets_at: datetime
    withdrawn: bool


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


def shared_ref(row: AIProvider) -> ProviderRef:
    """Another user's view of a shared row: name and model; no key hint, URL or test result."""
    return ProviderRef(
        id=row.id,
        name=row.name,
        provider_type=row.provider_type,
        model_name=row.model_name,
        is_active=row.is_active,
        last_test_status=None,
        shared=True,
    )


def agent_out(session: Session, user_id: uuid.UUID, agent: AgentDef) -> AgentOut:
    setup = shared_setup(session, user_id, agent.id)
    if setup is not None:
        return AgentOut(
            id=agent.id,
            name=agent.name,
            description=agent.description,
            primary=None,
            fallback=None,
            effective=shared_ref(setup.primary),
            effective_reason="shared",
            web_search=setup.web_search,
        )
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


def area_out(domain: Domain, row: AreaAgentSetting | None) -> AreaAgentOut:
    return AreaAgentOut(
        domain_id=domain.id,
        title=domain.title,
        field_title=domain.field_title,
        editable=domain.editable,
        instructions=row.instructions if row else "",
        tools=list(row.tools) if row and row.tools is not None else None,
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


@router.get("/shared", response_model=SharedStatusOut)
def shared_status(
    request: Request, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> SharedStatusOut:
    """How the user runs the agents, and their count of shared requests today (UTC)."""
    today = utc_today()
    mode = shared_mode(session, user.id)
    return SharedStatusOut(
        mode=mode,
        used_today=used_on(session, user.id, today),
        daily_limit=request.app.state.settings.shared_daily_limit,
        resets_at=resets_at(today),
        withdrawn=mode == "none" and used_recently(session, user.id, today),
    )


def tool_catalog(kh_available: bool = False) -> list[AgentToolOut]:
    """Every app tool with the agents that get it (order as in the specs); ``kh_search`` only
    on a server where the Knowledge Hub connector is available."""
    groups = (
        (SPECS, ["assistant", "lesson-writer", "outline"]),
        (ASSISTANT_SPECS, ["assistant"]),
        (OUTLINE_SPECS, ["outline"]),
    )
    return [
        AgentToolOut(
            name=spec.name,
            description=spec.description.split(". ")[0],
            agents=[*agents, "a2ui"] if spec.name in A2UI_READ_TOOLS else list(agents),
        )
        for specs, agents in groups
        for spec in specs
        if kh_available or spec.name != KH_TOOL
    ]


def own_tools(agent_id: str, kh_available: bool = True) -> list[str]:
    """The tools an agent has, in catalog order."""
    return [t.name for t in tool_catalog(kh_available) if agent_id in t.agents]


def effective_tools(
    session: Session, user_id: uuid.UUID, agent_id: str, area_tools: list[str] | None
) -> set[str] | None:
    """What the agent may use: its own tools (or the area's ticks) minus the user's removed ones.
    None means no limit."""
    row = session.get(AgentSetting, (user_id, agent_id))
    disabled = set(row.disabled_tools or []) if row else set()
    if area_tools is None and not disabled:
        return None
    base = set(own_tools(agent_id)) if area_tools is None else set(area_tools)
    return base - disabled


class AgentToolsIn(BaseModel):
    attached: list[str]


class AgentToolsOut(BaseModel):
    agent_id: str
    attached: list[str]
    available: list[str]


def tools_out(session: Session, user_id: uuid.UUID, agent_id: str, kh: bool) -> AgentToolsOut:
    row = session.get(AgentSetting, (user_id, agent_id))
    disabled = set(row.disabled_tools or []) if row else set()
    own = own_tools(agent_id, kh)
    return AgentToolsOut(
        agent_id=agent_id,
        attached=[n for n in own if n not in disabled],
        available=[n for n in own if n in disabled],
    )


def tool_agent(agent_id: str) -> AgentDef:
    """The agent, or 404 for an unknown one and for one without tools (Note sorter)."""
    agent = get_agent(agent_id)
    if not own_tools(agent.id):
        raise HTTPException(status_code=404, detail=f"agent '{agent_id}' has no tools")
    return agent


@router.get("/{agent_id}/tools", response_model=AgentToolsOut)
def read_agent_tools(
    agent_id: str,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> AgentToolsOut:
    return tools_out(session, user.id, tool_agent(agent_id).id, request.app.state.kh.available)


@router.put(
    "/{agent_id}/tools",
    response_model=AgentToolsOut,
    dependencies=[Depends(require_app_header)],
)
def save_agent_tools(
    agent_id: str,
    payload: AgentToolsIn,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> AgentToolsOut:
    """Keep the listed tools attached; the rest are stored as removed."""
    agent = tool_agent(agent_id)
    kh = request.app.state.kh.available
    own = own_tools(agent.id, kh)
    for name in payload.attached:
        if name not in own:
            raise HTTPException(status_code=422, detail=f"not a tool of this agent: {name}")
    removed = [n for n in own if n not in payload.attached]
    row = session.get(AgentSetting, (user.id, agent.id))
    if row is None:
        row = AgentSetting(user_id=user.id, agent_id=agent.id)
        session.add(row)
    row.disabled_tools = removed or None
    session.commit()
    return tools_out(session, user.id, agent.id, kh)


@router.get("/tools", response_model=list[AgentToolOut])
def list_tools(request: Request, user: CurrentUser) -> list[AgentToolOut]:
    return tool_catalog(request.app.state.kh.available)


@router.get("/areas", response_model=list[AreaAgentOut])
def list_areas(
    catalog: UserCatalog, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> list[AreaAgentOut]:
    rows = {
        row.domain_id: row
        for row in session.scalars(
            select(AreaAgentSetting).where(AreaAgentSetting.user_id == user.id)
        )
    }
    return [area_out(domain, rows.get(domain.id)) for domain in catalog.domains()]


@router.put(
    "/areas/{domain_id}",
    response_model=AreaAgentOut,
    dependencies=[Depends(require_app_header)],
)
def save_area(
    domain_id: str,
    payload: AreaAgentIn,
    request: Request,
    catalog: UserCatalog,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> AreaAgentOut:
    """Save the extra instructions and tools of one area; the defaults delete the row."""
    domain = catalog.domain(domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"unknown domain '{domain_id}'")
    tools: list[str] | None = None
    if payload.tools is not None:
        known = {tool.name for tool in tool_catalog(request.app.state.kh.available)}
        for name in payload.tools:
            if name not in known:
                raise HTTPException(status_code=422, detail=f"unknown tool: {name}")
        tools = sorted(set(payload.tools))
    row = session.get(AreaAgentSetting, (user.id, domain.id))
    if not payload.instructions and tools is None:
        if row is not None:
            session.delete(row)
            session.commit()
        return area_out(domain, None)
    if row is None:
        row = AreaAgentSetting(user_id=user.id, domain_id=domain.id)
        session.add(row)
    row.instructions = payload.instructions
    row.tools = tools
    session.commit()
    return area_out(domain, row)


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
