"""Spec: node-linking."""

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from tests.conftest import signed_in_client

HTML = "text/html"


def new_note(client: TestClient, title: str) -> str:
    response = client.post(
        "/api/notes/import",
        files=[("files", (f"{title}.html", f"<title>{title}</title>".encode(), HTML))],
    )
    result = response.json()["results"][0]
    assert result["outcome"] == "created"
    return str(result["note"]["id"])


def link(client: TestClient, note_id: str, node_id: str | None) -> dict:
    response = client.patch(f"/api/notes/{note_id}", json={"node_id": node_id})
    assert response.status_code == 200, response.text
    return response.json()


# Scenario: Link a note
def test_link_note(client: TestClient) -> None:
    note = new_note(client, "redis")
    assert link(client, note, "backend/caching")["node_id"] == "backend/caching"
    assert client.get(f"/api/notes/{note}").json()["node_id"] == "backend/caching"


# Scenario: Move a note
def test_move_note(client: TestClient) -> None:
    note = new_note(client, "redis")
    link(client, note, "backend/caching")
    moved = link(client, note, "devops/monitoring")
    assert moved["node_id"] == "devops/monitoring"
    assert client.get("/api/notes", params={"node": "backend/caching"}).json() == []


# Scenario: Unlink a note
def test_unlink_note(client: TestClient) -> None:
    note = new_note(client, "redis")
    link(client, note, "backend/caching")
    assert link(client, note, None)["node_id"] is None
    unsorted = client.get("/api/notes", params={"unsorted": "true"}).json()
    assert [n["id"] for n in unsorted] == [note]


def test_title_only_patch_keeps_link(client: TestClient) -> None:
    note = new_note(client, "redis")
    link(client, note, "backend/caching")
    response = client.patch(f"/api/notes/{note}", json={"title": "Renamed"})
    assert response.json()["node_id"] == "backend/caching"


# Scenario: Unknown node
@pytest.mark.parametrize("bad", ["backend/does-not-exist", "mobile/react", "caching"])
def test_unknown_node_is_rejected_and_note_unchanged(client: TestClient, bad: str) -> None:
    note = new_note(client, "redis")
    link(client, note, "backend/caching")
    response = client.patch(f"/api/notes/{note}", json={"node_id": bad})
    assert response.status_code == 422
    assert client.get(f"/api/notes/{note}").json()["node_id"] == "backend/caching"


# Scenario: Notes of a node
def test_notes_of_a_node(client: TestClient) -> None:
    a, b, c = new_note(client, "a"), new_note(client, "b"), new_note(client, "c")
    link(client, a, "backend/caching")
    link(client, b, "backend/caching")
    link(client, c, "backend/auth")
    ids = {n["id"] for n in client.get("/api/notes", params={"node": "backend/caching"}).json()}
    assert ids == {a, b}


# Scenario: Unsorted notes
def test_unsorted_notes(client: TestClient) -> None:
    a, b = new_note(client, "a"), new_note(client, "b")
    link(client, a, "backend/caching")
    unsorted = client.get("/api/notes", params={"unsorted": "true"}).json()
    assert [n["id"] for n in unsorted] == [b]


# Scenario: Counts for a domain
def test_counts_for_a_domain(client: TestClient) -> None:
    for title in ("a", "b"):
        link(client, new_note(client, title), "backend/caching")
    link(client, new_note(client, "c"), "backend/auth")
    link(client, new_note(client, "d"), "devops/docker")
    response = client.get("/api/domains/backend/counts")
    assert response.status_code == 200
    assert response.json() == {"domain": "backend", "counts": {"caching": 2, "auth": 1}}


def test_counts_unknown_domain_is_404(client: TestClient) -> None:
    assert client.get("/api/domains/mobile/counts").status_code == 404


# Requirement: Links to removed nodes are kept and flagged
# Scenario: Node removed (roadmap-catalog: Editing roadmaps never deletes notes)
def test_link_to_removed_node_is_kept_and_flagged(
    client: TestClient, tmp_path: Path, settings_factory: Callable[..., Settings]
) -> None:
    note = new_note(client, "soap")
    link(client, note, "backend/caching")

    # Restart with a roadmap where backend/caching no longer exists.
    roadmaps = tmp_path / "roadmaps"
    roadmaps.mkdir()
    (roadmaps / "devops.yaml").write_text(
        (REPO_ROOT / "roadmaps" / "devops.yaml").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (roadmaps / "backend.yaml").write_text(
        "id: backend\ntitle: Backend\nnodes:\n  - {id: apis, title: APIs}\n", encoding="utf-8"
    )
    from app.main import create_app

    restarted = create_app(settings_factory(roadmaps_dir=roadmaps))
    with signed_in_client(restarted) as after:
        detail = after.get(f"/api/notes/{note}").json()
        assert detail["node_id"] == "backend/caching"
        assert detail["node_missing"] is True
        unsorted = after.get("/api/notes", params={"unsorted": "true"}).json()
        assert [n["id"] for n in unsorted] == [note]
        assert after.get("/api/domains/backend/counts").json()["counts"] == {}
    restarted.state.engine.dispose()
