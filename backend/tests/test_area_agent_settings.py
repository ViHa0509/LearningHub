"""Spec: agent-settings (tools per area, area settings are the user's own data)."""

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import AreaAgentSetting
from tests.test_learning_fields import make_area, make_field

NAMES = [
    "search_notes",
    "read_note",
    "list_roadmap",
    "read_lesson",
    "write_lesson",
    "list_node_resources",
    "fetch_reference",
    "save_learned_note",
    "show_interactive",
    "roadmapsh_list",
    "roadmapsh_outline",
    "roadmapsh_topic",
    "propose_topics",
]


def area(client: TestClient, domain: str) -> dict[str, Any]:
    rows = client.get("/api/agents/areas").json()
    return next(r for r in rows if r["domain_id"] == domain)


def rows_in_table(client: TestClient) -> int:
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        return int(db.scalar(select(func.count()).select_from(AreaAgentSetting)) or 0)


def test_tools_list_names_the_thirteen_tools_and_who_has_them(client: TestClient) -> None:
    response = client.get("/api/agents/tools")
    assert response.status_code == 200
    tools = response.json()
    assert [t["name"] for t in tools] == NAMES
    agents = {t["name"]: t["agents"] for t in tools}
    for name in NAMES[:7]:
        tutor = (
            ["a2ui"] if name in ("search_notes", "read_note", "list_roadmap", "read_lesson") else []
        )
        assert agents[name] == ["assistant", "lesson-writer", "outline", *tutor]
    assert agents["save_learned_note"] == ["assistant"]
    assert agents["show_interactive"] == ["assistant"]
    for name in ("roadmapsh_list", "roadmapsh_outline", "roadmapsh_topic"):
        assert agents[name] == ["assistant"]
    assert agents["propose_topics"] == ["outline"]
    assert all(t["description"] and not t["description"].endswith(". ") for t in tools)
    assert tools[0]["description"].startswith("Search the user's imported notes")
    assert "Returns up to 8" not in tools[0]["description"]


def test_areas_list_shows_defaults(client: TestClient) -> None:
    rows = client.get("/api/agents/areas").json()
    ids = [r["domain_id"] for r in rows]
    assert ids == [d["id"] for d in client.get("/api/domains").json()]
    backend = area(client, "backend")
    assert backend["instructions"] == "" and backend["tools"] is None
    assert backend["title"] and backend["editable"] is False


def test_put_stores_sorts_and_returns_the_settings(client: TestClient) -> None:
    body = {
        "instructions": "Answer in Vietnamese.",
        "tools": ["write_lesson", "read_note", "read_note"],
    }
    response = client.put("/api/agents/areas/backend", json=body)
    assert response.status_code == 200, response.text
    expected = {"instructions": "Answer in Vietnamese.", "tools": ["read_note", "write_lesson"]}
    assert response.json() | expected == response.json()
    assert area(client, "backend") | expected == area(client, "backend")
    assert area(client, "backend")["tools"] == ["read_note", "write_lesson"]
    # An empty list is allowed (no tool).
    client.put("/api/agents/areas/backend", json={"instructions": "", "tools": []})
    assert area(client, "backend")["tools"] == []
    assert rows_in_table(client) == 1


def test_instructions_over_4000_characters_are_refused(client: TestClient) -> None:
    ok = client.put("/api/agents/areas/backend", json={"instructions": "x" * 4000, "tools": None})
    assert ok.status_code == 200
    response = client.put(
        "/api/agents/areas/backend", json={"instructions": "x" * 4001, "tools": None}
    )
    assert response.status_code == 422
    assert "4000 characters" in response.text
    assert area(client, "backend")["instructions"] == "x" * 4000


def test_unknown_tool_is_refused_and_nothing_is_stored(client: TestClient) -> None:
    response = client.put(
        "/api/agents/areas/backend", json={"instructions": "hi", "tools": ["read_note", "nope"]}
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "unknown tool: nope"
    assert area(client, "backend")["instructions"] == ""
    assert rows_in_table(client) == 0


def test_unknown_domain_answers_404(client: TestClient) -> None:
    response = client.put("/api/agents/areas/no-such", json={"instructions": "x", "tools": None})
    assert response.status_code == 404
    assert rows_in_table(client) == 0


def test_put_needs_the_app_header(client: TestClient) -> None:
    response = client.put(
        "/api/agents/areas/backend",
        json={"instructions": "x", "tools": None},
        headers={"X-LearningHub": ""},
    )
    assert response.status_code in (400, 403)
    assert rows_in_table(client) == 0


def test_defaults_delete_the_row(client: TestClient) -> None:
    client.put("/api/agents/areas/backend", json={"instructions": "x", "tools": None})
    assert rows_in_table(client) == 1
    response = client.put("/api/agents/areas/backend", json={"instructions": "", "tools": None})
    assert response.status_code == 200
    assert response.json()["instructions"] == "" and response.json()["tools"] is None
    assert rows_in_table(client) == 0
    assert area(client, "backend")["instructions"] == ""


def test_another_users_private_area_answers_404_and_stays_unstored(
    client: TestClient, second_client: TestClient
) -> None:
    field = make_field(second_client)
    make_area(second_client, field["id"], "mine")
    assert area(second_client, "mine")["field_title"] == "Cloud"
    response = client.put("/api/agents/areas/mine", json={"instructions": "x", "tools": None})
    assert response.status_code == 404
    assert "mine" not in {r["domain_id"] for r in client.get("/api/agents/areas").json()}
    assert rows_in_table(client) == 0
    ok = second_client.put("/api/agents/areas/mine", json={"instructions": "x", "tools": None})
    assert ok.status_code == 200


def test_settings_are_the_users_own(client: TestClient, second_client: TestClient) -> None:
    client.put("/api/agents/areas/backend", json={"instructions": "secret", "tools": ["read_note"]})
    theirs = area(second_client, "backend")
    assert theirs["instructions"] == "" and theirs["tools"] is None
    second_client.put("/api/agents/areas/backend", json={"instructions": "", "tools": None})
    assert area(client, "backend")["instructions"] == "secret"
