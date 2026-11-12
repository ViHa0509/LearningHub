"""A backup uploaded in parts: a sync from another Learning Hub, or a restore from the browser.

The parts are kept in the file store under ``uploads/<id>/<index>`` and tracked by a
``sync_uploads`` row, so any instance of the app can take the next part or finish the upload.
"""

import hashlib
import hmac
import shutil
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.data_sync.backup import MAX_TOTAL_BYTES
from app.db import SyncUpload
from app.storage import FileStore

MAX_PART = 50 * 1024 * 1024
MAX_PARTS = 1000
UPLOAD_MAX_AGE = timedelta(hours=24)
NO_UPLOAD = "no such upload"

Kind = Literal["sync", "restore"]


def part_key(upload_id: uuid.UUID, index: int | str) -> str:
    return f"uploads/{upload_id}/{index}"


def drop_upload(store: FileStore, db: Session, row: SyncUpload) -> None:
    """Remove the upload's parts from the store, then its row."""
    for index in row.part_sizes:
        store.delete(part_key(row.id, index))
    db.delete(row)
    db.commit()


def start_upload(store: FileStore, db: Session, user_id: uuid.UUID, kind: Kind) -> uuid.UUID:
    """A new upload of the user; uploads older than 24 hours are removed first."""
    cutoff = func.now() - UPLOAD_MAX_AGE
    for old in db.scalars(select(SyncUpload).where(SyncUpload.created_at < cutoff)).all():
        drop_upload(store, db, old)
    row = SyncUpload(user_id=user_id, kind=kind, part_sizes={})
    db.add(row)
    db.commit()
    return row.id


def find_upload(
    db: Session, upload_id: str, user_id: uuid.UUID, kind: Kind, *, lock: bool = False
) -> SyncUpload:
    """The user's upload of this kind; anything else (another user's too) is 404."""
    try:
        clean = uuid.UUID(upload_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=NO_UPLOAD) from None
    row = db.get(SyncUpload, clean, with_for_update=lock)
    if row is None or row.user_id != user_id or row.kind != kind:
        raise HTTPException(status_code=404, detail=NO_UPLOAD)
    return row


async def read_part(request: Request, limit: int) -> bytes:
    """The request body, refused beyond the part size limit."""
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > limit:
            raise HTTPException(status_code=413, detail="the part is too large")
    return bytes(data)


def store_part(
    store: FileStore,
    db: Session,
    upload_id: str,
    user_id: uuid.UUID,
    kind: Kind,
    index: int,
    data: bytes,
) -> int:
    row = find_upload(db, upload_id, user_id, kind, lock=True)
    if not 0 <= index < MAX_PARTS:
        raise HTTPException(status_code=422, detail="the part number is out of range")
    others = sum(size for i, size in row.part_sizes.items() if i != str(index))
    if others + len(data) > MAX_TOTAL_BYTES:
        raise HTTPException(status_code=413, detail="the part is too large")
    store.put(part_key(row.id, index), data)
    row.part_sizes = {**row.part_sizes, str(index): len(data)}
    db.commit()
    return len(data)


def free_temp_bytes() -> int:
    return shutil.disk_usage(tempfile.gettempdir()).free


def assemble(store: FileStore, row: SyncUpload, parts: int, sha256: str) -> Path:
    """Join the parts into a temp file and check its SHA-256; the caller removes the file."""
    if any(str(i) not in row.part_sizes for i in range(parts)):
        raise HTTPException(status_code=422, detail="some parts of the upload are missing")
    total = sum(row.part_sizes[str(i)] for i in range(parts))
    if total > MAX_TOTAL_BYTES:
        raise HTTPException(status_code=413, detail="the upload is too large")
    if total > free_temp_bytes():
        raise HTTPException(status_code=413, detail="the backup is too large for this server")
    digest = hashlib.sha256()
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)  # noqa: SIM115
    path = Path(handle.name)
    try:
        with handle:
            for index in range(parts):
                try:
                    data = store.get(part_key(row.id, index))
                except FileNotFoundError:
                    raise HTTPException(
                        status_code=422, detail="some parts of the upload are missing"
                    ) from None
                digest.update(data)
                handle.write(data)
        if not hmac.compare_digest(digest.hexdigest(), sha256):
            raise HTTPException(
                status_code=422, detail="the upload does not match its checksum; send it again"
            )
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path
