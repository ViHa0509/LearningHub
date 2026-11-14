"""Build a backup archive of one user: notes with files, lessons, providers (no keys), agent data.

The archive never holds accounts, sessions, one-time tokens, passwords, API keys or OAuth
secrets: those tables are not read, and the provider rows are built without key columns.
"""

import json
import re
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import IO, Annotated, Any, Literal

from alembic.config import Config
from alembic.script import ScriptDirectory
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import (
    AgentProvider,
    AgentSetting,
    AIProvider,
    ChatMessage,
    ChatSession,
    LearningArea,
    LearningField,
    LearningTopic,
    Lesson,
    Note,
)
from app.storage import FileStore

FORMAT = 1
MAX_ENTRIES = 20_000
MAX_TOTAL_BYTES = 2 * 1024**3
ALEMBIC_DIR = Path(__file__).resolve().parents[2] / "alembic"
DATA_FILES = {
    "notes": "data/notes.json",
    "lessons": "data/lessons.json",
    "ai_providers": "data/ai_providers.json",
    "agent_providers": "data/agent_providers.json",
    "agent_settings": "data/agent_settings.json",
}
# Entries a restore accepts but does not require (older backups do not have them).
OPTIONAL_FILES = {
    "chat_sessions": "data/chat_sessions.json",
    "learning_fields": "data/learning_fields.json",
}
# An answer has no request limit; this bounds what a restore accepts for one message.
MAX_MESSAGE_CHARS = 1_000_000
SHA = re.compile(r"^[0-9a-f]{64}$")
BLOB_KEY = re.compile(r"^blobs/([0-9a-f]{2})/([0-9a-f]{64})(\.html|\.htm|\.pdf)$")


class Row(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")


class NoteRow(Row):
    id: uuid.UUID
    title: str
    body_text: str
    original_name: str
    size_bytes: int = Field(ge=0)
    content_sha256: str = Field(pattern=SHA.pattern)
    storage_key: str = Field(pattern=BLOB_KEY.pattern)
    node_id: str | None = None
    source: str = "import"
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LessonRow(Row):
    node_id: str
    body: str
    source: str
    updated_at: datetime


class ProviderRow(Row):
    """A provider configuration without any key column."""

    id: uuid.UUID
    name: str
    provider_type: str
    model_name: str
    base_url: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class AgentProviderRow(Row):
    agent_id: str
    role: str
    provider_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AgentSettingRow(Row):
    agent_id: str
    web_search: bool
    updated_at: datetime


class ChatStepRow(Row):
    tool: str = Field(max_length=200)
    input: dict[str, Any] = Field(default_factory=dict)
    summary: str = Field(max_length=20_000)


class ChatMessageRow(Row):
    """A stored chat message: text and file names only, never the text of attached files."""

    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)
    display: str | None = Field(default=None, max_length=20_000)
    agent_id: str | None = Field(default=None, max_length=100)
    attachments: list[Annotated[str, Field(max_length=255)]] = Field(
        default_factory=list, max_length=5
    )
    steps: list[ChatStepRow] = Field(default_factory=list, max_length=50)
    stopped: bool = False
    provider_name: str | None = Field(default=None, max_length=200)
    model_name: str | None = Field(default=None, max_length=200)
    fallback_used: bool = False
    effort: str | None = Field(default=None, max_length=20)
    created_at: datetime


class ChatSessionRow(Row):
    """A chat session with its messages nested, in order."""

    title: str = Field(min_length=1, max_length=120)
    created_at: datetime
    last_message_at: datetime
    messages: list[ChatMessageRow] = Field(default_factory=list)


class TopicRow(Row):
    slug: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    parent_slug: str | None = None
    position: int = Field(ge=0)


class AreaRow(Row):
    slug: str = Field(min_length=2, max_length=40)
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=200)
    position: int = Field(ge=0)
    topics: list[TopicRow] = Field(default_factory=list, max_length=300)


class FieldRow(Row):
    """A learning field with its areas and their topics nested, in order."""

    title: str = Field(min_length=1, max_length=60)
    position: int = Field(ge=0)
    published: bool = False
    created_at: datetime
    updated_at: datetime
    areas: list[AreaRow] = Field(default_factory=list)


class Manifest(BaseModel):
    format: int
    app_version: str
    migration: str
    created_at: str
    counts: dict[str, int]
    skipped_notes: int = 0


def migration_head() -> str:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    head = ScriptDirectory.from_config(config).get_current_head()
    assert head is not None
    return head


def known_migrations() -> set[str]:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    return {s.revision for s in ScriptDirectory.from_config(config).walk_revisions()}


def _dump(rows: list[Any], model: type[Row]) -> bytes:
    items = [model.model_validate(row).model_dump(mode="json") for row in rows]
    return json.dumps(items, ensure_ascii=False, indent=1).encode("utf-8")


