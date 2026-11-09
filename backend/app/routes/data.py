"""Backup download and restore (Owner only; the router sits behind the session gate)."""

import hashlib
import secrets
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.auth.sessions import clock_of
from app.data_sync.backup import MAX_TOTAL_BYTES, build_backup
from app.data_sync.restore import RestoreRefused, restore_archive
from app.data_sync.sender import SyncFailed, TargetAddressInvalid, parse_target, send_backup
from app.db import SyncKey, get_session
from app.routes.guard import require_app_header
from app.storage import FileStore

router = APIRouter(prefix="/api/data", tags=["data"])
DbDep = Annotated[Session, Depends(get_session)]
CONFIRM = "REPLACE"
CHUNK = 1024 * 1024


class RestoreOut(BaseModel):
    counts: dict[str, int]
    providers_needing_key: list[str]


@router.get("/backup")
def download_backup(request: Request, db: DbDep) -> FileResponse:
    now = datetime.now(UTC)
    store: FileStore = request.app.state.store
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)  # noqa: SIM115
    path = Path(handle.name)
    try:
        with handle:
            build_backup(db, store, request.app.version, now, handle)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"learninghub-backup-{now:%Y%m%d-%H%M%S}.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


def spool(upload: UploadFile) -> Path:
    """Copy an upload to a temp file, refusing more than the archive size limit."""
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)  # noqa: SIM115
    path = Path(handle.name)
    try:
        with handle:
            size = 0
            while chunk := upload.file.read(CHUNK):
                size += len(chunk)
                if size > MAX_TOTAL_BYTES:
                    raise HTTPException(status_code=413, detail="the file is too large")
                handle.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


def run_restore(request: Request, path: Path) -> dict[str, Any]:
    state = request.app.state
    try:
        return restore_archive(
            path,
            state.session_factory,
            state.store,
            Path(state.settings.storage_dir),
            request.app.version,
            lambda: datetime.now(UTC),
        )
    except RestoreRefused as refused:
        raise HTTPException(status_code=422, detail=refused.detail) from None


@router.post("/restore", response_model=RestoreOut, dependencies=[Depends(require_app_header)])
def restore(
    request: Request,
    file: Annotated[UploadFile, File()],
    confirm: Annotated[str, Form()] = "",
) -> dict[str, Any]:
    if confirm != CONFIRM:
        raise HTTPException(status_code=422, detail=f"type {CONFIRM} to confirm the restore")
    path = spool(file)
    try:
        return run_restore(request, path)
    finally:
        path.unlink(missing_ok=True)


# --- sync key (the target side)

KEY_LIFETIME = timedelta(hours=24)


class SyncKeyCreated(BaseModel):
    key: str
    expires_at: datetime


class SyncKeyState(BaseModel):
    active: bool
    expires_at: datetime | None


@router.post("/sync-key", response_model=SyncKeyCreated, dependencies=[Depends(require_app_header)])
def create_sync_key(request: Request, db: DbDep) -> SyncKeyCreated:
    """A new key replaces any other; the key is shown once and only its hash is stored."""
    key = secrets.token_urlsafe(32)
    expires = clock_of(request)() + KEY_LIFETIME
    db.execute(delete(SyncKey))
    db.add(SyncKey(token_hash=hashlib.sha256(key.encode("utf-8")).hexdigest(), expires_at=expires))
    db.commit()
    return SyncKeyCreated(key=key, expires_at=expires)


@router.get("/sync-key", response_model=SyncKeyState)
def read_sync_key(request: Request, db: DbDep) -> SyncKeyState:
    now = clock_of(request)()
    row = db.scalars(select(SyncKey).where(SyncKey.expires_at > now)).first()
    return SyncKeyState(active=row is not None, expires_at=row.expires_at if row else None)


@router.delete("/sync-key", status_code=204, dependencies=[Depends(require_app_header)])
def revoke_sync_key(db: DbDep) -> Response:
    db.execute(delete(SyncKey))
    db.commit()
    return Response(status_code=204)


# --- send to another Learning Hub (the source side)


class SyncIn(BaseModel):
    target_url: str = Field(max_length=500)
    key: str = Field(min_length=1, max_length=500)


@router.post("/sync", response_model=RestoreOut, dependencies=[Depends(require_app_header)])
def send_to_target(body: SyncIn, request: Request, db: DbDep) -> dict[str, Any]:
    try:
        base = parse_target(body.target_url)
    except TargetAddressInvalid as invalid:
        raise HTTPException(status_code=422, detail=str(invalid)) from None
    state = request.app.state
    try:
        return send_backup(
            db,
            state.store,
            request.app.version,
            datetime.now(UTC),
            base,
            body.key.strip(),
            getattr(state, "sync_transport", None),
        )
    except SyncFailed as failed:
        raise HTTPException(status_code=502, detail=failed.detail) from None
