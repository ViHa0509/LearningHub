"""Spec: data-sync - Download a backup; Restore a backup."""

import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.data_sync.backup import migration_head
from app.db import AgentProvider, AgentSetting, AIProvider, Lesson, Note, User, UserSession

KEY = "sk-ant-api03-SECRETKEYVALUE-9876"
HTML = "text/html"


def page(title: str) -> bytes:
    return f"<html><head><title>{title}</title></head><body>{title} body</body></html>".encode()


def import_note(client: TestClient, title: str) -> dict[str, Any]:
    response = client.post(
        "/api/notes/import", files=[("files", (f"{title}.html", page(title), HTML))]
    )
    assert response.status_code == 200, response.text
    note: dict[str, Any] = response.json()["results"][0]["note"]
    return note


def seed(client: TestClient) -> dict[str, str]:
    """Two notes with files, one lesson, a provider with a key, a keyless one, assignments."""
    import_note(client, "Alpha")
    import_note(client, "Beta")
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        admin_id = db.scalars(select(User.id).where(User.role == "admin")).one()
        db.add(
            Lesson(user_id=admin_id, node_id="devops/docker", body="# Docker lesson", source="user")
        )
        db.commit()
    keyed = client.post(
        "/api/ai-providers",
        json={
            "name": "Claude main",
            "provider_type": "anthropic",
            "model_name": "claude-sonnet-5-5",
            "api_key": KEY,
        },
    )
    assert keyed.status_code == 201, keyed.text
    local = client.post(
        "/api/ai-providers",
        json={
            "name": "Local qwen",
            "provider_type": "local",
            "model_name": "qwen3",
            "base_url": "http://localhost:11434/v1",
        },
    )
    assert local.status_code == 201, local.text
    assert (
        client.put(
            "/api/agents/assistant/provider",
            json={
                "primary_provider_id": keyed.json()["id"],
                "fallback_provider_id": local.json()["id"],
            },
        ).status_code
        == 200
    )
    assert (
        client.put("/api/agents/assistant/settings", json={"web_search": True}).status_code == 200
    )
    return {"keyed": keyed.json()["id"], "local": local.json()["id"]}


def download(client: TestClient) -> bytes:
    response = client.get("/api/data/backup")
    assert response.status_code == 200
    return response.content


RESTORE_UPLOAD = "/api/data/restore/upload"
PART = 700  # small parts, so every restore in these tests takes several calls


def restore(client: TestClient, data: bytes, confirm: str | None = "REPLACE") -> Any:
    """Restore as the Data & sync page does: start, send the parts, finish."""
    started = client.post(RESTORE_UPLOAD)
    if started.status_code != 200:
        return started
    upload_id = started.json()["upload_id"]
    parts = [data[i : i + PART] for i in range(0, len(data), PART)] or [b""]
    for index, part in enumerate(parts):
        sent = client.put(f"{RESTORE_UPLOAD}/{upload_id}/{index}", content=part)
        assert sent.status_code == 200, sent.text
    body: dict[str, Any] = {"parts": len(parts), "sha256": hashlib.sha256(data).hexdigest()}
    if confirm is not None:
        body["confirm"] = confirm
    return client.post(f"{RESTORE_UPLOAD}/{upload_id}/finish", json=body)


# Ids are new after a restore, so rows are compared without them (assignments by provider name).
def snapshot(client: TestClient) -> dict[str, list[Any]]:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        return {
            "notes": [
                (n.title, n.content_sha256, n.storage_key, n.created_at, n.archived_at)
                for n in db.scalars(select(Note).order_by(Note.title))
            ],
            "lessons": [(x.node_id, x.body, x.source) for x in db.scalars(select(Lesson))],
            "providers": [
                (p.name, p.provider_type, p.model_name, p.base_url, p.config, p.created_at)
                for p in db.scalars(select(AIProvider).order_by(AIProvider.name))
            ],
            "assignments": [
                (a.agent_id, a.role, db.get(AIProvider, a.provider_id).name)  # type: ignore[union-attr]
                for a in db.scalars(select(AgentProvider).order_by(AgentProvider.role))
            ],
            "settings": [(s.agent_id, s.web_search) for s in db.scalars(select(AgentSetting))],
        }


