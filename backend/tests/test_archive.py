"""Spec: knowledge-import (archive, restore), node-linking, home-page and agent-chat (archived)."""

import json
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.agent.tools import AgentTools
from tests.test_agent_chat import import_note
from tests.test_linking import HTML, link, new_note


def archive(client: TestClient, note_id: str, value: bool = True) -> dict:
    response = client.patch(f"/api/notes/{note_id}", json={"archived": value})
    assert response.status_code == 200, response.text
    return response.json()


def ids(response_json: list[dict]) -> list[str]:
    return [n["id"] for n in response_json]


@pytest.fixture
def session(client: TestClient) -> Iterator[Session]:
    with client.app.state.session_factory() as s:  # type: ignore[attr-defined]
        yield s


@pytest.fixture
def tools(client: TestClient, session: Session) -> AgentTools:
    return AgentTools(session, client.app.state.catalog)  # type: ignore[attr-defined]


# knowledge-import - Scenario: Archive a note
def test_archive_moves_note_to_archived_list_and_keeps_data(client: TestClient) -> None:
    note = new_note(client, "redis")
    link(client, note, "backend/redis")
    archived = archive(client, note)
    assert archived["archived_at"] is not None
    assert archived["node_id"] == "backend/redis"
    assert archived["title"] == "redis"
    assert client.get("/api/notes").json() == []
    assert ids(client.get("/api/notes", params={"archived": "true"}).json()) == [note]
    assert client.get(f"/api/notes/{note}/original").status_code == 200
    assert client.get(f"/api/notes/{note}").json()["archived_at"] is not None


def test_archive_is_idempotent_and_new_notes_are_active(client: TestClient) -> None:
    note = new_note(client, "a")
    assert client.get(f"/api/notes/{note}").json()["archived_at"] is None
    first = archive(client, note)["archived_at"]
    assert archive(client, note)["archived_at"] == first


def test_archive_together_with_title_and_node(client: TestClient) -> None:
    note = new_note(client, "a")
    response = client.patch(
        f"/api/notes/{note}", json={"title": "B", "node_id": "backend/auth", "archived": True}
    )
    body = response.json()
    assert (body["title"], body["node_id"]) == ("B", "backend/auth")
    assert body["archived_at"] is not None


def test_patch_without_archived_keeps_archived_state(client: TestClient) -> None:
    note = new_note(client, "a")
    archive(client, note)
    assert client.patch(f"/api/notes/{note}", json={"title": "B"}).json()["archived_at"]


def test_archived_list_is_newest_archived_first(client: TestClient) -> None:
    a, b, c = (new_note(client, t) for t in "abc")
    archive(client, b)
    archive(client, a)
    archive(client, c)
    assert ids(client.get("/api/notes", params={"archived": "true"}).json()) == [c, a, b]


# knowledge-import - Scenario: Restore a note
def test_restore_puts_note_back_with_its_link(client: TestClient) -> None:
    note = new_note(client, "redis")
    link(client, note, "backend/redis")
    archive(client, note)
    restored = archive(client, note, False)
    assert restored["archived_at"] is None
    assert restored["node_id"] == "backend/redis"
    assert ids(client.get("/api/notes").json()) == [note]
    assert client.get("/api/notes", params={"archived": "true"}).json() == []


# node-linking - Scenario: Archived notes are left out
def test_node_and_unsorted_queries_leave_out_archived(client: TestClient) -> None:
    kept, gone = new_note(client, "kept"), new_note(client, "gone")
    link(client, kept, "backend/caching")
    link(client, gone, "backend/caching")
    archive(client, gone)
    assert ids(client.get("/api/notes", params={"node": "backend/caching"}).json()) == [kept]
    loose = new_note(client, "loose")
    archive(client, loose)
    assert client.get("/api/notes", params={"unsorted": "true"}).json() == []
    assert client.get(
        "/api/notes", params={"node": "backend/caching", "archived": "true"}
    ).json() == [n for n in client.get("/api/notes", params={"node": "backend/caching"}).json()]


# node-linking - Scenario: Archived notes are not counted
def test_counts_ignore_archived(client: TestClient) -> None:
    link(client, new_note(client, "a"), "backend/caching")
    gone = new_note(client, "b")
    link(client, gone, "backend/caching")
    only = new_note(client, "c")
    link(client, only, "backend/auth")
    archive(client, gone)
    archive(client, only)
    assert client.get("/api/domains/backend/counts").json()["counts"] == {"caching": 1}


# home-page - Scenario: Archived notes do not count as progress
def test_progress_ignores_archived(client: TestClient) -> None:
    aws = new_note(client, "aws")
    link(client, aws, "devops/aws")
    link(client, new_note(client, "cloud"), "devops/cloud")
    archive(client, aws)
    domains = {d["id"]: d for d in client.get("/api/domains").json()}
    assert domains["devops"]["learned_nodes"] == 1
    archive(client, aws, False)
    domains = {d["id"]: d for d in client.get("/api/domains").json()}
    assert domains["devops"]["learned_nodes"] == 2


# knowledge-import - import duplicate check still matches an archived note (design 2)
def test_duplicate_import_of_archived_note_reports_archived(
    client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    data = fixture_bytes("redis-eviction.html")
    files = [("files", ("redis.html", data, HTML))]
    note = client.post("/api/notes/import", files=files).json()["results"][0]["note"]["id"]
    archive(client, note)
    result = client.post("/api/notes/import", files=files).json()["results"][0]
    assert result["outcome"] == "duplicate"
    assert result["note"]["id"] == note
    assert result["note"]["archived_at"] is not None
    assert client.get("/api/notes").json() == []


def test_archive_unknown_note_is_404(client: TestClient) -> None:
    response = client.patch(
        "/api/notes/00000000-0000-0000-0000-000000000000", json={"archived": True}
    )
    assert response.status_code == 404


# agent-chat - Scenario: Search skips archived notes
def test_search_skips_archived_notes(client: TestClient, tools: AgentTools) -> None:
    import_note(client, "Redis one", "redis keys")
    gone = import_note(client, "Redis two", "redis ttl")
    archive(client, gone)
    result = json.loads(tools.run("search_notes", {"query": "redis"}).result)
    assert [n["title"] for n in result["notes"]] == ["Redis one"]


# agent-chat - Scenario: Read an archived note on its page
def test_read_archived_note_still_works(client: TestClient, tools: AgentTools) -> None:
    note = import_note(client, "Redis two", "redis ttl")
    archive(client, note)
    data = json.loads(tools.run("read_note", {"note_id": note}).result)
    assert "redis ttl" in data["text"]


def test_list_roadmap_does_not_count_archived(client: TestClient, tools: AgentTools) -> None:
    note = import_note(client, "a", "x")
    link(client, note, "backend/caching")
    archive(client, note)
    data = json.loads(tools.run("list_roadmap", {"domain": "backend"}).result)
    assert {t["node_id"]: t for t in data["topics"]}["backend/caching"]["notes"] == 0
