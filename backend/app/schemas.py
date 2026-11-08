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


class ResourceItem(BaseModel):
    url: str
    title: str
    type: str
    source_ref: str


class NodeResourcesOut(BaseModel):
    node_id: str
    source: str
    commit: str | None
    synced_at: datetime | None
    source_url: str
    items: list[ResourceItem]


class ResourceSyncRequest(BaseModel):
    domain: str


class ResourceSyncStatus(BaseModel):
    domain: str
    # "unavailable": the roadmap has no resource mapping, so it cannot be synced.
    state: Literal["idle", "running", "done", "failed", "unavailable"]
    commit: str | None
    nodes: int | None
    links: int | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None


class NewsSourceResult(BaseModel):
    id: str
    name: str
    # None while the running refresh has not read the source yet.
    ok: bool | None
    items: int | None
    error: str | None


class NewsRefreshStatus(BaseModel):
    state: Literal["idle", "running", "done", "failed"]
    started_at: datetime | None
    finished_at: datetime | None
    # Set when the whole refresh failed (every source failed, or an unexpected error).
    error: str | None
    sources: list[NewsSourceResult]


class NewsItemOut(BaseModel):
    id: UUID
    source: str
    source_name: str
    title: str
    url: str
    published_at: datetime
    summary: str


class NewsSourceOut(BaseModel):
    id: str
    name: str
    homepage: str
    count: int
    last_ok: bool | None
    last_error: str | None
    last_fetched_at: datetime | None


class NewsListOut(BaseModel):
    items: list[NewsItemOut]
    sources: list[NewsSourceOut]
    last_refresh_at: datetime | None
    stale: bool