def empty_data(client: TestClient) -> None:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        for model in (AgentProvider, AgentSetting, Lesson, Note, AIProvider):
            for row in db.scalars(select(model)):
                db.delete(row)
        db.commit()


def rewrite(data: bytes, change: Any) -> bytes:
    """A copy of the archive after ``change(entries: dict[str, bytes])``."""
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        entries = {i.filename: source.read(i) for i in source.infolist()}
    change(entries)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as target:
        for name, content in entries.items():
            target.writestr(name, content)
    return out.getvalue()


# Scenario: Backup content
def test_backup_content(client: TestClient) -> None:
    seed(client)
    response = client.get("/api/data/backup")
    assert response.headers["content-type"] == "application/zip"
    disposition = response.headers["content-disposition"]
    assert "learninghub-backup-" in disposition and ".zip" in disposition
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(archive.namelist())
    assert {
        "manifest.json",
        "data/notes.json",
        "data/lessons.json",
        "data/ai_providers.json",
        "data/agent_providers.json",
        "data/agent_settings.json",
    } <= names
    assert len([n for n in names if n.startswith("files/blobs/")]) == 2
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["format"] == 1
    assert manifest["migration"] == migration_head()
    assert manifest["app_version"] == client.app.version  # type: ignore[attr-defined]
    assert manifest["counts"] == {
        "notes": 2,
        "files": 2,
        "lessons": 1,
        "providers": 2,
        "agent_providers": 2,
        "agent_settings": 1,
        "chat_sessions": 0,
        "chat_messages": 0,
        "learning_fields": 0,
        "learning_areas": 0,
        "learning_topics": 0,
    }
    assert {n["title"] for n in json.loads(archive.read("data/notes.json"))} == {"Alpha", "Beta"}
    assert json.loads(archive.read("data/lessons.json"))[0]["node_id"] == "devops/docker"
    providers = json.loads(archive.read("data/ai_providers.json"))
    assert {(p["name"], p["model_name"]) for p in providers} == {
        ("Claude main", "claude-sonnet-5-5"),
        ("Local qwen", "qwen3"),
    }
    for provider in providers:
        assert not {"api_key_enc", "key_hint", "key_kind"} & set(provider)
        assert not any(k.startswith("last_") for k in provider)


def test_backup_holds_no_key_token_or_password(client: TestClient) -> None:
    seed(client)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        encrypted = db.scalars(select(AIProvider.api_key_enc)).first()
        user = db.scalars(select(User)).one()
        user.password_hash = "scrypt$PASSWORDHASHVALUE"
        db.commit()
        session_hashes = list(db.scalars(select(UserSession.token_hash)))
    assert encrypted
    cookie = client.cookies.get("lh_session") or ""
    secrets_ = [KEY, "SECRETKEYVALUE", encrypted, "PASSWORDHASHVALUE", *session_hashes]
    if cookie:
        secrets_.append(cookie)
    archive = zipfile.ZipFile(io.BytesIO(download(client)))
    for name in archive.namelist():
        content = archive.read(name)
        for secret in secrets_:
            assert secret.encode() not in content, name
    # No accounts and no login sessions; the chat history is the only "sessions" entry.
    others = [n for n in archive.namelist() if n != "data/chat_sessions.json"]
    assert not any("users" in n or "session" in n for n in others)


# Scenario: Restore replaces the data
def test_restore_replaces_data_and_keeps_auto_backup(client: TestClient, tmp_path: Path) -> None:
    import_note(client, "Gamma")
    import_note(client, "Delta")
    backup = download(client)
    empty_data(client)
    old = import_note(client, "Old note")

    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["notes"] == 2
    assert response.json()["counts"]["files"] == 2
    titles = [n["title"] for n in client.get("/api/notes").json()]
    assert sorted(titles) == ["Delta", "Gamma"]
    for note in client.get("/api/notes").json():
        assert note["title"] in client.get(f"/api/notes/{note['id']}/original").text

    autos = list((tmp_path / "storage" / "backups").glob("auto-*.zip"))
    assert len(autos) == 1
    held = json.loads(zipfile.ZipFile(autos[0]).read("data/notes.json"))
    assert [n["id"] for n in held] == [old["id"]]


