"""The agent chat: one request runs the agent loop on the agent's resolved provider."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.a2ui.interface import ContentSink
from app.a2ui.runner import ChatInteractiveRunner
from app.a2ui.schemas import SurfaceOut
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
from app.agent.resolve import ResolveError, resolve_chain
from app.agent.tools import AgentTools
from app.auth.current import CurrentUser
from app.db import A2uiSurface, AreaAgentSetting, Note, User, get_session
from app.learning.catalog import UserCatalog
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


class ProposedTopic(BaseModel):
    slug: str
    title: str
    description: str
    parent: str | None


class ProposedTopics(BaseModel):
    area: str
    topics: list[ProposedTopic]


class ChatOut(BaseModel):
    reply: str
    steps: list[StepOut]
    changed_lessons: list[str]
    # Ids of notes saved by the assistant in this answer; the panel refreshes the notes list.
    changed_notes: list[str] = []
    stopped: bool
    provider: AnsweredBy
    fallback_used: bool
    effort: Effort
    session: SessionRef
    user_message_id: uuid.UUID
    assistant_message_id: uuid.UUID
    # The outline agent's proposal (not saved): the panel opens it in the topic editor.
    proposed_topics: ProposedTopics | None = None
    # Interactive surfaces made in this answer (no answers inside).
    surfaces: list[SurfaceOut] = []


def area_of_page(catalog: RoadmapCatalog, session: Session, user: User, page: Page) -> str | None:
    """The area (domain id) a page belongs to; the home page belongs to none."""
    if page.kind in ("roadmap", "lesson"):
        return page.domain
    if page.kind == "note" and page.note_id:
        try:
            note_id = uuid.UUID(page.note_id)
        except ValueError:
            return None
        node_id = session.scalar(
            select(Note.node_id).where(Note.id == note_id, Note.user_id == user.id)
        )
        if node_id and catalog.has_node(node_id):
            return node_id.split("/", 1)[0]
    return None


@router.post("/chat", response_model=ChatOut, dependencies=[Depends(require_app_header)])
def chat(
    payload: ChatIn,
    request: Request,
    catalog: UserCatalog,
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
    # Shared mode: one count of the daily limit, before any model is built or called.
    try:
        chat_model.count(session, user.id, request.app.state.settings.shared_daily_limit)
    except ResolveError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    conversation = stored + [Message(role=m.role, text=m.content) for m in payload.messages]
    page = Page(**payload.page.model_dump())
    area = area_of_page(catalog, session, user, page)
    area_row = session.get(AreaAgentSetting, (user.id, area)) if area is not None else None
    area_instructions = area_row.instructions if area_row else ""
    allowed = set(area_row.tools) if area_row and area_row.tools is not None else None
    interactive: ChatInteractiveRunner | None = None
    if agent.id == "assistant":
        # The Interactive tutor runs inside the assistant's tool call, on its own provider chain
        # and inside this request's count (design 1).
        def tutor_tools(sink: ContentSink) -> AgentTools:
            return AgentTools(
                session,
                catalog,
                user_id=user.id,
                agent_id="a2ui",
                store=request.app.state.store,
                content_sink=sink,
            )

        interactive = ChatInteractiveRunner(
            session,
            user,
            catalog,
            page,
            area,
            lambda: resolve_chain(session, user.id, box_of(request), factory_of(request), "a2ui"),
            tutor_tools,
        )
    try:
        result = run_agent(
            chat_model,
            conversation,
            AgentTools(
                session,
                catalog,
                user_id=user.id,
                agent_id=agent.id,
                store=request.app.state.store,
                allowed=allowed,
                kh_search=request.app.state.kh.search_for(user.id),
                interactive=interactive,
            ),
            catalog,
            page,
            request.app.state.settings.agent_max_steps,
            agent.instructions,
            payload.effort,
            [Attachment(name=a.name, text=a.text) for a in payload.attachments],
            web_search=chat_model.web_search,
            area_instructions=area_instructions,
        )
    except ProviderError as exc:
        # A surface the tutor already stored is dropped with the failed request.
        session.rollback()
        if chat_model.shared:
            # The admin's configuration: name, model and error category only, never the
            # provider's own message (it may quote the base URL or the request).
            row = chat_model.provider
            detail = f"{row.name} ({row.model_name}): {exc.category}"
            raise HTTPException(status_code=502, detail=detail) from exc
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
        saved, rows = store_turn(
            session,
            user.id,
            payload.session_id,
            new_messages,
            replace_from,
            before_commit=lambda db, made: link_surfaces(
                db, interactive.made if interactive else [], made[-1].id
            ),
        )
    except LookupError as exc:  # the chat was deleted while the agent was working
        raise HTTPException(status_code=404, detail="chat session not found") from exc
    return ChatOut(
        reply=result.reply,
        steps=steps,
        changed_lessons=result.changed_lessons,
        changed_notes=result.changed_notes,
        stopped=result.stopped,
        provider=AnsweredBy(id=answered.id, name=answered.name, model=answered.model_name),
        fallback_used=chat_model.fallback_used,
        effort=payload.effort,
        session=SessionRef(id=saved.id, title=saved.title),
        user_message_id=rows[-2].id,
        assistant_message_id=rows[-1].id,
        proposed_topics=(
            ProposedTopics.model_validate(result.proposed_topics)
            if result.proposed_topics is not None
            else None
        ),
        surfaces=[SurfaceOut.model_validate(s) for s in result.surfaces],
    )


def link_surfaces(session: Session, made: list[A2uiSurface], message_id: uuid.UUID) -> None:
    """Attach the surfaces made in this request to the stored assistant message; runs inside
    the commit of the turn, so the rows stand or fall with it. They are added again here: when
    store_turn rolls back and retries after a write conflict, the rollback dropped the pending
    rows, and adding them again inserts them with the retried turn."""
    if not made:
        return
    # The new chat messages first: the surfaces' message_id must point at an existing row (no
    # ORM relationship tells the flush that order).
    session.flush()
    for row in made:
        row.message_id = message_id
        session.add(row)
