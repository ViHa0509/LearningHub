"""Upload routes for syncing from another Learning Hub.

These routes have no session: they authenticate with ``Authorization: Bearer <sync key>``
and are not part of the session-gated routers. No other route accepts the key.
"""

import hashlib
import hmac
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.sessions import clock_of
from app.data_sync import uploads
from app.db import SyncKey, get_session
from app.routes.data import RestoreOut, run_restore
from app.routes.guard import require_app_header
from app.storage import FileStore

MAX_PART = uploads.MAX_PART
KEY_ERROR = "the sync key is wrong or expired"
SHA = r"^[0-9a-f]{64}$"
DbDep = Annotated[Session, Depends(get_session)]


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


class StartedOut(BaseModel):
    upload_id: str


class FinishIn(BaseModel):
    parts: int = Field(ge=1, le=uploads.MAX_PARTS)
    sha256: str = Field(pattern=SHA)


def store_of(request: Request) -> FileStore:
    store: FileStore = request.app.state.store
    return store


def owner_of(request: Request) -> uuid.UUID:
    owner: uuid.UUID = request.state.sync_user_id
    return owner


@router.post("", response_model=StartedOut)
def start_upload(request: Request, db: DbDep) -> StartedOut:
    upload_id = uploads.start_upload(store_of(request), db, owner_of(request), "sync")
    return StartedOut(upload_id=str(upload_id))


@router.put("/{upload_id}/{index}")
async def put_part(upload_id: str, index: int, request: Request, db: DbDep) -> dict[str, int]:
    # Checked before the body is read, so an unknown upload costs nothing.
    await run_in_threadpool(uploads.find_upload, db, upload_id, owner_of(request), "sync")
    data = await uploads.read_part(request, MAX_PART)
    size = await run_in_threadpool(
        uploads.store_part, store_of(request), db, upload_id, owner_of(request), "sync", index, data
    )
    return {"size": size}


@router.post("/{upload_id}/finish", response_model=RestoreOut)
def finish_upload(upload_id: str, body: FinishIn, request: Request, db: DbDep) -> dict[str, Any]:
    store = store_of(request)
    row = uploads.find_upload(db, upload_id, owner_of(request), "sync")
    try:
        path = uploads.assemble(store, row, body.parts, body.sha256)
        try:
            return run_restore(request, path, owner_of(request))
        finally:
            path.unlink(missing_ok=True)
    finally:
        uploads.drop_upload(store, db, row)
