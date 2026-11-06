"""Spec: lesson-pages (storage) and roadmap-catalog (domain progress)."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.test_linking import link, new_note

CACHING = "/api/lessons/backend/caching"


# Scenario: Read a node without lesson
def test_node_without_lesson_reads_empty(client: TestClient) -> None:
    response = client.get("/api/lessons/backend/graphql")
    assert response.status_code == 200
    assert response.json() == {
        "node_id": "backend/graphql",
        "body": "",
        "source": None,
        "updated_at": None,
    }


# Scenario: Write a lesson (persists across a backend restart)
def test_write_lesson_persists_across_restart(client: TestClient, settings: Settings) -> None:
    text = "Cache-aside: read the cache, fall back to the database"
    response = client.put(CACHING, json={"body": text})
    assert response.status_code == 200
    body = response.json()
    assert body["body"] == text
    assert body["source"] == "user"
    assert body["updated_at"] is not None

    restarted = create_app(settings)
    with TestClient(restarted) as again:
        assert again.get(CACHING).json()["body"] == text
    restarted.state.engine.dispose()


def test_rewrite_replaces_text_and_source(client: TestClient) -> None:
    client.put(CACHING, json={"body": "first"})
    response = client.put(CACHING, json={"body": "second", "source": "agent"})
    assert response.json()["body"] == "second"
    assert client.get(CACHING).json()["source"] == "agent"


def test_unknown_source_is_rejected(client: TestClient) -> None:
    assert client.put(CACHING, json={"body": "x", "source": "web"}).status_code == 422
    assert client.get(CACHING).json()["body"] == ""


# Scenario: Clear a lesson
def test_empty_body_removes_lesson(client: TestClient) -> None:
    client.put(CACHING, json={"body": "something"})
    response = client.put(CACHING, json={"body": "   \n"})
    assert response.status_code == 200
    assert response.json()["source"] is None
    assert client.get(CACHING).json() == {
        "node_id": "backend/caching",
        "body": "",
        "source": None,
        "updated_at": None,
    }


# Scenario: Unknown node is rejected
def test_unknown_node_is_404_and_nothing_stored(client: TestClient) -> None:
    response = client.put("/api/lessons/backend/not-a-node", json={"body": "x"})
    assert response.status_code == 404
    assert "backend/not-a-node" in response.json()["detail"]
    assert client.get("/api/lessons/backend/not-a-node").status_code == 404
    assert client.get("/api/lessons/mobile/caching").status_code == 404


# roadmap-catalog - Scenario: List domains (progress = nodes with notes)
def test_domains_report_learned_nodes(client: TestClient) -> None:
    link(client, new_note(client, "aws"), "devops/aws")
    link(client, new_note(client, "cloud"), "devops/cloud")
    link(client, new_note(client, "cloud 2"), "devops/cloud")
    new_note(client, "unsorted")
    domains = {d["id"]: d for d in client.get("/api/domains").json()}
    assert domains["devops"]["learned_nodes"] == 2
    assert domains["devops"]["node_count"] == 21
    assert domains["backend"]["learned_nodes"] == 0
