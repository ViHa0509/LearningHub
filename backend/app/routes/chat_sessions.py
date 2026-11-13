"""Stored agent chats: list, read, rename and delete the signed-in user's chat sessions."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agent.history import find_session, messages_of
from app.auth.current import CurrentUser
from app.db import ChatMessage, ChatSession, get_session
from app.routes.guard import require_app_header

router = APIRouter(prefix="/api/agent/sessions", tags=["agent"])

NOT_FOUND = "chat session not found"
TITLE_MAX = 120


class SessionSummary(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    last_message_at: datetime
    message_count: int


class SessionList(BaseModel):
    sessions: list[SessionSummary]
    total: int


class StoredStep(BaseModel):
    tool: str
    input: dict[str, Any]
    summary: str


class StoredProvider(BaseModel):
    name: str
    model: str


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    display: str | None
    agent_id: str | None
    attachments: list[str]
    steps: list[StoredStep]
    stopped: bool
    provider: StoredProvider | None
    fallback_used: bool
    effort: str | None
    created_at: datetime


class SessionDetail(SessionSummary):
    messages: list[MessageOut]


class RenameIn(BaseModel):
    title: str = Field(max_length=2000)

    @field_validator("title")
    @classmethod
    def trimmed(cls, value: str) -> str:
        title = value.strip()
        if not title or len(title) > TITLE_MAX:
            raise ValueError(f"the title must have 1 to {TITLE_MAX} characters")
        return title


def summary(chat: ChatSession, count: int) -> SessionSummary:
    return SessionSummary(
        id=chat.id,
        title=chat.title,
        created_at=chat.created_at,
        last_message_at=chat.last_message_at,
        message_count=count,
    )


def count_of(db: Session, chat: ChatSession) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(ChatMessage).where(ChatMessage.session_id == chat.id)
        )
        or 0
    )


def owned(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> ChatSession:
    chat = find_session(db, user_id, session_id)
    if chat is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return chat


def message_out(message: ChatMessage) -> MessageOut:
    provider = (
        StoredProvider(name=message.provider_name, model=message.model_name or "")
        if message.provider_name is not None
        else None
    )
    return MessageOut(
        id=message.id,
        role=message.role,
        content=message.content,
        display=message.display,
        agent_id=message.agent_id,
        attachments=message.attachments,
        steps=[StoredStep(**step) for step in message.steps],
        stopped=message.stopped,
        provider=provider,
        fallback_used=message.fallback_used,
        effort=message.effort,
        created_at=message.created_at,
    )


@router.get("", response_model=SessionList)
def list_sessions(
    db: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SessionList:
    counts = (
        select(ChatMessage.session_id, func.count().label("n"))
        .group_by(ChatMessage.session_id)
        .subquery()
    )
    rows = db.execute(
        select(ChatSession, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.session_id == ChatSession.id)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.last_message_at.desc(), ChatSession.id)
        .limit(limit)
        .offset(offset)
    ).all()
    total = (
        db.scalar(
            select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user.id)
        )
        or 0
    )
    return SessionList(sessions=[summary(chat, count) for chat, count in rows], total=total)


@router.get("/{session_id}", response_model=SessionDetail)
def read_session(
    session_id: uuid.UUID, db: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> SessionDetail:
    chat = owned(db, user.id, session_id)
    messages = [message_out(m) for m in messages_of(db, chat)]
    return SessionDetail(**summary(chat, len(messages)).model_dump(), messages=messages)


@router.patch(
    "/{session_id}", response_model=SessionSummary, dependencies=[Depends(require_app_header)]
)
def rename_session(
    session_id: uuid.UUID,
    payload: RenameIn,
    db: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> SessionSummary:
    chat = owned(db, user.id, session_id)
    chat.title = payload.title
    db.commit()
    db.refresh(chat)
    return summary(chat, count_of(db, chat))


@router.delete("/{session_id}", status_code=204, dependencies=[Depends(require_app_header)])
def delete_session(
    session_id: uuid.UUID, db: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> Response:
    chat = owned(db, user.id, session_id)
    db.delete(chat)
    db.commit()
    return Response(status_code=204)
