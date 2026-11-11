"""Upload routes for syncing from another Learning Hub.

These routes have no session: they authenticate with ``Authorization: Bearer <sync key>``
and are not part of the session-gated routers. No other route accepts the key.
"""

import hashlib
import hmac
import shutil
import time
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.sessions import clock_of
from app.data_sync.backup import MAX_TOTAL_BYTES
from app.db import SyncKey, get_session
from app.routes.data import RestoreOut, run_restore
from app.routes.guard import require_app_header

MAX_PART = 50 * 1024 * 1024
MAX_PARTS = 1000
UPLOAD_MAX_AGE = 24 * 3600
KEY_ERROR = "the sync key is wrong or expired"
SHA = r"^[0-9a-f]{64}$"


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def require_sync_key(request: Request, db: Annotated[Session, Depends(get_session)]) -> None:
    """A valid, unexpired sync key in the Authorization header, else 401."""
    header = request.headers.get("authorization", "")
    scheme, _, key = header.partition(" ")
    valid = False
    owner: uuid.UUID | None = None
    if scheme.lower() == "bearer" and key.strip():
        wanted = hash_key(key.strip()).encode("ascii")
        now = clock_of(request)()
        for row in db.scalars(select(SyncKey)):
            if hmac.compare_digest(wanted, row.token_hash.encode("ascii")) and row.expires_at > now:
                valid = True
                owner = row.user_id
    if not valid or owner is None:
        raise HTTPException(status_code=401, detail=KEY_ERROR)
    request.state.sync_user_id = owner


router = APIRouter(
    prefix="/api/data/upload",
    tags=["data"],
    dependencies=[Depends(require_sync_key), Depends(require_app_header)],
)


def uploads_dir(request: Request) -> Path:
    return Path(request.app.state.settings.storage_dir) / "uploads"


def upload_dir(request: Request, upload_id: str) -> Path:
    try:
        clean = str(uuid.UUID(upload_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="no such upload") from None
    folder = uploads_dir(request) / clean
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="no such upload")
    return folder


class StartedOut(BaseModel):
    upload_id: str


class FinishIn(BaseModel):
    parts: int = Field(ge=1, le=MAX_PARTS)
    sha256: str = Field(pattern=SHA)


@router.post("", response_model=StartedOut)
def start_upload(request: Request) -> StartedOut:
    root = uploads_dir(request)
    root.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - UPLOAD_MAX_AGE
    for old in root.iterdir():
        if old.is_dir() and old.stat().st_mtime < cutoff:
            shutil.rmtree(old, ignore_errors=True)
    upload_id = str(uuid.uuid4())
    (root / upload_id).mkdir()
    return StartedOut(upload_id=upload_id)


@router.put("/{upload_id}/{index}")
async def put_part(upload_id: str, index: int, request: Request) -> dict[str, int]:
    folder = upload_dir(request, upload_id)
    if not 0 <= index < MAX_PARTS:
        raise HTTPException(status_code=422, detail="the part number is out of range")
    others = sum(p.stat().st_size for p in folder.iterdir() if p.name != str(index))
    target = folder / str(index)
    size = 0
    try:
        with target.open("wb") as handle:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_PART or others + size > MAX_TOTAL_BYTES:
                    raise HTTPException(status_code=413, detail="the part is too large")
                handle.write(chunk)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return {"size": size}


@router.post("/{upload_id}/finish", response_model=RestoreOut)
def finish_upload(upload_id: str, body: FinishIn, request: Request) -> dict[str, Any]:
    folder = upload_dir(request, upload_id)
    try:
        parts = [folder / str(i) for i in range(body.parts)]
        if not all(p.is_file() for p in parts):
            raise HTTPException(status_code=422, detail="some parts of the upload are missing")
        joined = folder / "joined.zip"
        digest = hashlib.sha256()
        total = 0
        with joined.open("wb") as out:
            for part in parts:
                with part.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_TOTAL_BYTES:
                            raise HTTPException(status_code=413, detail="the upload is too large")
                        digest.update(chunk)
                        out.write(chunk)
        if not hmac.compare_digest(digest.hexdigest(), body.sha256):
            raise HTTPException(
                status_code=422, detail="the upload does not match its checksum; send it again"
            )
        return run_restore(request, joined, request.state.sync_user_id)
    finally:
        shutil.rmtree(folder, ignore_errors=True)
