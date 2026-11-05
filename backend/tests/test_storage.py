"""Spec: knowledge-import - Keep the original file unchanged (storage layer)."""

from pathlib import Path

import pytest

from app.storage import LocalFileStore, blob_key, sha256_hex


def test_put_get_round_trip_is_byte_identical(tmp_path: Path) -> None:
    store = LocalFileStore(tmp_path)
    data = "<html><title>Ünïcode ✓</title></html>\r\n".encode() + bytes(range(256))
    key = blob_key(sha256_hex(data))
    store.put(key, data)
    assert store.get(key) == data


def test_key_is_content_addressed(tmp_path: Path) -> None:
    sha = sha256_hex(b"abc")
    assert blob_key(sha) == f"blobs/{sha[:2]}/{sha}.html"
    LocalFileStore(tmp_path).put(blob_key(sha), b"abc")
    assert (tmp_path / "blobs" / sha[:2] / f"{sha}.html").read_bytes() == b"abc"


def test_delete_removes_file_and_is_idempotent(tmp_path: Path) -> None:
    store = LocalFileStore(tmp_path)
    store.put("blobs/aa/x.html", b"x")
    store.delete("blobs/aa/x.html")
    assert not (tmp_path / "blobs/aa/x.html").exists()
    store.delete("blobs/aa/x.html")


def test_key_cannot_escape_root(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        LocalFileStore(tmp_path / "root").put("../outside.html", b"x")
