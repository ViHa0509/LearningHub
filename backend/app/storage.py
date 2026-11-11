"""File storage behind a small protocol: a local folder, or a private Supabase Storage bucket."""

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx2
from sqlalchemy import func, select
from sqlalchemy.orm import Session


class FileStore(Protocol):
    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def blob_key(sha: str, suffix: str = ".html") -> str:
    """Content-addressed key: ``blobs/<sha[:2]>/<sha><suffix>``."""
    return f"blobs/{sha[:2]}/{sha}{suffix}"


def check_key(key: str) -> None:
    """Refuse a key that could leave the store: empty, absolute, ``..`` or backslashes."""
    parts = key.split("/")
    if (
        not key
        or key.startswith("/")
        or "\\" in key
        or any(p in ("", ".", "..") for p in parts)
        or (len(key) > 1 and key[1] == ":")
    ):
        raise ValueError(f"key escapes storage root: {key[:80]}")


class LocalFileStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        check_key(key)
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError(f"key escapes storage root: {key}")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file first so a crash never leaves a half-written blob.
        fd, tmp = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class StorageError(Exception):
    """The storage service refused a call; the message never holds the response body."""


class SupabaseFileStore:
    """Files in a private Supabase Storage bucket, over the Storage REST API.

    Authenticated with the service key, which stays in this object: it is never part of an
    error message, a log line or ``repr``.
    """

    TIMEOUT = 30.0

    def __init__(
        self,
        url: str,
        service_key: str,
        bucket: str,
        transport: httpx2.BaseTransport | None = None,
    ) -> None:
        self._base = f"{url.rstrip('/')}/storage/v1/object/{quote(bucket, safe='')}"
        self._headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}
        self._client = httpx2.Client(
            transport=transport, timeout=self.TIMEOUT, follow_redirects=False
        )

    def __repr__(self) -> str:
        return "SupabaseFileStore(...)"

    def _object_url(self, key: str) -> str:
        check_key(key)
        return f"{self._base}/{quote(key, safe='/')}"

    def _call(
        self,
        method: str,
        url: str,
        extra_headers: dict[str, str] | None = None,
        content: bytes | None = None,
        json: dict[str, list[str]] | None = None,
    ) -> httpx2.Response:
        headers = {**self._headers, **(extra_headers or {})}
        try:
            return self._client.request(method, url, headers=headers, content=content, json=json)
        except httpx2.HTTPError as error:
            raise StorageError(f"storage request failed ({type(error).__name__})") from None

    def put(self, key: str, data: bytes) -> None:
        response = self._call(
            "POST",
            self._object_url(key),
            {"Content-Type": "application/octet-stream", "x-upsert": "true"},
            content=data,
        )
        if not response.is_success:
            raise StorageError(f"storage upload failed (HTTP {response.status_code})")

    @staticmethod
    def _not_found(response: httpx2.Response) -> bool:
        """Supabase answers a missing object with 404, or with 400 and statusCode "404"."""
        if response.status_code == 404:
            return True
        if response.status_code != 400:
            return False
        try:
            body = response.json()
        except ValueError:
            return False
        return isinstance(body, dict) and (
            str(body.get("statusCode")) == "404" or body.get("error") == "not_found"
        )

    def get(self, key: str) -> bytes:
        response = self._call("GET", self._object_url(key))
        if self._not_found(response):
            raise FileNotFoundError(key)
        if not response.is_success:
            raise StorageError(f"storage read failed (HTTP {response.status_code})")
        return response.content

    def delete(self, key: str) -> None:
        check_key(key)
        response = self._call("DELETE", self._base, json={"prefixes": [key]})
        if not response.is_success and not self._not_found(response):
            raise StorageError(f"storage delete failed (HTTP {response.status_code})")


def release_blob(db: Session, store: FileStore, key: str) -> None:
    """Delete a blob once no note of any user points at it (call after the row change commits)."""
    from app.db import Note  # local: app.db does not depend on storage, keep it that way

    if db.scalar(select(func.count()).select_from(Note).where(Note.storage_key == key)) == 0:
        store.delete(key)
