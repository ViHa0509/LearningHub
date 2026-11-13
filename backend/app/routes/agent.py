"""The agent chat: one request runs the agent loop on the agent's resolved provider."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent.agents import AGENTS
from app.agent.history import (
    NewMessage,
    find_session,
    find_user_message,
    load_history,
    store_turn,
)
from app.agent.loop import Attachment, Effort, Page, run_agent
from app.agent.messages import Message, ProviderError
from app.agent.ratelimit import RateLimiter
from app.agent.resolve import ResolveError, resolve_chain, web_search_enabled
from app.agent.tools import AgentTools
from app.auth.current import CurrentUser
from app.db import get_session
from app.roadmaps import RoadmapCatalog
from app.routes.guard import box_of, factory_of, require_app_header

router = APIRouter(prefix="/api/agent", tags=["agent"])

ID = r"^[A-Za-z0-9_-]{1,100}$"


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)
    # What the user typed (a skill message is sent expanded); stored, never sent to the model.
    display: str | None = Field(default=None, max_length=20_000)


class PageIn(BaseModel):
    kind: Literal["home", "roadmap", "lesson", "note"] = "home"
    domain: str | None = Field(default=None, pattern=ID)
    node: str | None = Field(default=None, pattern=ID)
    note_id: str | None = Field(default=None, pattern=ID)


class AttachmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    text: str = Field(max_length=100_000)


class ChatIn(BaseModel):
    agent_id: str = "assistant"
    provider_id: uuid.UUID | None = None
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=50)
    page: PageIn = PageIn()
    effort: Effort = "medium"
    # Text files attached to the last user message; they are data, like note content.
    attachments: list[AttachmentIn] = Field(default_factory=list, max_length=5)
    # Continue a stored chat: the request then carries only the new user message.
    session_id: uuid.UUID | None = None
    # Retry from a stored user message of that chat: it and what follows are replaced.
    retry_from: uuid.UUID | None = None


class StepOut(BaseModel):
    tool: str
    input: dict[str, Any]
    summary: str


class AnsweredBy(BaseModel):
    id: uuid.UUID
    name: str
    model: str


class SessionRef(BaseModel):
    id: uuid.UUID
    title: str


class ChatOut(BaseModel):
    reply: str
    steps: list[StepOut]
    changed_lessons: list[str]
    stopped: bool
    provider: AnsweredBy
    fallback_used: bool
    effort: Effort
    session: SessionRef
    user_message_id: uuid.UUID
    assistant_message_id: uuid.UUID


@router.post("/chat", response_model=ChatOut, dependencies=[Depends(require_app_header)])
def chat(
    payload: ChatIn,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> ChatOut:
    agent = AGENTS.get(payload.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"unknown agent '{payload.agent_id}'")
    if payload.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="the last message must be the user's")
    # A stored chat is checked before a provider is resolved or a rate-limit slot is used.
    stored: list[Message] = []
    replace_from: int | None = None
    if payload.session_id is None:
        if payload.retry_from is not None:
            raise HTTPException(status_code=400, detail="retry_from needs a session_id")
    else:
        if len(payload.messages) != 1:
            raise HTTPException(
                status_code=400,
                detail="a request with a session_id carries only the new user message",
            )
        chat_session = find_session(session, user.id, payload.session_id)
        if chat_session is None:
            raise HTTPException(status_code=404, detail="chat session not found")
        if payload.retry_from is not None:
            retried = find_user_message(session, chat_session, payload.retry_from)
            if retried is None:
                raise HTTPException(status_code=404, detail="chat message not found")
            replace_from = retried.position
        stored = [
            Message(role="user" if m.role == "user" else "assistant", text=m.content)
            for m in load_history(session, chat_session, before=replace_from)
        ]
    try:
        chat_model = resolve_chain(
            session, user.id, box_of(request), factory_of(request), agent.id, payload.provider_id
        )
    except ResolveError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    limiter: RateLimiter = request.app.state.rate_limiter
    wait = limiter.acquire(str(user.id))
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many agent requests: at most {limiter.per_minute} per minute. "
            f"Try again in {wait} s.",
            headers={"Retry-After": str(wait)},
        )

    catalog: RoadmapCatalog = request.app.state.catalog
    conversation = stored + [Message(role=m.role, text=m.content) for m in payload.messages]
    page = Page(**payload.page.model_dump())
    try:
        result = run_agent(
            chat_model,
            conversation,
            AgentTools(session, catalog, user_id=user.id),
            catalog,
            page,
            request.app.state.settings.agent_max_steps,
            agent.instructions,
            payload.effort,
            [Attachment(name=a.name, text=a.text) for a in payload.attachments],
            web_search=web_search_enabled(session, user.id, agent.id),
        )
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    answered = chat_model.provider
    steps = [StepOut(tool=s.tool, input=s.input, summary=s.summary) for s in result.steps]
    # Stored once, after the answer: a failed request leaves no trace in the session.
    new_messages = [
        NewMessage(role=m.role, content=m.content, display=m.display, agent_id=agent.id)
        if m.role == "user"
        else NewMessage(role=m.role, content=m.content)
        for m in payload.messages
    ]
    new_messages[-1].attachments = [a.name for a in payload.attachments]
    new_messages.append(
        NewMessage(
            role="assistant",
            content=result.reply,
            steps=[s.model_dump() for s in steps],
            stopped=result.stopped,
            provider_name=answered.name,
            model_name=answered.model_name,
            fallback_used=chat_model.fallback_used,
            effort=payload.effort,
        )
    )
    try:
        saved, rows = store_turn(session, user.id, payload.session_id, new_messages, replace_from)
    except LookupError as exc:  # the chat was deleted while the agent was working
        raise HTTPException(status_code=404, detail="chat session not found") from exc
    return ChatOut(
        reply=result.reply,
        steps=steps,
        changed_lessons=result.changed_lessons,
        stopped=result.stopped,
        provider=AnsweredBy(id=answered.id, name=answered.name, model=answered.model_name),
        fallback_used=chat_model.fallback_used,
        effort=payload.effort,
        session=SessionRef(id=saved.id, title=saved.title),
        user_message_id=rows[-2].id,
        assistant_message_id=rows[-1].id,
    )
