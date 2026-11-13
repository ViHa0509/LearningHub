"""Spec: data-sync - Sync to another Learning Hub (sync key, upload, sender)."""

import hashlib
import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text

from app.config import Settings
from app.db import Note
from app.main import create_app
from tests.conftest import TEST_DATABASE_URL, signed_in_client
from tests.test_data_backup import download, import_note, restore, seed, snapshot

H = {"X-LearningHub": "1"}
UPLOAD = "/api/data/upload"


def anonymous(app: FastAPI, **headers: str) -> TestClient:
    return TestClient(app, headers={**H, **headers})


def make_key(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/data/sync-key")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def app_of(client: TestClient) -> FastAPI:
    app: FastAPI = client.app  # type: ignore[assignment]
    return app


def scalar(sql: str) -> int:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        value = int(connection.execute(text(sql)).scalar() or 0)
    engine.dispose()
    return value


def stored_parts(storage: Path) -> list[Path]:
    """The part files left in a local file store."""
    return [p for p in (storage / "uploads").rglob("*") if p.is_file()]


def key_rows() -> list[tuple[Any, ...]]:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        rows = [
            tuple(r)
            for r in connection.execute(text("SELECT token_hash, expires_at FROM sync_keys"))
        ]
    engine.dispose()
    return rows


# Scenario: the key is shown once and stored only as a hash
def test_key_is_shown_once_and_only_its_hash_is_stored(client: TestClient) -> None:
    created = make_key(client)
    key = created["key"]
    assert len(key) >= 40 and created["expires_at"]
    rows = key_rows()
    assert len(rows) == 1
    assert rows[0][0] == hashlib.sha256(key.encode()).hexdigest()
    assert key not in json.dumps(rows, default=str)
    state = client.get("/api/data/sync-key")
    assert state.json()["active"] is True
    assert key not in state.text


def test_a_new_key_replaces_the_old_one(client: TestClient) -> None:
    old = make_key(client)["key"]
    new = make_key(client)["key"]
    assert len(key_rows()) == 1
    other = anonymous(app_of(client))
    assert other.post(UPLOAD, headers=bearer(old)).status_code == 401
    assert other.post(UPLOAD, headers=bearer(new)).status_code == 200


def test_revoke(client: TestClient) -> None:
    key = make_key(client)["key"]
    assert client.delete("/api/data/sync-key").status_code == 204
    assert client.get("/api/data/sync-key").json() == {"active": False, "expires_at": None}
    assert anonymous(app_of(client)).post(UPLOAD, headers=bearer(key)).status_code == 401


# Scenario: Wrong or expired key
def test_wrong_missing_and_expired_keys_are_401(client: TestClient) -> None:
    key = make_key(client)["key"]
    other = anonymous(app_of(client))
    for headers in ({}, bearer("wrong"), {"Authorization": key}, bearer("")):
        response = other.post(UPLOAD, headers=headers)
        assert response.status_code == 401
        assert response.json()["detail"] == "the sync key is wrong or expired"
    assert other.post(UPLOAD, headers=bearer(key)).status_code == 200
    app = app_of(client)
    original = app.state.clock
    app.state.clock = lambda: original() + timedelta(hours=25)
    assert other.post(UPLOAD, headers=bearer(key)).status_code == 401
    assert client.get("/api/data/sync-key").json()["active"] is False


def test_upload_needs_the_app_header_too(client: TestClient) -> None:
    key = make_key(client)["key"]
    bare = TestClient(app_of(client))
    assert bare.post(UPLOAD, headers=bearer(key)).status_code == 403


# Scenario: Key works only for uploads
def test_key_does_not_open_other_routes(client: TestClient) -> None:
    key = make_key(client)["key"]
    other = anonymous(app_of(client), **bearer(key))
    for method, url in (
        ("GET", "/api/notes"),
        ("GET", "/api/data/backup"),
        ("GET", "/api/data/sync-key"),
        ("POST", "/api/data/sync-key"),
        ("GET", "/api/ai-providers"),
        ("GET", "/api/settings/sign-in"),
    ):
        assert other.request(method, url).status_code == 401, url


def test_key_routes_need_a_session(settings_factory: Callable[..., Settings]) -> None:
    app = create_app(settings_factory())
    with anonymous(app) as nobody:
        assert nobody.post("/api/data/sync-key").status_code == 401
        assert nobody.get("/api/data/sync-key").status_code == 401
        assert nobody.delete("/api/data/sync-key").status_code == 401
        body = {"target_url": "https://x.example", "key": "k"}
        assert nobody.post("/api/data/sync", json=body).status_code == 401
    app.state.engine.dispose()


# Upload mechanics
def start(other: TestClient, key: str) -> str:
    response = other.post(UPLOAD, headers=bearer(key))
    assert response.status_code == 200
    upload_id: str = response.json()["upload_id"]
    return upload_id


def test_part_over_the_limit_is_413(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    key = make_key(client)["key"]
    other = anonymous(app_of(client))
    upload_id = start(other, key)
    monkeypatch.setattr("app.routes.data_upload.MAX_PART", 10)
    ok = other.put(f"{UPLOAD}/{upload_id}/0", content=b"x" * 10, headers=bearer(key))
    assert ok.status_code == 200
    big = other.put(f"{UPLOAD}/{upload_id}/1", content=b"x" * 11, headers=bearer(key))
    assert big.status_code == 413


def test_bad_upload_ids_and_indexes(client: TestClient) -> None:
    key = make_key(client)["key"]
    other = anonymous(app_of(client))
    upload_id = start(other, key)
    too_high = other.put(f"{UPLOAD}/{upload_id}/1000", content=b"x", headers=bearer(key))
    assert too_high.status_code == 422
    missing = "00000000-0000-4000-8000-000000000000"
    unknown = other.put(f"{UPLOAD}/{missing}/0", content=b"x", headers=bearer(key))
    assert unknown.status_code == 404
    not_uuid = other.put(f"{UPLOAD}/not-a-uuid/0", content=b"x", headers=bearer(key))
    assert not_uuid.status_code == 404


def test_checksum_mismatch_changes_nothing(client: TestClient, tmp_path: Path) -> None:
    import_note(client, "Keep")
    backup = download(client)
    before = snapshot(client)
    key = make_key(client)["key"]
    other = anonymous(app_of(client))
    upload_id = start(other, key)
    other.put(f"{UPLOAD}/{upload_id}/0", content=backup, headers=bearer(key))
    response = other.post(
        f"{UPLOAD}/{upload_id}/finish",
        json={"parts": 1, "sha256": "0" * 64},
        headers=bearer(key),
    )
    assert response.status_code == 422
    assert "checksum" in response.json()["detail"]
    assert snapshot(client) == before
    # Nothing of the upload is left: neither its parts nor its row.
    assert stored_parts(tmp_path / "storage") == []
    assert scalar("SELECT count(*) FROM sync_uploads") == 0


def test_missing_part_is_422(client: TestClient) -> None:
    key = make_key(client)["key"]
    other = anonymous(app_of(client))
    upload_id = start(other, key)
    response = other.post(
        f"{UPLOAD}/{upload_id}/finish",
        json={"parts": 2, "sha256": "0" * 64},
        headers=bearer(key),
    )
    assert response.status_code == 422


def test_old_uploads_are_removed_when_a_new_one_starts(client: TestClient, tmp_path: Path) -> None:
    key = make_key(client)["key"]
    other = anonymous(app_of(client))
    old = start(other, key)
    other.put(f"{UPLOAD}/{old}/0", content=b"old part", headers=bearer(key))
    part = tmp_path / "storage" / "uploads" / old / "0"
    assert part.is_file()
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text("UPDATE sync_uploads SET created_at = now() - interval '25 hours'"))
    engine.dispose()
    fresh = start(other, key)
    assert not part.exists()
    assert scalar("SELECT count(*) FROM sync_uploads") == 1
    # The fresh upload takes parts; the old one is gone.
    assert other.put(f"{UPLOAD}/{fresh}/0", content=b"x", headers=bearer(key)).status_code == 200
    assert other.put(f"{UPLOAD}/{old}/1", content=b"x", headers=bearer(key)).status_code == 404


# Scenario: Parts arrive on different instances
def test_parts_and_finish_on_different_instances(
    client: TestClient, settings_factory: Callable[..., Settings], tmp_path: Path
) -> None:
    import_note(client, "Travels")
    backup = download(client)
    key = make_key(client)["key"]
    # A second instance of the same server: the same database and the same file store.
    twin = create_app(settings_factory())
    first, second = anonymous(app_of(client)), anonymous(twin)
    upload_id = start(first, key)
    half = len(backup) // 2
    one = first.put(f"{UPLOAD}/{upload_id}/0", content=backup[:half], headers=bearer(key))
    two = second.put(f"{UPLOAD}/{upload_id}/1", content=backup[half:], headers=bearer(key))
    assert (one.status_code, two.status_code) == (200, 200)
    done = second.post(
        f"{UPLOAD}/{upload_id}/finish",
        json={"parts": 2, "sha256": hashlib.sha256(backup).hexdigest()},
        headers=bearer(key),
    )
    assert done.status_code == 200, done.text
    assert done.json()["counts"]["notes"] == 1
    assert stored_parts(tmp_path / "storage") == []
    assert scalar("SELECT count(*) FROM sync_uploads") == 0
    twin.state.engine.dispose()


# Scenario: Another user's upload
def test_another_users_upload_is_404(
    client: TestClient, second_client: TestClient, tmp_path: Path
) -> None:
    admin_key = make_key(client)["key"]
    member_key = make_key(second_client)["key"]
    other = anonymous(app_of(client))
    upload_id = start(other, admin_key)
    part = other.put(f"{UPLOAD}/{upload_id}/0", content=b"x", headers=bearer(member_key))
    assert part.status_code == 404
    finish = other.post(
        f"{UPLOAD}/{upload_id}/finish",
        json={"parts": 1, "sha256": "0" * 64},
        headers=bearer(member_key),
    )
    assert finish.status_code == 404
    assert stored_parts(tmp_path / "storage") == []


def test_a_sync_upload_cannot_be_used_as_a_browser_restore(client: TestClient) -> None:
    key = make_key(client)["key"]
    upload_id = start(anonymous(app_of(client)), key)
    part = client.put(f"/api/data/restore/upload/{upload_id}/0", content=b"x")
    assert part.status_code == 404


# Scenario: Sync key refused (browser restore routes)
def test_restore_upload_routes_refuse_the_sync_key(client: TestClient) -> None:
    key = make_key(client)["key"]
    upload_id = client.post("/api/data/restore/upload").json()["upload_id"]
    other = anonymous(app_of(client))
    base = "/api/data/restore/upload"
    assert other.post(base, headers=bearer(key)).status_code == 401
    assert other.put(f"{base}/{upload_id}/0", content=b"x", headers=bearer(key)).status_code == 401
    finish = other.post(
        f"{base}/{upload_id}/finish",
        json={"parts": 1, "sha256": "0" * 64, "confirm": "REPLACE"},
        headers=bearer(key),
    )
    assert finish.status_code == 401


def test_a_backup_larger_than_the_free_space_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import_note(client, "Keep")
    backup = download(client)
    before = snapshot(client)
    monkeypatch.setattr("app.data_sync.uploads.free_temp_bytes", lambda: 10)
    response = restore(client, backup)
    assert response.status_code == 413
    assert response.json()["detail"] == "the backup is too large for this server"
    assert snapshot(client) == before
    assert stored_parts(tmp_path / "storage") == []


# Scenario: Upload interrupted (a finish without every part restores nothing)
def test_a_restore_without_all_parts_changes_nothing(client: TestClient) -> None:
    import_note(client, "Keep")
    backup = download(client)
    before = snapshot(client)
    base = "/api/data/restore/upload"
    upload_id = client.post(base).json()["upload_id"]
    client.put(f"{base}/{upload_id}/0", content=backup[:100])
    finish = client.post(
        f"{base}/{upload_id}/finish",
        json={"parts": 2, "sha256": hashlib.sha256(backup).hexdigest(), "confirm": "REPLACE"},
    )
    assert finish.status_code == 422
    assert snapshot(client) == before
    assert scalar("SELECT count(*) FROM sync_uploads") == 0


# Scenario: Backup larger than one part
def test_a_ten_megabyte_backup_goes_in_three_parts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.data_sync import sender

    assert sender.PART_SIZE == 4 * 1024 * 1024
    sizes: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.method == "PUT":
            sizes.append(len(request.read()))
            return httpx2.Response(200, json={"size": sizes[-1]})
        if request.url.path.endswith("/finish"):
            assert json.loads(request.read())["parts"] == 3
            return httpx2.Response(200, json={"counts": {}, "providers_needing_key": []})
        return httpx2.Response(200, json={"upload_id": "00000000-0000-4000-8000-000000000000"})

    def ten_megabytes(*args: Any) -> None:
        args[-1].write(bytes(10 * 1024 * 1024))

    monkeypatch.setattr("app.data_sync.sender.build_backup", ten_megabytes)
    app_of(client).state.sync_transport = httpx2.MockTransport(handler)
    response = sync(client, "https://hub.example.test", "any-key")
    assert response.status_code == 200, response.text
    assert sizes == [4 * 1024 * 1024, 4 * 1024 * 1024, 2 * 1024 * 1024]


# Sender, with the target as a second app
class Bridge(httpx2.BaseTransport):
    """Routes the sender's calls into another app's TestClient."""

    def __init__(self, target: TestClient) -> None:
        self.target = target
        self.calls: list[tuple[str, str]] = []

    def handle_request(self, request: httpx2.Request) -> httpx2.Response:
        self.calls.append((request.method, request.url.path))
        wanted = ("authorization", "x-learninghub", "content-type")
        headers = {k: v for k, v in request.headers.items() if k in wanted}
        answer = self.target.request(
            request.method, request.url.path, content=request.read(), headers=headers
        )
        return httpx2.Response(
            answer.status_code,
            headers={"content-type": answer.headers.get("content-type", "application/json")},
            content=answer.content,
        )


@contextmanager
def two_apps(
    settings_factory: Callable[..., Settings], tmp_path: Path, source: TestClient
) -> Iterator[tuple[TestClient, Bridge]]:
    target_app = create_app(settings_factory(storage_dir=tmp_path / "target-storage"))
    with signed_in_client(target_app, headers=H) as target:
        bridge = Bridge(anonymous(target_app))
        app_of(source).state.sync_transport = bridge
        yield target, bridge
    target_app.state.engine.dispose()


def sync(source: TestClient, url: str, key: str) -> Any:
    return source.post("/api/data/sync", json={"target_url": url, "key": key})


# Scenario: Send Local to Deploy
def test_send_to_the_target(
    client: TestClient,
    settings_factory: Callable[..., Settings],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed(client)
    before = snapshot(client)
    sources: dict[str, bytes] = {}
    with app_of(client).state.session_factory() as db:
        for note in db.scalars(select(Note)):
            sources[note.storage_key] = app_of(client).state.store.get(note.storage_key)
    # Small parts, so the upload takes several calls.
    monkeypatch.setattr("app.data_sync.sender.PART_SIZE", 1500)
    with two_apps(settings_factory, tmp_path, client) as (target, bridge):
        key = make_key(target)["key"]
        for stored in sources:
            with pytest.raises(FileNotFoundError):
                app_of(target).state.store.get(stored)
        response = sync(client, "http://localhost:9/", key)
        assert response.status_code == 200, response.text
        assert response.json() == {
            "counts": {
                "notes": 2,
                "files": 2,
                "lessons": 1,
                "providers": 2,
                "agent_providers": 2,
                "agent_settings": 1,
                "chat_sessions": 0,
                "chat_messages": 0,
            },
            "providers_needing_key": ["Claude main"],
        }
        assert len([c for c in bridge.calls if c[0] == "PUT"]) > 1
        assert key not in response.text
        for stored, data in sources.items():
            assert app_of(target).state.store.get(stored) == data
        assert snapshot(client) == before
        assert stored_parts(tmp_path / "target-storage") == []
        assert scalar("SELECT count(*) FROM sync_uploads") == 0
        assert len(list((tmp_path / "target-storage" / "backups").glob("auto-*.zip"))) == 1


# Scenario: Wrong or expired key (seen from the source)
def test_target_401_is_a_502_not_a_401(
    client: TestClient, settings_factory: Callable[..., Settings], tmp_path: Path
) -> None:
    import_note(client, "Keep")
    with two_apps(settings_factory, tmp_path, client):
        response = sync(client, "http://localhost:9", "not-the-key")
    assert response.status_code == 502
    assert response.json()["detail"] == "the sync key is wrong or expired"


def mock(handler: Callable[[httpx2.Request], httpx2.Response]) -> httpx2.MockTransport:
    return httpx2.MockTransport(handler)


def test_other_target_failures_are_502(client: TestClient) -> None:
    import_note(client, "Keep")
    state = app_of(client).state

    state.sync_transport = mock(lambda r: httpx2.Response(413))
    response = sync(client, "https://hub.example.com", "k")
    assert response.status_code == 502 and "size" in response.json()["detail"]

    def unreachable(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("boom", request=request)

    state.sync_transport = mock(unreachable)
    response = sync(client, "https://hub.example.com", "k")
    assert response.status_code == 502
    assert response.json()["detail"] == "could not reach hub.example.com"

    state.sync_transport = mock(lambda r: httpx2.Response(500, json={"detail": "target broke"}))
    response = sync(client, "https://hub.example.com", "k")
    assert response.status_code == 502 and response.json()["detail"] == "target broke"

    state.sync_transport = mock(lambda r: httpx2.Response(302, headers={"location": "http://evil"}))
    assert sync(client, "https://hub.example.com", "k").status_code == 502


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "ftp://localhost",
        "https://user@hub.example.com",
        "https://user:pw@hub.example.com",
        "https://hub.example.com/path",
        "https://hub.example.com/?a=1",
        "hub.example.com",
        "http://localhost.evil.com",
        "https://",
        "http://localhost:99999",
    ],
)
def test_bad_target_addresses_are_422(client: TestClient, url: str) -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        pytest.fail("must not call the network")

    app_of(client).state.sync_transport = mock(refuse)
    assert sync(client, url, "k").status_code == 422


def test_good_target_addresses_reach_the_transport(client: TestClient) -> None:
    seen: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(str(request.url))
        return httpx2.Response(401)

    app_of(client).state.sync_transport = mock(handler)
    urls = ("https://hub.example.com", "https://hub.example.com:8443/", "http://127.0.0.1:8001")
    for url in urls:
        assert sync(client, url, "k").status_code == 502
    assert seen == [
        "https://hub.example.com/api/data/upload",
        "https://hub.example.com:8443/api/data/upload",
        "http://127.0.0.1:8001/api/data/upload",
    ]