def test_only_three_auto_backups_are_kept(client: TestClient, tmp_path: Path) -> None:
    import_note(client, "One")
    backup = download(client)
    for _ in range(5):
        assert restore(client, backup).status_code == 200
    assert len(list((tmp_path / "storage" / "backups").glob("auto-*.zip"))) == 3


def test_round_trip_gives_identical_rows(client: TestClient) -> None:
    seed(client)
    before = snapshot(client)
    backup = download(client)
    empty_data(client)
    assert snapshot(client)["notes"] == []
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert snapshot(client) == before
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
            "learning_fields": 0,
            "learning_areas": 0,
            "learning_topics": 0,
        },
        "providers_needing_key": ["Claude main"],
    }


# Scenario: Provider keys entered again
def test_restored_provider_needs_its_key(client: TestClient) -> None:
    seed(client)
    backup = download(client)
    assert restore(client, backup).status_code == 200
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        assert [p.api_key_enc for p in db.scalars(select(AIProvider))] == [None, None]
    listed = {p["name"]: p for p in client.get("/api/ai-providers").json()}
    assert set(listed) == {"Claude main", "Local qwen"}
    assert listed["Claude main"]["has_key"] is False


# Scenario: Unsafe archive refused
@pytest.mark.parametrize(
    ("label", "change"),
    [
        ("traversal", lambda e: e.update({"../evil.txt": b"x"})),
        ("absolute", lambda e: e.update({"/etc/evil": b"x"})),
        ("backslash", lambda e: e.update({"files\\evil.html": b"x"})),
        ("unknown entry", lambda e: e.update({"data/users.json": b"[]"})),
        (
            "bad suffix",
            lambda e: e.update({"files/blobs/aa/" + "a" * 64 + ".exe": b"x"}),
        ),
    ],
)
def test_unsafe_entries_are_refused(client: TestClient, label: str, change: Any) -> None:
    import_note(client, "Keep")
    before = snapshot(client)
    response = restore(client, rewrite(download(client), change))
    assert response.status_code == 422, label
    assert response.json()["detail"]
    assert snapshot(client) == before


def test_checksum_mismatch_is_refused(client: TestClient) -> None:
    import_note(client, "Keep")
    before = snapshot(client)

    def tamper(entries: dict[str, bytes]) -> None:
        name = next(n for n in entries if n.startswith("files/blobs/"))
        entries[name] = b"<html>changed</html>"

    response = restore(client, rewrite(download(client), tamper))
    assert response.status_code == 422
    assert "checksum" in response.json()["detail"]
    assert snapshot(client) == before


@pytest.mark.parametrize("migration", ["9999", "zzzz-unknown"])
def test_newer_or_unknown_migration_is_refused(client: TestClient, migration: str) -> None:
    import_note(client, "Keep")
    before = snapshot(client)

    def newer(entries: dict[str, bytes]) -> None:
        manifest = json.loads(entries["manifest.json"])
        manifest["migration"] = migration
        entries["manifest.json"] = json.dumps(manifest).encode()

    response = restore(client, rewrite(download(client), newer))
    assert response.status_code == 422
    assert "migration" in response.json()["detail"]
    assert snapshot(client) == before


def test_wrong_format_is_refused(client: TestClient) -> None:
    def wrong(entries: dict[str, bytes]) -> None:
        manifest = json.loads(entries["manifest.json"])
        manifest["format"] = 2
        entries["manifest.json"] = json.dumps(manifest).encode()

    assert restore(client, rewrite(download(client), wrong)).status_code == 422


def test_invalid_json_shape_is_refused(client: TestClient) -> None:
    import_note(client, "Keep")
    before = snapshot(client)

    def bad(entries: dict[str, bytes]) -> None:
        entries["data/notes.json"] = b'[{"title": 1}]'

    assert restore(client, rewrite(download(client), bad)).status_code == 422
    assert snapshot(client) == before