def _field_rows(session: Session, user_id: uuid.UUID) -> list[FieldRow]:
    """The user's fields with their areas and topics, in order (ids are left out)."""
    fields = list(
        session.scalars(
            select(LearningField)
            .where(LearningField.user_id == user_id)
            .order_by(LearningField.position, LearningField.created_at, LearningField.id)
        )
    )
    areas: dict[uuid.UUID, list[LearningArea]] = {f.id: [] for f in fields}
    topics: dict[uuid.UUID, list[LearningTopic]] = {}
    for area in session.scalars(
        select(LearningArea)
        .where(LearningArea.field_id.in_(list(areas)))
        .order_by(LearningArea.position, LearningArea.slug)
    ):
        areas[area.field_id].append(area)
        topics[area.id] = []
    for topic in session.scalars(
        select(LearningTopic)
        .where(LearningTopic.area_id.in_(list(topics)))
        .order_by(LearningTopic.area_id, LearningTopic.position)
    ):
        topics[topic.area_id].append(topic)
    return [
        FieldRow(
            title=f.title,
            position=f.position,
            published=f.published,
            created_at=f.created_at,
            updated_at=f.updated_at,
            areas=[
                AreaRow(
                    slug=a.slug,
                    title=a.title,
                    description=a.description,
                    position=a.position,
                    topics=[TopicRow.model_validate(t) for t in topics[a.id]],
                )
                for a in areas[f.id]
            ],
        )
        for f in fields
    ]


def build_backup(
    session: Session,
    user_id: uuid.UUID,
    store: FileStore,
    app_version: str,
    now: datetime,
    out: IO[bytes],
) -> dict[str, int]:
    """Write the archive of ``user_id``'s data to ``out``; return the counts."""
    notes = list(
        session.scalars(
            select(Note).where(Note.user_id == user_id).order_by(Note.created_at, Note.id)
        )
    )
    lessons = list(
        session.scalars(select(Lesson).where(Lesson.user_id == user_id).order_by(Lesson.node_id))
    )
    providers = list(
        session.scalars(
            select(AIProvider).where(AIProvider.user_id == user_id).order_by(AIProvider.name)
        )
    )
    assignments = list(
        session.scalars(
            select(AgentProvider)
            .where(AgentProvider.user_id == user_id)
            .order_by(AgentProvider.agent_id, AgentProvider.role)
        )
    )
    switches = list(
        session.scalars(
            select(AgentSetting)
            .where(AgentSetting.user_id == user_id)
            .order_by(AgentSetting.agent_id)
        )
    )
    chats = list(
        session.scalars(
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .order_by(ChatSession.created_at, ChatSession.id)
        )
    )
    chat_messages: dict[uuid.UUID, list[ChatMessage]] = {chat.id: [] for chat in chats}
    for message in session.scalars(
        select(ChatMessage)
        .join(ChatSession, ChatSession.id == ChatMessage.session_id)
        .where(ChatSession.user_id == user_id)
        .order_by(ChatMessage.session_id, ChatMessage.position)
    ):
        chat_messages[message.session_id].append(message)
    chat_rows = [
        ChatSessionRow(
            title=chat.title,
            created_at=chat.created_at,
            last_message_at=chat.last_message_at,
            messages=[ChatMessageRow.model_validate(m) for m in chat_messages[chat.id]],
        )
        for chat in chats
    ]
    field_rows = _field_rows(session, user_id)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        written: set[str] = set()
        kept: list[Note] = []
        for note in notes:
            if note.storage_key not in written:
                try:
                    data = store.get(note.storage_key)
                except FileNotFoundError:
                    # A note without its file cannot be restored: leave the row out too.
                    continue
                archive.writestr(f"files/{note.storage_key}", data)
                written.add(note.storage_key)
            kept.append(note)
        skipped = len(notes) - len(kept)
        files = len(written)
        counts = {
            "notes": len(kept),
            "files": files,
            "lessons": len(lessons),
            "providers": len(providers),
            "agent_providers": len(assignments),
            "agent_settings": len(switches),
            "chat_sessions": len(chat_rows),
            "chat_messages": sum(len(c.messages) for c in chat_rows),
            "learning_fields": len(field_rows),
            "learning_areas": sum(len(f.areas) for f in field_rows),
            "learning_topics": sum(len(a.topics) for f in field_rows for a in f.areas),
        }
        manifest = {
            "format": FORMAT,
            "app_version": app_version,
            "migration": migration_head(),
            "created_at": now.isoformat(),
            "counts": counts,
            "skipped_notes": skipped,
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=1))
        dumps = {
            "notes": _dump(kept, NoteRow),
            "lessons": _dump(lessons, LessonRow),
            "ai_providers": _dump(providers, ProviderRow),
            "agent_providers": _dump(assignments, AgentProviderRow),
            "agent_settings": _dump(switches, AgentSettingRow),
        }
        for name, payload in dumps.items():
            archive.writestr(DATA_FILES[name], payload)
        archive.writestr(
            OPTIONAL_FILES["chat_sessions"],
            json.dumps(
                [c.model_dump(mode="json") for c in chat_rows], ensure_ascii=False, indent=1
            ).encode("utf-8"),
        )
        archive.writestr(
            OPTIONAL_FILES["learning_fields"],
            json.dumps(
                [f.model_dump(mode="json") for f in field_rows], ensure_ascii=False, indent=1
            ).encode("utf-8"),
        )
    return counts
