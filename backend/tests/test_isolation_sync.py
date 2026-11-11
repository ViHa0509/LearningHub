"""Spec: multi-user accounts - backup, restore and sync keys belong to one user."""

import io
import json
import zipfile
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import AIProvider, Lesson, Note
from tests.conftest import MEMBER_EMAIL, user_id_of
from tests.test_data_backup import download, import_note, restore, seed
from tests.test_data_sync import UPLOAD, anonymous, bearer, make_key


def archive_json(data: bytes, name: str) -> list[dict[str, Any]]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        items: list[dict[str, Any]] = json.loads(z.read(f"data/{name}.json"))
        return items


def note_rows(app: FastAPI, email: str | None) -> list[tuple[Any, ...]]:
    with app.state.session_factory() as db:
        uid = user_id_of(app, email)
        return [
            (n.id, n.title)
            for n in db.scalars(select(Note).where(Note.user_id == uid).order_by(Note.title))
        ]


# Scenario: a backup holds only the user's data
def test_backup_holds_none_of_the_other_users_data(
    client: TestClient, second_client: TestClient
) -> None:
    seed(client)
    import_note(second_client, "Member only")
    second_client.put("/api/lessons/backend/caching", json={"body": "member lesson"})
    mine = download(second_client)
    assert [n["title"] for n in archive_json(mine, "notes")] == ["Member only"]
    assert [x["body"] for x in archive_json(mine, "lessons")] == ["member lesson"]
    assert archive_json(mine, "ai_providers") == []
    admins = download(client)
    assert "Member only" not in [n["title"] for n in archive_json(admins, "notes")]
    assert len(archive_json(admins, "ai_providers")) == 2


# Scenario: restoring another user's backup copies with new ids
def test_member_restoring_the_admins_backup_gets_copies_with_new_ids(
    client: TestClient, second_client: TestClient
) -> None:
    seed(client)
    app: Any = client.app
    admin_notes = note_rows(app, None)
    admin_providers = sorted(client.get("/api/ai-providers").json(), key=lambda p: p["name"])
    backup = download(client)
    response = restore(second_client, backup)
    assert response.status_code == 200, response.text
    member_notes = note_rows(app, MEMBER_EMAIL)
    assert sorted(t for _, t in member_notes) == sorted(t for _, t in admin_notes)
    assert {i for i, _ in member_notes}.isdisjoint({i for i, _ in admin_notes})
    # The admin's data is unchanged: same note ids, same providers.
    assert note_rows(app, None) == admin_notes
    assert (
        sorted(client.get("/api/ai-providers").json(), key=lambda p: p["name"]) == admin_providers
    )
    member_providers = second_client.get("/api/ai-providers").json()
    assert {p["id"] for p in member_providers}.isdisjoint({p["id"] for p in admin_providers})
    # Assignments point at the member's own copies.
    agent = second_client.get("/api/agents/assistant/provider").json()
    assert agent["primary"]["id"] in {p["id"] for p in member_providers}
    # The shared files stay readable for both.
    for note_id, _ in member_notes + admin_notes:
        user = second_client if (note_id, _) in member_notes else client
        assert user.get(f"/api/notes/{note_id}/original").status_code == 200


def test_restore_by_the_member_leaves_the_admins_notes_and_files(
    client: TestClient, second_client: TestClient
) -> None:
    import_note(client, "Shared page")
    import_note(second_client, "Shared page")  # the same file content for both users
    backup = download(second_client)
    admin_notes = note_rows(client.app, None)  # type: ignore[arg-type]
    empty = restore(second_client, backup)
    assert empty.status_code == 200
    assert note_rows(client.app, None) == admin_notes  # type: ignore[arg-type]
    note_id = admin_notes[0][0]
    assert client.get(f"/api/notes/{note_id}/original").status_code == 200
    assert client.get("/api/lessons/backend/caching").status_code in (200, 404)


def test_restore_releases_files_nobody_refers_to(
    client: TestClient, second_client: TestClient
) -> None:
    import_note(second_client, "Old member page")
    app: Any = client.app
    other = download(client)  # the admin's backup, without that page
    with app.state.session_factory() as db:
        key = db.scalars(select(Note.storage_key)).one()
    assert app.state.store.get(key)
    assert restore(second_client, other).status_code == 200
    try:
        app.state.store.get(key)
        raise AssertionError("the unreferenced file should be gone")
    except FileNotFoundError:
        pass


# Scenario: sync keys belong to a user
def test_sync_key_is_per_user(client: TestClient, second_client: TestClient) -> None:
    admin_key = make_key(client)["key"]
    assert second_client.get("/api/data/sync-key").json()["active"] is False
    member_key = make_key(second_client)["key"]
    # A member's key does not replace the admin's.
    assert client.get("/api/data/sync-key").json()["active"] is True
    assert second_client.delete("/api/data/sync-key").status_code == 204
    assert client.get("/api/data/sync-key").json()["active"] is True
    other = anonymous(client.app)  # type: ignore[arg-type]
    assert other.post(UPLOAD, headers=bearer(admin_key)).status_code == 200
    assert other.post(UPLOAD, headers=bearer(member_key)).status_code == 401


def test_an_upload_with_the_members_key_replaces_only_the_members_data(
    client: TestClient, second_client: TestClient
) -> None:
    import_note(client, "Admin keeps")
    import_note(second_client, "Member old")
    backup = download(client)  # holds "Admin keeps"
    key = make_key(second_client)["key"]
    app: Any = client.app
    other = anonymous(app)
    started = other.post(UPLOAD, headers=bearer(key)).json()["upload_id"]
    other.put(f"{UPLOAD}/{started}/0", headers=bearer(key), content=backup)
    import hashlib

    done = other.post(
        f"{UPLOAD}/{started}/finish",
        headers=bearer(key),
        json={"parts": 1, "sha256": hashlib.sha256(backup).hexdigest()},
    )
    assert done.status_code == 200, done.text
    assert [t for _, t in note_rows(app, MEMBER_EMAIL)] == ["Admin keeps"]
    assert [t for _, t in note_rows(app, None)] == ["Admin keeps"]
    with app.state.session_factory() as db:
        assert db.scalars(select(Lesson)).all() == []
        assert db.scalars(select(AIProvider)).all() == []
