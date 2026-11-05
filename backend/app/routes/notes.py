from pathlib import PurePath
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import Note, get_session
from app.extract import UndecodableError, decode_html, extract
from app.roadmaps import RoadmapCatalog
from app.routes.domains import get_catalog
from app.schemas import ImportOutcome, ImportResult, NoteDetail, NoteOut, NoteUpdate
from app.storage import FileStore, blob_key, sha256_hex

router = APIRouter(prefix="/api/notes", tags=["notes"])

HTML_SUFFIXES = {".html", ".htm"}
# Opaque-origin sandbox: scripts run, but cannot reach the app's origin, cookies or storage.
ORIGINAL_HEADERS = {
    "Content-Security-Policy": "sandbox allow-scripts",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
}

SessionDep = Annotated[Session, Depends(get_session)]


def get_store(request: Request) -> FileStore:
    store: FileStore = request.app.state.store
    return store


def get_settings_from(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def note_out(note: Note, catalog: RoadmapCatalog) -> NoteOut:
    return NoteOut(
        id=note.id,
        title=note.title,
        original_name=note.original_name,
        size_bytes=note.size_bytes,
        node_id=note.node_id,
        node_missing=note.node_id is not None and not catalog.has_node(note.node_id),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def note_detail(note: Note, catalog: RoadmapCatalog) -> NoteDetail:
    return NoteDetail(**note_out(note, catalog).model_dump(), body_text=note.body_text)


def require_note(session: Session, note_id: UUID) -> Note:
    note = session.get(Note, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


def rejected(filename: str, reason: str) -> ImportOutcome:
    return ImportOutcome(filename=filename, outcome="rejected", reason=reason)


@router.post("/import", response_model=ImportResult)
def import_notes(
    request: Request,
    session: SessionDep,
    files: Annotated[list[UploadFile], File()],
) -> ImportResult:
    catalog = get_catalog(request)
    store = get_store(request)
    limit = get_settings_from(request).max_upload_bytes
    results: list[ImportOutcome] = []

    for upload in files:
        filename = PurePath(upload.filename or "unnamed").name
        if PurePath(filename).suffix.lower() not in HTML_SUFFIXES:
            results.append(rejected(filename, "not an HTML file"))
            continue
        data = upload.file.read(limit + 1)
        if not data:
            results.append(rejected(filename, "empty file"))
            continue
        if len(data) > limit:
            results.append(rejected(filename, f"larger than {limit // (1024 * 1024)} MB"))
            continue
        try:
            html = decode_html(data)
        except UndecodableError:
            results.append(rejected(filename, "not decodable as text"))
            continue

        sha = sha256_hex(data)
        existing = session.scalar(select(Note).where(Note.content_sha256 == sha))
        if existing is not None:
            results.append(
                ImportOutcome(
                    filename=filename, outcome="duplicate", note=note_out(existing, catalog)
                )
            )
            continue

        extracted = extract(html, filename)
        key = blob_key(sha)
        store.put(key, data)
        note = Note(
            title=extracted.title,
            body_text=extracted.text,
            original_name=filename,
            size_bytes=len(data),
            content_sha256=sha,
            storage_key=key,
        )
        session.add(note)
        session.commit()
        session.refresh(note)
        results.append(
            ImportOutcome(filename=filename, outcome="created", note=note_out(note, catalog))
        )

    return ImportResult(results=results)


@router.get("", response_model=list[NoteOut])
def list_notes(
    request: Request,
    session: SessionDep,
    node: Annotated[str | None, Query()] = None,
    unsorted: Annotated[bool, Query()] = False,
) -> list[NoteOut]:
    catalog = get_catalog(request)
    query = select(Note).order_by(Note.created_at.desc(), Note.id)
    if node is not None:
        query = query.where(Note.node_id == node)
    notes = list(session.scalars(query))
    if unsorted:
        notes = [n for n in notes if n.node_id is None or not catalog.has_node(n.node_id)]
    return [note_out(n, catalog) for n in notes]


@router.get("/{note_id}", response_model=NoteDetail)
def read_note(note_id: UUID, request: Request, session: SessionDep) -> NoteDetail:
    return note_detail(require_note(session, note_id), get_catalog(request))


@router.patch("/{note_id}", response_model=NoteDetail)
def update_note(
    note_id: UUID, update: NoteUpdate, request: Request, session: SessionDep
) -> NoteDetail:
    catalog = get_catalog(request)
    note = require_note(session, note_id)
    fields = update.model_fields_set

    if "title" in fields:
        title = (update.title or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="title must not be empty")
        note.title = title
    if "node_id" in fields:
        if update.node_id is not None and not catalog.has_node(update.node_id):
            raise HTTPException(status_code=422, detail=f"unknown node '{update.node_id}'")
        note.node_id = update.node_id

    session.commit()
    session.refresh(note)
    return note_detail(note, catalog)


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: UUID, request: Request, session: SessionDep) -> Response:
    note = require_note(session, note_id)
    key = note.storage_key
    session.delete(note)
    session.commit()
    get_store(request).delete(key)
    return Response(status_code=204)


@router.get("/{note_id}/original")
def read_original(note_id: UUID, request: Request, session: SessionDep) -> Response:
    note = require_note(session, note_id)
    data = get_store(request).get(note.storage_key)
    return Response(content=data, media_type="text/html", headers=ORIGINAL_HEADERS)
