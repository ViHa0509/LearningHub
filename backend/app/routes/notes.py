import json
from pathlib import PurePath
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.agent.agents import AGENTS
from app.agent.messages import Message, ProviderError
from app.agent.ratelimit import RateLimiter
from app.agent.resolve import ResolveError, resolve_chain
from app.auth.current import CurrentUser
from app.config import Settings
from app.db import Note, User, get_session
from app.extract import HTML_SUFFIXES, UndecodableError, decode_html, extract
from app.learning.catalog import UserCatalog
from app.lesson_pdf import PdfImportError, extract_pdf, pdf_note_html
from app.roadmaps import RoadmapCatalog
from app.routes.guard import box_of, factory_of, require_app_header
from app.schemas import (
    ImportOutcome,
    ImportResult,
    NoteContentUpdate,
    NoteDetail,
    NoteOut,
    NoteUpdate,
)
from app.storage import FileStore, blob_key, release_blob, sha256_hex

router = APIRouter(prefix="/api/notes", tags=["notes"])

PDF_SUFFIX = ".pdf"
# Opaque-origin sandbox: scripts run, but cannot reach the app's origin, cookies or storage.
ORIGINAL_HEADERS = {
    "Content-Security-Policy": "sandbox allow-scripts",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
}
# The print view: same opaque-origin sandbox as the original, plus the print dialog.
PRINT_HEADERS = {
    **ORIGINAL_HEADERS,
    "Content-Security-Policy": "sandbox allow-scripts allow-modals",
}
PRINT_SCRIPT = (
    b"<script>addEventListener('load',function(){setTimeout(function(){print()},300)})</script>"
)


class DeleteAllIn(BaseModel):
    confirm: str


SessionDep = Annotated[Session, Depends(get_session)]


STREAM_CHUNK = 1024 * 1024


def streamed(data: bytes, headers: dict[str, str]) -> StreamingResponse:
    """A note page as a stream: a platform's limit on buffered answers (4.5 MB on Vercel)
    does not apply to it."""
    chunks = (data[i : i + STREAM_CHUNK] for i in range(0, len(data), STREAM_CHUNK))
    return StreamingResponse(chunks, media_type="text/html", headers=headers)


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
        source=note.source,
        category=note.category,
        archived_at=note.archived_at,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def note_detail(note: Note, catalog: RoadmapCatalog) -> NoteDetail:
    return NoteDetail(
        **note_out(note, catalog).model_dump(),
        body_text=note.body_text,
        content_sha256=note.content_sha256,
    )


