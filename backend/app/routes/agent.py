from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent.loop import Page, run_agent
from app.agent.messages import Message, ProviderError
from app.agent.providers import CATALOG, ChatProvider
from app.agent.tools import AgentTools
from app.db import get_session
from app.roadmaps import RoadmapCatalog

router = APIRouter(prefix="/api/agent", tags=["agent"])

ID = r"^[A-Za-z0-9_-]{1,100}$"


class ProviderOut(BaseModel):
    id: str
    label: str
    available: bool
    setting: str
    models: list[str]
    default_model: str


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
    model: str = Field(pattern=r"^[A-Za-z0-9._:/-]{1,100}$")
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


def providers_of(request: Request) -> dict[str, ChatProvider]:
    providers: dict[str, ChatProvider] = request.app.state.providers
    return providers


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(request: Request) -> list[ProviderOut]:
    available = providers_of(request)
    return [
        ProviderOut(
            id=p.id,
            label=p.label,
            available=p.id in available,
            setting=p.setting,
            models=list(p.models),
            default_model=p.default_model,
        )
        for p in CATALOG
    ]


@router.post("/chat", response_model=ChatOut)
def chat(
    payload: ChatIn, request: Request, session: Annotated[Session, Depends(get_session)]
) -> ChatOut:
    info = next((p for p in CATALOG if p.id == payload.provider), None)
    if info is None:
        raise HTTPException(status_code=400, detail=f"unknown provider '{payload.provider}'")
    provider = providers_of(request).get(info.id)
    if provider is None:
        raise HTTPException(
            status_code=409,
            detail=f"{info.label} is not configured: set {info.setting} in backend/.env "
            "and restart the backend",
        )
    if payload.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="the last message must be the user's")

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
