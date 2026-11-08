from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class DomainSummary(BaseModel):
    id: str
    title: str
    description: str | None
    node_count: int
    learned_nodes: int


class NodeOut(BaseModel):
    id: str
    full_id: str
    title: str
    description: str | None
    parent: str | None
    order: int


class RoadmapOut(BaseModel):
    id: str
    title: str
    nodes: list[NodeOut]


class NodeCounts(BaseModel):
    domain: str
    counts: dict[str, int]


class NoteOut(BaseModel):
    id: UUID
    title: str
    original_name: str
    size_bytes: int
    node_id: str | None
    node_missing: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class NoteDetail(NoteOut):
    body_text: str
    content_sha256: str


class ImportOutcome(BaseModel):
    filename: str
    outcome: Literal["created", "duplicate", "rejected"]
    reason: str | None = None
    note: NoteOut | None = None


class ImportResult(BaseModel):
    results: list[ImportOutcome]


class NoteContentUpdate(BaseModel):
    html: str
    base_sha256: str | None = None


class NoteUpdate(BaseModel):
    title: str | None = None
    node_id: str | None = None
    archived: bool | None = None


LessonSource = Literal["user", "agent", "import"]


class LessonOut(BaseModel):
    node_id: str
    body: str
    source: LessonSource | None
    updated_at: datetime | None


class LessonWrite(BaseModel):
    body: str
    source: LessonSource = "user"
