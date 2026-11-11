"""Spec: knowledge-import - Replace a note's page."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.agent.tools import AgentTools
from app.config import Settings
from tests.conftest import user_id_of
from tests.test_notes import import_one

NEW_PAGE = "<html><head><title>Ignored</title></head><body><p>Use volatile-lru.</p></body></html>"


def put(client: TestClient, note_id: str, **body: object) -> object:
    return client.put(f"/api/notes/{note_id}/content", json=body)


def redis_note(client: TestClient) -> dict:
    note = import_one(client, "redis.html", b"<title>Redis</title><p>allkeys-lru</p>")
    client.patch(
        f"/api/notes/{note['id']}", json={"title": "Redis TTL", "node_id": "backend/redis"}
    )
    return client.get(f"/api/notes/{note['id']}").json()


# Scenario: Save edited HTML
def test_save_edited_html(client: TestClient, settings: Settings) -> None:
    note = redis_note(client)
    client.patch(f"/api/notes/{note['id']}", json={"archived": True})
    response = put(client, note["id"], html=NEW_PAGE, base_sha256=note["content_sha256"])
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["title"] == "Redis TTL"
    assert saved["node_id"] == "backend/redis"
    assert saved["archived_at"] is not None
    assert saved["original_name"] == "redis.html"
    assert saved["size_bytes"] == len(NEW_PAGE.encode())
    assert saved["content_sha256"] != note["content_sha256"]
    assert "volatile-lru" in saved["body_text"]
    assert client.get(f"/api/notes/{note['id']}/original").content == NEW_PAGE.encode()
    # The old blob is gone; only the new page is stored.
    assert len(list(Path(settings.storage_dir).rglob("*.html"))) == 1


def test_saved_text_is_searchable(client: TestClient) -> None:
    note = redis_note(client)
    put(client, note["id"], html=NEW_PAGE)
    with client.app.state.session_factory() as session:  # type: ignore[attr-defined]
        tools = AgentTools(
            session,
            client.app.state.catalog,  # type: ignore[attr-defined]
            user_id=user_id_of(client.app),
        )
        found = json.loads(tools.run("search_notes", {"query": "volatile-lru"}).result)["notes"]
    assert [n["title"] for n in found] == ["Redis TTL"]


# Scenario: Stale edit is refused
def test_stale_edit_is_refused(client: TestClient) -> None:
    note = redis_note(client)
    opened = note["content_sha256"]
    newer = "<p>saved from another tab</p>"
    assert put(client, note["id"], html=newer, base_sha256=opened).status_code == 200
    response = put(client, note["id"], html=NEW_PAGE, base_sha256=opened)
    assert response.status_code == 409
    assert client.get(f"/api/notes/{note['id']}/original").content == newer.encode()


# Scenario: Empty page is refused
def test_empty_page_is_refused(client: TestClient) -> None:
    note = redis_note(client)
    assert put(client, note["id"], html="  \n ").status_code == 422
    assert client.get(f"/api/notes/{note['id']}").json()["content_sha256"] == note["content_sha256"]


def test_oversized_page_is_refused(client: TestClient, settings: Settings) -> None:
    note = redis_note(client)
    big = "x" * (settings.max_upload_bytes + 1)
    assert put(client, note["id"], html=big).status_code == 422


# Scenario: Page identical to another note
def test_page_identical_to_another_note_is_refused(client: TestClient) -> None:
    note = redis_note(client)
    other_page = b"<title>Other</title>"
    import_one(client, "other.html", other_page)
    response = put(client, note["id"], html=other_page.decode())
    assert response.status_code == 409
    assert client.get(f"/api/notes/{note['id']}").json()["content_sha256"] == note["content_sha256"]


def test_same_page_is_a_no_op(client: TestClient) -> None:
    note = redis_note(client)
    page = client.get(f"/api/notes/{note['id']}/original").text
    response = put(client, note["id"], html=page, base_sha256=note["content_sha256"])
    assert response.status_code == 200
    assert response.json()["content_sha256"] == note["content_sha256"]


def test_replace_needs_the_app_header(client: TestClient) -> None:
    note = redis_note(client)
    response = client.put(
        f"/api/notes/{note['id']}/content", json={"html": NEW_PAGE}, headers={"X-LearningHub": ""}
    )
    assert response.status_code == 403


def test_unknown_note_is_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert put(client, missing, html=NEW_PAGE).status_code == 404
