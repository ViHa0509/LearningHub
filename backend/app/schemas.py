from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class DomainSummary(BaseModel):
    id: str
    title: str
    node_count: int


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
    created_at: datetime
    updated_at: datetime


class NoteDetail(NoteOut):
    body_text: str


class ImportOutcome(BaseModel):
    filename: str
    outcome: Literal["created", "duplicate", "rejected"]
    reason: str | None = None
    note: NoteOut | None = None


class ImportResult(BaseModel):
    results: list[ImportOutcome]


class NoteUpdate(BaseModel):
    title: str | None = None
    node_id: str | None = None
