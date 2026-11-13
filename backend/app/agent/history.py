"""Stored chat sessions: loading a session's history and storing an answered turn.

Every function takes the current user's id and loads the session for that user first; a message
is only ever reached through its session.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import ChatMessage, ChatSession

TITLE_MAX = 60
DEFAULT_TITLE = "New chat"
# The most stored messages sent to the model as history (the request limit of a stateless chat).
HISTORY_WINDOW = 50


@dataclass
class NewMessage:
    """A message to store. ``attachments`` holds file names only."""

    role: str
    content: str
    display: str | None = None
    agent_id: str | None = None
    attachments: list[str] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    stopped: bool = False
    provider_name: str | None = None
    model_name: str | None = None
    fallback_used: bool = False
    effort: str | None = None


def title_of(display: str | None, content: str) -> str:
    """The first 60 characters of what the user typed; "New chat" when they typed nothing."""
    source = display if display is not None else content
    title = " ".join(source.split())[:TITLE_MAX].strip()
    return title or DEFAULT_TITLE


def find_session(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> ChatSession | None:
    return db.scalars(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
    ).first()


def find_user_message(db: Session, chat: ChatSession, message_id: uuid.UUID) -> ChatMessage | None:
    return db.scalars(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.session_id == chat.id,
            ChatMessage.role == "user",
        )
    ).first()


def messages_of(db: Session, chat: ChatSession) -> list[ChatMessage]:
    return list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.session_id == chat.id)
            .order_by(ChatMessage.position)
        )
    )


def load_history(db: Session, chat: ChatSession, before: int | None = None) -> list[ChatMessage]:
    """The stored conversation sent to the model: the most recent messages (those before
    position ``before`` for a retry), starting at a user message."""
    query = select(ChatMessage).where(ChatMessage.session_id == chat.id)
    if before is not None:
        query = query.where(ChatMessage.position < before)
    recent = list(db.scalars(query.order_by(ChatMessage.position.desc()).limit(HISTORY_WINDOW)))
    recent.reverse()
    while recent and recent[0].role != "user":
        recent.pop(0)
    return recent


def store_turn(
    db: Session,
    user_id: uuid.UUID,
    chat_id: uuid.UUID | None,
    messages: list[NewMessage],
    replace_from: int | None = None,
) -> tuple[ChatSession, list[ChatMessage]]:
    """Store ``messages`` at the end of the session in one commit; without ``chat_id`` a new
    session is created, titled from its first user message. ``replace_from`` (a retry) first
    removes the messages from that position on.

    Another tab may append to the same session at the same time: the position is unique per
    session, so a conflict is retried once with fresh positions.
    """
    for attempt in (1, 2):
        try:
            return _store(db, user_id, chat_id, messages, replace_from)
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise
    raise AssertionError("unreachable")


def _store(
    db: Session,
    user_id: uuid.UUID,
    chat_id: uuid.UUID | None,
    messages: list[NewMessage],
    replace_from: int | None,
) -> tuple[ChatSession, list[ChatMessage]]:
    now = datetime.now(UTC)
    if chat_id is None:
        first = next((m for m in messages if m.role == "user"), messages[0])
        chat = ChatSession(
            id=uuid.uuid4(),
            user_id=user_id,
            title=title_of(first.display, first.content),
            last_message_at=now,
        )
        db.add(chat)
        db.flush()
        position = 0
    else:
        found = find_session(db, user_id, chat_id)
        if found is None:
            raise LookupError("chat session not found")
        chat = found
        if replace_from is not None:
            db.execute(
                delete(ChatMessage).where(
                    ChatMessage.session_id == chat.id, ChatMessage.position >= replace_from
                )
            )
            position = replace_from
        else:
            last = db.scalar(
                select(func.max(ChatMessage.position)).where(ChatMessage.session_id == chat.id)
            )
            position = 0 if last is None else last + 1
        chat.last_message_at = now
    rows = []
    for offset, message in enumerate(messages):
        row = ChatMessage(
            id=uuid.uuid4(),
            session_id=chat.id,
            position=position + offset,
            role=message.role,
            content=message.content,
            display=message.display,
            agent_id=message.agent_id,
            attachments=list(message.attachments),
            steps=list(message.steps),
            stopped=message.stopped,
            provider_name=message.provider_name,
            model_name=message.model_name,
            fallback_used=message.fallback_used,
            effort=message.effort,
        )
        db.add(row)
        rows.append(row)
    db.commit()
    return chat, rows