def require_note(session: Session, user: User, note_id: UUID) -> Note:
    """The user's note; another user's id answers 404 exactly like a missing one."""
    note = session.scalar(select(Note).where(Note.id == note_id, Note.user_id == user.id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


def rejected(filename: str, reason: str) -> ImportOutcome:
    return ImportOutcome(filename=filename, outcome="rejected", reason=reason)


@router.post("/import", response_model=ImportResult)
def import_notes(
    request: Request,
    catalog: UserCatalog,
    session: SessionDep,
    user: CurrentUser,
    files: Annotated[list[UploadFile], File()],
) -> ImportResult:
    store = get_store(request)
    limit = get_settings_from(request).max_upload_bytes
    results: list[ImportOutcome] = []

    for upload in files:
        filename = PurePath(upload.filename or "unnamed").name
        suffix = PurePath(filename).suffix.lower()
        if suffix not in HTML_SUFFIXES and suffix != PDF_SUFFIX:
            results.append(rejected(filename, "not an HTML or PDF file"))
            continue
        data = upload.file.read(limit + 1)
        if not data:
            results.append(rejected(filename, "empty file"))
            continue
        if len(data) > limit:
            results.append(rejected(filename, f"larger than {limit // (1024 * 1024)} MB"))
            continue
        if suffix == PDF_SUFFIX:
            # A PDF becomes a generated, fully escaped HTML page holding its text.
            try:
                pdf = extract_pdf(data)
            except PdfImportError as exc:
                results.append(rejected(filename, str(exc)))
                continue
            if not pdf.markdown.strip():
                results.append(rejected(filename, pdf.warning or "the PDF has no text to import"))
                continue
            _title, html = pdf_note_html(pdf, filename)
            data = html.encode("utf-8")
        else:
            try:
                html = decode_html(data)
            except UndecodableError:
                results.append(rejected(filename, "not decodable as text"))
                continue

        sha = sha256_hex(data)
        existing = session.scalar(
            select(Note).where(Note.user_id == user.id, Note.content_sha256 == sha)
        )
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
            user_id=user.id,
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


SORT_MAX_NOTES = 200
SORT_TEXT_CHARS = 300
SORT_MAX_GROUPS = 12
CATEGORY_MAX = 40


class CategorizeOut(BaseModel):
    grouped: int
    groups: int


class RenameIn(BaseModel):
    from_: str = Field(alias="from")
    to: str


class RenameOut(BaseModel):
    renamed: int


def parse_groups(answer: str, count: int) -> dict[int, str] | None:
    """The note sorter's JSON as {note number: category}; None when it is not the expected
    shape. A name is kept to one spelling ignoring case; bad names and numbers are dropped."""
    start = answer.find("{")
    if start < 0:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(answer[start:])
    except ValueError:
        return None
    groups = data.get("groups") if isinstance(data, dict) else None
    if not isinstance(groups, list):
        return None
    spelling: dict[str, str] = {}
    result: dict[int, str] = {}
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("name"), str):
            continue
        name = " ".join(group["name"].split())
        numbers = group.get("notes")
        if not name or len(name) > CATEGORY_MAX or not isinstance(numbers, list):
            continue
        if name.lower() not in spelling and len(spelling) >= SORT_MAX_GROUPS:
            continue
        name = spelling.setdefault(name.lower(), name)
        for number in numbers:
            if (
                isinstance(number, int)
                and not isinstance(number, bool)
                and 1 <= number <= count
                and number not in result
            ):
                result[number] = name
    return result


@router.post(
    "/categorize", response_model=CategorizeOut, dependencies=[Depends(require_app_header)]
)
def categorize(
    request: Request, catalog: UserCatalog, session: SessionDep, user: CurrentUser
) -> CategorizeOut:
    """Group with AI: one model call gives each unsorted note a category (or none)."""
    agent = AGENTS["note-sorter"]
    rows = session.scalars(
        select(Note)
        .where(Note.user_id == user.id, Note.archived_at.is_(None))
        .order_by(Note.created_at.desc(), Note.id)
    )
    notes = [n for n in rows if n.node_id is None or not catalog.has_node(n.node_id)]
    notes = notes[:SORT_MAX_NOTES]
    if not notes:  # nothing to sort: no model call and nothing counted
        return CategorizeOut(grouped=0, groups=0)
    try:
        chat_model = resolve_chain(
            session, user.id, box_of(request), factory_of(request), agent.id, None
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
    try:
        chat_model.count(session, user.id, request.app.state.settings.shared_daily_limit)
    except ResolveError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    existing = sorted(
        {c for c in session.scalars(select(Note.category).where(Note.user_id == user.id)) if c}
    )
    lines = [
        "Existing categories: " + (", ".join(existing) if existing else "(none)"),
        "",
        "Notes:",
    ]
    for number, note in enumerate(notes, 1):
        text = " ".join(note.body_text[: SORT_TEXT_CHARS * 2].split())[:SORT_TEXT_CHARS]
        # The title comes from the imported page too, so it is inside the wrapper as well.
        title = " ".join(note.title.split())
        body = f"Title: {title}\n{text}".replace("</untrusted_note_content>", "")
        lines.append(f"{number}.\n<untrusted_note_content>\n{body}\n</untrusted_note_content>")
    try:
        turn = chat_model.complete(
            agent.instructions, [Message(role="user", text="\n".join(lines))], []
        )
    except ProviderError as exc:
        session.rollback()
        if chat_model.shared:
            row = chat_model.provider
            detail = f"{row.name} ({row.model_name}): {exc.category}"
            raise HTTPException(status_code=502, detail=detail) from exc
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    assigned = parse_groups(turn.text, len(notes))
    if assigned is None:
        raise HTTPException(
            status_code=502, detail="The note sorter answered in an unexpected format"
        )
    # A name matching an existing category (ignoring case) takes its stored spelling.
    known = {c.lower(): c for c in existing}
    for number, note in enumerate(notes, 1):
        name = assigned.get(number)
        note.category = known.get(name.lower(), name) if name else None
    session.commit()
    return CategorizeOut(grouped=len(assigned), groups=len(set(assigned.values())))


@router.post(
    "/categories/rename", response_model=RenameOut, dependencies=[Depends(require_app_header)]
)
def rename_category(payload: RenameIn, session: SessionDep, user: CurrentUser) -> RenameOut:
    new = " ".join(payload.to.split())
    if not new or len(new) > CATEGORY_MAX:
        raise HTTPException(
            status_code=422, detail=f"the name must be 1 to {CATEGORY_MAX} characters"
        )
    result = session.execute(
        update(Note)
        .where(Note.user_id == user.id, Note.category == payload.from_)
        .values(category=new)
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="category not found")
    session.commit()
    return RenameOut(renamed=result.rowcount)  # type: ignore[attr-defined]


@router.get("", response_model=list[NoteOut])
def list_notes(
    catalog: UserCatalog,
    session: SessionDep,
    user: CurrentUser,
    node: Annotated[str | None, Query()] = None,
    unsorted: Annotated[bool, Query()] = False,
    archived: Annotated[bool, Query()] = False,
) -> list[NoteOut]:
    if archived and node is None and not unsorted:
        query = (
            select(Note)
            .where(Note.user_id == user.id, Note.archived_at.is_not(None))
            .order_by(Note.archived_at.desc(), Note.id)
        )
    else:
        query = (
            select(Note)
            .where(Note.user_id == user.id, Note.archived_at.is_(None))
            .order_by(Note.created_at.desc(), Note.id)
        )
    if node is not None:
        query = query.where(Note.node_id == node)
    notes = list(session.scalars(query))
    if unsorted:
        notes = [n for n in notes if n.node_id is None or not catalog.has_node(n.node_id)]
    return [note_out(n, catalog) for n in notes]


@router.get("/{note_id}", response_model=NoteDetail)
def read_note(
    note_id: UUID, catalog: UserCatalog, session: SessionDep, user: CurrentUser
) -> NoteDetail:
    return note_detail(require_note(session, user, note_id), catalog)


@router.patch("/{note_id}", response_model=NoteDetail)
def update_note(
    note_id: UUID, update: NoteUpdate, catalog: UserCatalog, session: SessionDep, user: CurrentUser
) -> NoteDetail:
    note = require_note(session, user, note_id)
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
    if update.archived is True and note.archived_at is None:
        note.archived_at = func.now()
    elif update.archived is False:
        note.archived_at = None

    session.commit()
    session.refresh(note)
    return note_detail(note, catalog)


@router.put(
    "/{note_id}/content",
    response_model=NoteDetail,
    dependencies=[Depends(require_app_header)],
)
def replace_content(
    note_id: UUID,
    update: NoteContentUpdate,
    request: Request,
    catalog: UserCatalog,
    session: SessionDep,
    user: CurrentUser,
) -> NoteDetail:
    store = get_store(request)
    limit = get_settings_from(request).max_upload_bytes
    note = require_note(session, user, note_id)

    html = update.html.strip()
    if not html:
        raise HTTPException(status_code=422, detail="the page must not be empty")
    data = html.encode("utf-8")
    if len(data) > limit:
        raise HTTPException(
            status_code=422, detail=f"the page is larger than {limit // (1024 * 1024)} MB"
        )
    if update.base_sha256 is not None and update.base_sha256 != note.content_sha256:
        raise HTTPException(status_code=409, detail="the page changed since you opened it")

    sha = sha256_hex(data)
    if sha == note.content_sha256:
        return note_detail(note, catalog)
    other = session.scalar(
        select(Note.id).where(Note.user_id == user.id, Note.content_sha256 == sha)
    )
    if other is not None:
        raise HTTPException(status_code=409, detail="another note already has this exact page")

    old_key = note.storage_key
    key = blob_key(sha)
    store.put(key, data)
    note.content_sha256 = sha
    note.storage_key = key
    note.size_bytes = len(data)
    note.body_text = extract(html, note.original_name).text
    session.commit()
    session.refresh(note)
    if old_key != key:
        release_blob(session, store, old_key)
    return note_detail(note, catalog)


@router.delete("", status_code=204, dependencies=[Depends(require_app_header)])
def delete_all_notes(
    body: DeleteAllIn, request: Request, session: SessionDep, user: CurrentUser
) -> Response:
    """All of the user's notes (links cascade); lessons stay."""
    if body.confirm != "DELETE":
        raise HTTPException(status_code=422, detail="Type DELETE to confirm")
    keys = set(session.scalars(select(Note.storage_key).where(Note.user_id == user.id)))
    session.execute(delete(Note).where(Note.user_id == user.id))
    session.commit()
    store = get_store(request)
    for key in keys:
        release_blob(session, store, key)
    return Response(status_code=204)


@router.delete("/{note_id}", status_code=204)
def delete_note(
    note_id: UUID, request: Request, session: SessionDep, user: CurrentUser
) -> Response:
    note = require_note(session, user, note_id)
    key = note.storage_key
    session.delete(note)
    session.commit()
    release_blob(session, get_store(request), key)
    return Response(status_code=204)


@router.get("/{note_id}/print")
def print_note(note_id: UUID, request: Request, session: SessionDep, user: CurrentUser) -> Response:
    """The note's page in its own tab, isolated like the original, that opens the print dialog."""
    note = require_note(session, user, note_id)
    data = get_store(request).get(note.storage_key) + PRINT_SCRIPT
    return streamed(data, PRINT_HEADERS)


@router.get("/{note_id}/original")
def read_original(
    note_id: UUID, request: Request, session: SessionDep, user: CurrentUser
) -> Response:
    note = require_note(session, user, note_id)
    data = get_store(request).get(note.storage_key)
    return streamed(data, ORIGINAL_HEADERS)
