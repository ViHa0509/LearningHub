"""File storage behind a small protocol, so a cloud store can replace the local one later."""

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Protocol


class FileStore(Protocol):
    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def blob_key(sha: str, suffix: str = ".html") -> str:
    """Content-addressed key: ``blobs/<sha[:2]>/<sha><suffix>``."""
    return f"blobs/{sha[:2]}/{sha}{suffix}"


class LocalFileStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
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
