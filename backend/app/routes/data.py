"""Backup download and restore (Owner only; the router sits behind the session gate)."""

import hashlib
import secrets
import tempfile
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.current import CurrentUser
from app.auth.sessions import clock_of
from app.data_sync import uploads
from app.data_sync.backup import build_backup
from app.data_sync.restore import RestoreRefused, restore_archive
from app.data_sync.sender import SyncFailed, TargetAddressInvalid, parse_target, send_backup
from app.db import SyncKey, get_session
from app.routes.guard import require_app_header
from app.storage import FileStore

router = APIRouter(prefix="/api/data", tags=["data"])
DbDep = Annotated[Session, Depends(get_session)]
CONFIRM = "REPLACE"


class RestoreOut(BaseModel):
    counts: dict[str, int]
    providers_needing_key: list[str]


def file_chunks(path: Path) -> Iterator[bytes]:
    """The file in 1 MB chunks; it is removed when the answer ends or is abandoned."""
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                yield chunk
    finally:
        path.unlink(missing_ok=True)


@router.get("/backup")
def download_backup(request: Request, db: DbDep, user: CurrentUser) -> StreamingResponse:
    now = datetime.now(UTC)
    store: FileStore = request.app.state.store
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)  # noqa: SIM115
    path = Path(handle.name)
    try:
        with handle:
            build_backup(db, user.id, store, request.app.version, now, handle)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    # Streamed: a platform's limit on buffered answers (4.5 MB on Vercel) does not apply.
    filename = f"learninghub-backup-{now:%Y%m%d-%H%M%S}.zip"
    return StreamingResponse(
        file_chunks(path),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def run_restore(request: Request, path: Path, user_id: UUID) -> dict[str, Any]:
    state = request.app.state
    try:
        return restore_archive(
            path,
            state.session_factory,
            state.store,
            Path(state.settings.storage_dir),
            request.app.version,
            lambda: datetime.now(UTC),
            user_id,
            {d.id for d in state.catalog.domains()},
        )
    except RestoreRefused as refused:
        raise HTTPException(status_code=422, detail=refused.detail) from None


# --- restore from the browser, uploaded in parts (behind the session; never the sync key)

guarded = [Depends(require_app_header)]
SHA = r"^[0-9a-f]{64}$"


class UploadStarted(BaseModel):
    upload_id: str


class RestoreFinishIn(BaseModel):
    parts: int = Field(ge=1, le=uploads.MAX_PARTS)
    sha256: str = Field(pattern=SHA)
    confirm: str = ""


@router.post("/restore/upload", response_model=UploadStarted, dependencies=guarded)
def start_restore_upload(request: Request, db: DbDep, user: CurrentUser) -> UploadStarted:
    upload_id = uploads.start_upload(request.app.state.store, db, user.id, "restore")
    return UploadStarted(upload_id=str(upload_id))


@router.put("/restore/upload/{upload_id}/{index}", dependencies=guarded)
async def put_restore_part(
    upload_id: str, index: int, request: Request, db: DbDep, user: CurrentUser
) -> dict[str, int]:
    await run_in_threadpool(uploads.find_upload, db, upload_id, user.id, "restore")
    data = await uploads.read_part(request, uploads.MAX_PART)
    size = await run_in_threadpool(
        uploads.store_part, request.app.state.store, db, upload_id, user.id, "restore", index, data
    )
    return {"size": size}


@router.post("/restore/upload/{upload_id}/finish", response_model=RestoreOut, dependencies=guarded)
def finish_restore_upload(
    upload_id: str, body: RestoreFinishIn, request: Request, db: DbDep, user: CurrentUser
) -> dict[str, Any]:
    store: FileStore = request.app.state.store
    row = uploads.find_upload(db, upload_id, user.id, "restore")
    try:
        if body.confirm != CONFIRM:
            raise HTTPException(status_code=422, detail=f"type {CONFIRM} to confirm the restore")
        path = uploads.assemble(store, row, body.parts, body.sha256)
        try:
            return run_restore(request, path, user.id)
        finally:
            path.unlink(missing_ok=True)
    finally:
        uploads.drop_upload(store, db, row)


# --- sync key (the target side)

KEY_LIFETIME = timedelta(hours=24)


class SyncKeyCreated(BaseModel):
    key: str
    expires_at: datetime


class SyncKeyState(BaseModel):
    active: bool
    expires_at: datetime | None


@router.post("/sync-key", response_model=SyncKeyCreated, dependencies=[Depends(require_app_header)])
def create_sync_key(request: Request, db: DbDep, user: CurrentUser) -> SyncKeyCreated:
    """A new key replaces any other; the key is shown once and only its hash is stored."""
    key = secrets.token_urlsafe(32)
    expires = clock_of(request)() + KEY_LIFETIME
    db.execute(delete(SyncKey).where(SyncKey.user_id == user.id))
    db.add(
        SyncKey(
            user_id=user.id,
            token_hash=hashlib.sha256(key.encode("utf-8")).hexdigest(),
            expires_at=expires,
        )
    )
    db.commit()
    return SyncKeyCreated(key=key, expires_at=expires)


@router.get("/sync-key", response_model=SyncKeyState)
def read_sync_key(request: Request, db: DbDep, user: CurrentUser) -> SyncKeyState:
    now = clock_of(request)()
    row = db.scalars(
        select(SyncKey).where(SyncKey.user_id == user.id, SyncKey.expires_at > now)
    ).first()
    return SyncKeyState(active=row is not None, expires_at=row.expires_at if row else None)


@router.delete("/sync-key", status_code=204, dependencies=[Depends(require_app_header)])
def revoke_sync_key(db: DbDep, user: CurrentUser) -> Response:
    db.execute(delete(SyncKey).where(SyncKey.user_id == user.id))
    db.commit()
    return Response(status_code=204)


# --- send to another Learning Hub (the source side)


class SyncIn(BaseModel):
    target_url: str = Field(max_length=500)
    key: str = Field(min_length=1, max_length=500)


@router.post("/sync", response_model=RestoreOut, dependencies=[Depends(require_app_header)])
def send_to_target(body: SyncIn, request: Request, db: DbDep, user: CurrentUser) -> dict[str, Any]:
    try:
        base = parse_target(body.target_url)
    except TargetAddressInvalid as invalid:
        raise HTTPException(status_code=422, detail=str(invalid)) from None
    state = request.app.state
    try:
        return send_backup(
            db,
            user.id,
            state.store,
            request.app.version,
            datetime.now(UTC),
            base,
            body.key.strip(),
            getattr(state, "sync_transport", None),
        )
    except SyncFailed as failed:
        raise HTTPException(status_code=502, detail=failed.detail) from None
