"""Send this server's data to another Learning Hub: a backup uploaded in parts.

The sync key is used for the calls and then forgotten: never logged, never stored.
"""

import hashlib
import math
import tempfile
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx2
from sqlalchemy.orm import Session

from app.data_sync.backup import build_backup
from app.storage import FileStore

# Under the 4.5 MB request limit of a target on Vercel.
PART_SIZE = 4 * 1024 * 1024
CALL_TIMEOUT = 60.0
# The target restores the backup inside the finish call.
FINISH_TIMEOUT = 300.0
LOCAL_HOSTS = ("localhost", "127.0.0.1")
HEADERS = {"X-LearningHub": "1"}


class TargetAddressInvalid(Exception):
    """The target address is not https (or http on localhost) with a bare host."""


class SyncFailed(Exception):
    """The send failed; ``detail`` is shown to the Owner."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def parse_target(url: str) -> str:
    """The base address (``scheme://host[:port]``), or TargetAddressInvalid."""
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        raise TargetAddressInvalid("the target address is not valid") from None
    host = parts.hostname
    if (
        not host
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or parts.path not in ("", "/")
    ):
        raise TargetAddressInvalid("the target address must be only a host and an optional port")
    if not (parts.scheme == "https" or (parts.scheme == "http" and host in LOCAL_HOSTS)):
        raise TargetAddressInvalid("the target address must be https (http only on localhost)")
    shown_host = f"[{host}]" if ":" in host else host
    return f"{parts.scheme}://{shown_host}" + (f":{port}" if port else "")


def _target_detail(response: httpx2.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, str) and detail:
        return detail[:300]
    return f"the target answered {response.status_code}"


def _check(response: httpx2.Response) -> Any:
    if response.status_code == 401:
        raise SyncFailed("the sync key is wrong or expired")
    if response.status_code == 413:
        raise SyncFailed("the target refused the size")
    if not 200 <= response.status_code < 300:
        raise SyncFailed(_target_detail(response))
    try:
        return response.json()
    except ValueError:
        raise SyncFailed("the target gave an unreadable answer") from None


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def send_backup(
    session: Session,
    user_id: UUID,
    store: FileStore,
    version: str,
    now: datetime,
    base: str,
    key: str,
    transport: httpx2.BaseTransport | None,
    part_size: Callable[[], int] = lambda: PART_SIZE,
) -> dict[str, Any]:
    """Build the backup, upload it in parts, finish; return the target's restore answer."""
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)  # noqa: SIM115
    path = Path(handle.name)
    host = urlsplit(base).hostname or "the target"
    try:
        with handle:
            build_backup(session, user_id, store, version, now, handle)
        size = path.stat().st_size
        size_of_part = part_size()
        parts = max(1, math.ceil(size / size_of_part))
        sha = _file_sha256(path)
        headers = {**HEADERS, "Authorization": f"Bearer {key}"}
        try:
            with httpx2.Client(
                transport=transport, timeout=CALL_TIMEOUT, follow_redirects=False
            ) as client:
                started = _check(client.post(f"{base}/api/data/upload", headers=headers))
                upload_id = started.get("upload_id") if isinstance(started, dict) else None
                if not isinstance(upload_id, str):
                    raise SyncFailed("the target gave an unreadable answer")
                with path.open("rb") as source:
                    for index in range(parts):
                        chunk = source.read(size_of_part)
                        _check(
                            client.put(
                                f"{base}/api/data/upload/{upload_id}/{index}",
                                content=chunk,
                                headers={**headers, "Content-Type": "application/octet-stream"},
                            )
                        )
                result = _check(
                    client.post(
                        f"{base}/api/data/upload/{upload_id}/finish",
                        json={"parts": parts, "sha256": sha},
                        headers=headers,
                        timeout=FINISH_TIMEOUT,
                    )
                )
        except httpx2.TransportError:
            raise SyncFailed(f"could not reach {host}") from None
        if not isinstance(result, dict):
            raise SyncFailed("the target gave an unreadable answer")
        return result
    finally:
        path.unlink(missing_ok=True)