def test_too_many_entries_and_size_limits(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import_note(client, "Keep")
    backup = download(client)
    before = snapshot(client)
    monkeypatch.setattr("app.data_sync.restore.MAX_ENTRIES", 3)
    assert restore(client, backup).status_code == 422
    monkeypatch.setattr("app.data_sync.restore.MAX_ENTRIES", 20_000)
    monkeypatch.setattr("app.data_sync.restore.MAX_TOTAL_BYTES", 100)
    response = restore(client, backup)
    assert response.status_code == 422
    assert "2 GB" in response.json()["detail"]
    assert snapshot(client) == before


def test_not_a_zip_is_refused(client: TestClient) -> None:
    response = restore(client, b"this is not a zip file")
    assert response.status_code == 422
    assert "zip" in response.json()["detail"]


@pytest.mark.parametrize("confirm", [None, "", "replace", "REPLACE "])
def test_restore_needs_the_typed_confirmation(client: TestClient, confirm: str | None) -> None:
    import_note(client, "Keep")
    before = snapshot(client)
    response = restore(client, download(client), confirm=confirm)
    assert response.status_code == 422
    assert snapshot(client) == before


def test_failed_transaction_leaves_nothing_of_the_backup(client: TestClient) -> None:
    import_note(client, "Keep")
    other = import_note(client, "Other")
    backup = download(client)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        db.delete(db.get(Note, other["id"]))
        db.commit()
    before = snapshot(client)

    def duplicate(entries: dict[str, bytes]) -> None:
        notes = json.loads(entries["data/notes.json"])
        notes.append({**notes[0], "id": "11111111-1111-1111-1111-111111111111"})
        entries["data/notes.json"] = json.dumps(notes).encode()

    response = restore(client, rewrite(backup, duplicate))
    assert response.status_code == 422
    assert snapshot(client) == before


# Scenario: Only the Owner
def test_backup_and_restore_need_a_session(client: TestClient, settings_factory: Any) -> None:
    from app.main import create_app

    app = create_app(settings_factory())
    with TestClient(app, headers={"X-LearningHub": "1"}) as anonymous:
        assert anonymous.get("/api/data/backup").status_code == 401
        assert restore(anonymous, b"x").status_code == 401
    app.state.engine.dispose()


def test_restore_needs_the_app_header(client: TestClient) -> None:
    off = {"X-LearningHub": "0"}
    assert client.post(RESTORE_UPLOAD, headers=off).status_code == 403
    upload_id = client.post(RESTORE_UPLOAD).json()["upload_id"]
    part = client.put(f"{RESTORE_UPLOAD}/{upload_id}/0", content=b"x", headers=off)
    assert part.status_code == 403
    finish = client.post(
        f"{RESTORE_UPLOAD}/{upload_id}/finish",
        json={"parts": 1, "sha256": "0" * 64, "confirm": "REPLACE"},
        headers=off,
    )
    assert finish.status_code == 403


def test_backup_without_a_note_file_leaves_the_note_out_and_restores(
    client: TestClient, tmp_path: Path
) -> None:
    import_note(client, "Kept")
    lost = import_note(client, "Lost")
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        key = db.get(Note, lost["id"]).storage_key  # type: ignore[union-attr]
    (tmp_path / "storage" / key).unlink()
    backup = download(client)
    archive = zipfile.ZipFile(io.BytesIO(backup))
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["skipped_notes"] == 1
    assert manifest["counts"]["notes"] == 1
    assert [n["title"] for n in json.loads(archive.read("data/notes.json"))] == ["Kept"]
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert [n["title"] for n in client.get("/api/notes").json()] == ["Kept"]


# --- chat history (change chat-session-history) ---------------------------------

CHATS = "data/chat_sessions.json"
FILE_TEXT = "ATTACHED-FILE-TEXT-NEVER-STORED"


def chat_once(client: TestClient, text: str, **extra: Any) -> dict[str, Any]:
    response = client.post(
        "/api/agent/chat", json={"messages": [{"role": "user", "content": text}], **extra}
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def seed_chats(client: TestClient) -> None:
    """Two chats on a scripted model: "what is JWT?" with two turns and a file, and "redis"."""
    from app.agent.messages import ToolCall, Turn
    from tests.agent_fakes import FakeFactory

    client.app.state.llm_factory = FakeFactory(  # type: ignore[attr-defined]
        Turn("", (ToolCall(id="1", name="search_notes", input={"query": "jwt"}),)),
        Turn("A signed token."),
        Turn("Through the exp claim."),
        Turn("An in-memory store."),
    )
    first = chat_once(
        client,
        "what is JWT?",
        effort="high",
        attachments=[{"name": "jwt.md", "text": FILE_TEXT}],
    )
    chat_once(client, "and how does it expire?", session_id=first["session"]["id"])
    chat_once(client, "redis")


def chat_snapshot(client: TestClient) -> list[Any]:
    """Every chat with its messages, without ids and timestamps of the rows."""
    sessions = client.get("/api/agent/sessions").json()["sessions"]
    out = []
    for item in sessions:
        detail = client.get(f"/api/agent/sessions/{item['id']}").json()
        messages = [
            {k: v for k, v in m.items() if k not in ("id", "created_at")}
            for m in detail["messages"]
        ]
        out.append((detail["title"], detail["last_message_at"], messages))
    return out


# Scenario: Chat history in the backup
def test_backup_holds_the_chat_history_without_file_text_or_keys(client: TestClient) -> None:
    seed(client)
    seed_chats(client)
    archive = zipfile.ZipFile(io.BytesIO(download(client)))
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["counts"]["chat_sessions"] == 2
    assert manifest["counts"]["chat_messages"] == 6
    chats = json.loads(archive.read(CHATS))
    assert [c["title"] for c in chats] == ["what is JWT?", "redis"]
    jwt = chats[0]["messages"]
    assert [m["role"] for m in jwt] == ["user", "assistant", "user", "assistant"]
    assert jwt[0]["attachments"] == ["jwt.md"]
    assert jwt[1]["steps"][0]["tool"] == "search_notes"
    assert jwt[1]["provider_name"] == "Claude main"
    assert jwt[1]["effort"] == "high"
    assert "id" not in chats[0] and "user_id" not in chats[0] and "id" not in jwt[0]
    for name in archive.namelist():
        content = archive.read(name)
        assert FILE_TEXT.encode() not in content, name
        assert KEY.encode() not in content, name


# Scenario: Restore replaces the chat history
def test_restore_replaces_the_chat_history_with_new_ids(client: TestClient) -> None:
    seed(client)
    seed_chats(client)
    before = chat_snapshot(client)
    old_ids = {s["id"] for s in client.get("/api/agent/sessions").json()["sessions"]}
    backup = download(client)
    for session_id in old_ids:
        assert client.delete(f"/api/agent/sessions/{session_id}").status_code == 204
    chat_once(client, "a chat made after the backup")
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["chat_sessions"] == 2
    assert response.json()["counts"]["chat_messages"] == 6
    assert chat_snapshot(client) == before
    new_ids = {s["id"] for s in client.get("/api/agent/sessions").json()["sessions"]}
    assert len(new_ids) == 2 and not new_ids & old_ids


# Scenario: Backup without chat history
def test_backup_without_a_chat_entry_leaves_the_chat_history(client: TestClient) -> None:
    seed(client)
    seed_chats(client)
    before = chat_snapshot(client)
    old = rewrite(download(client), lambda entries: entries.pop(CHATS))
    response = restore(client, old)
    assert response.status_code == 200, response.text
    assert "chat_sessions" not in response.json()["counts"]
    assert chat_snapshot(client) == before


def test_invalid_chat_entry_is_refused_and_changes_nothing(client: TestClient) -> None:
    seed(client)
    seed_chats(client)
    before = (snapshot(client), chat_snapshot(client))

    def unknown_role(entries: dict[str, bytes]) -> None:
        chats = json.loads(entries[CHATS])
        chats[0]["messages"][0]["role"] = "system"
        entries[CHATS] = json.dumps(chats).encode()

    def not_a_list(entries: dict[str, bytes]) -> None:
        entries[CHATS] = b'{"sessions": []}'

    for change in (unknown_role, not_a_list):
        response = restore(client, rewrite(download(client), change))
        assert response.status_code == 422, response.text
        assert "chat_sessions.json" in response.json()["detail"]
        assert (snapshot(client), chat_snapshot(client)) == before
