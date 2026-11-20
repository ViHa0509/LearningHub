"""Spec: app-search - the search route (route, matching, topics, lessons and notes groups)."""

from typing import Any

from fastapi.testclient import TestClient

from app.db import Lesson
from tests.test_linking import HTML


def search(client: TestClient, q: str) -> dict[str, Any]:
    response = client.get("/api/search", params={"q": q})
    assert response.status_code == 200, response.text
    return dict(response.json())


def add_note(client: TestClient, title: str, text: str = "plain text") -> str:
    page = f"<html><head><title>{title}</title></head><body><p>{text}</p></body></html>"
    response = client.post(
        "/api/notes/import",
        files=[("files", (f"{abs(hash(title + text))}.html", page.encode(), HTML))],
    )
    assert response.status_code == 200, response.text
    (result,) = response.json()["results"]
    assert result["outcome"] == "created", result
    return str(result["note"]["id"])


def put_lesson(client: TestClient, node: str, body: str, source: str = "user") -> None:
    response = client.put(f"/api/lessons/{node}", json={"body": body, "source": source})
    assert response.status_code == 200, response.text


def make_area(client: TestClient, slug: str, topics: list[dict[str, Any]]) -> None:
    field = client.post("/api/fields", json={"title": f"Field {slug}"})
    assert field.status_code == 201, field.text
    area = client.post(
        f"/api/fields/{field.json()['id']}/areas", json={"slug": slug, "title": slug.upper()}
    )
    assert area.status_code == 201, area.text
    saved = client.put(f"/api/areas/{slug}/topics", json={"topics": topics})
    assert saved.status_code == 200, saved.text


# --- Search route ---------------------------------------------------------------------------


# Scenario: Short text
def test_short_text_answers_three_empty_groups(client: TestClient) -> None:
    put_lesson(client, "backend/caching", "a lesson with an a")
    add_note(client, "A note", "about a")
    for q in ("a", " a ", "", "   "):
        assert search(client, q) == {"query": q.strip(), "topics": [], "lessons": [], "notes": []}


# Scenario: Too long
def test_text_over_100_characters_is_refused(client: TestClient) -> None:
    assert client.get("/api/search", params={"q": "x" * 101}).status_code == 422
    # Trimming happens after the length check, 100 characters are fine.
    assert client.get("/api/search", params={"q": "x" * 100}).status_code == 200


# Scenario: Not signed in
def test_search_needs_a_session(client: TestClient) -> None:
    anonymous = TestClient(client.app)
    assert anonymous.get("/api/search", params={"q": "caching"}).status_code == 401


# --- Matching -------------------------------------------------------------------------------


# Scenario: Case is ignored
def test_case_is_ignored(client: TestClient) -> None:
    put_lesson(client, "backend/caching", "Cache-Aside pattern")
    found = search(client, "cache-aside")
    assert [hit["node_id"] for hit in found["lessons"]] == ["backend/caching"]
    assert [hit["node_id"] for hit in search(client, "CACHE-ASIDE")["lessons"]] == [
        "backend/caching"
    ]


# Scenario: Percent and underscore are literal
def test_percent_underscore_and_backslash_are_literal(client: TestClient) -> None:
    first = add_note(client, "Pool", "set max_conn to 20 and 50% load, path a\\b")
    add_note(client, "Other pool", "set maxXconn to 20 and 50 load, path aXb")
    assert [n["id"] for n in search(client, "max_conn")["notes"]] == [first]
    assert [n["id"] for n in search(client, "50%")["notes"]] == [first]
    assert [n["id"] for n in search(client, "a\\b")["notes"]] == [first]
    assert search(client, "%%")["notes"] == []
    assert search(client, "__")["notes"] == []


# --- Topics group ---------------------------------------------------------------------------


# Scenario: Title match first
def test_topic_title_match_comes_before_description_match(client: TestClient) -> None:
    make_area(
        client,
        "zorb",
        [
            {"slug": "alpha", "title": "Alpha", "description": "about zorbing"},
            {"slug": "zorbing", "title": "Zorbing", "description": ""},
        ],
    )
    topics = search(client, "zorbing")["topics"]
    assert topics == [
        {"node_id": "zorb/zorbing", "title": "Zorbing", "domain_title": "ZORB"},
        {"node_id": "zorb/alpha", "title": "Alpha", "domain_title": "ZORB"},
    ]


def test_topics_keep_catalog_order_within_a_tier_and_stop_at_five(client: TestClient) -> None:
    make_area(
        client,
        "widgets",
        [
            {"slug": "desc", "title": "Alpha", "description": "a widget thing"},
            *[{"slug": f"w{i}", "title": f"Widget {i}"} for i in range(1, 8)],
        ],
    )
    topics = search(client, "widget")["topics"]
    assert [t["node_id"] for t in topics] == [f"widgets/w{i}" for i in range(1, 6)]


def test_topics_come_from_the_built_in_roadmaps(client: TestClient) -> None:
    hits = search(client, "caching")["topics"]
    by_id = {h["node_id"]: h for h in hits}
    assert by_id["backend/caching"] == {
        "node_id": "backend/caching",
        "title": "Caching",
        "domain_title": "Backend",
    }
    assert len(hits) <= 5
    # The description of "HTTP caching" does not matter, its title already matches.
    assert hits[0]["title"].lower().count("caching") == 1


# Scenario: Another member's private area
def test_another_members_private_area_is_not_found(
    client: TestClient, second_client: TestClient
) -> None:
    make_area(second_client, "streams", [{"slug": "kafka", "title": "Kafka internals"}])
    assert [t["node_id"] for t in search(second_client, "kafka internals")["topics"]] == [
        "streams/kafka"
    ]
    assert search(client, "kafka internals")["topics"] == []


# --- Lessons group --------------------------------------------------------------------------


# Scenario: Lesson found with an excerpt
def test_lesson_hit_has_titles_source_and_an_excerpt(client: TestClient) -> None:
    put_lesson(client, "backend/caching", "Use a TTL so stale entries expire", source="agent")
    (hit,) = search(client, "stale entries")["lessons"]
    assert hit["node_id"] == "backend/caching"
    assert hit["title"] == "Caching"
    assert hit["domain_title"] == "Backend"
    assert hit["source"] == "agent"
    assert "stale entries" in hit["snippet"]


# Scenario: Most recently updated first
def test_lessons_are_newest_first_and_stop_at_five(client: TestClient) -> None:
    put_lesson(client, "backend/caching", "an index of keys")
    put_lesson(client, "data-engineer/sql", "an index on a column")
    found = search(client, "index")["lessons"]
    assert [h["node_id"] for h in found] == ["data-engineer/sql", "backend/caching"]

    for node in ("backend/redis", "backend/auth", "backend/nosql", "backend/http-caching"):
        put_lesson(client, node, "another index")
    put_lesson(client, "data-engineer/data-modeling", "newest index")
    found = search(client, "index")["lessons"]
    assert len(found) == 5
    assert found[0]["node_id"] == "data-engineer/data-modeling"
    assert "backend/caching" not in [h["node_id"] for h in found]


def test_lessons_on_topics_not_in_the_catalog_are_left_out(client: TestClient) -> None:
    app: Any = client.app
    from tests.conftest import user_id_of

    owner = user_id_of(app)
    with app.state.session_factory() as db:
        db.add(Lesson(user_id=owner, node_id="gone/topic", body="orphan index", source="user"))
        db.commit()
    put_lesson(client, "backend/caching", "a real index")
    assert [h["node_id"] for h in search(client, "index")["lessons"]] == ["backend/caching"]


# --- Notes group ----------------------------------------------------------------------------


# Scenario: Archived notes are left out
def test_archived_notes_are_left_out(client: TestClient) -> None:
    note = add_note(client, "Redis eviction")
    assert [n["id"] for n in search(client, "redis eviction")["notes"]] == [note]
    assert client.patch(f"/api/notes/{note}", json={"archived": True}).status_code == 200
    assert search(client, "redis eviction")["notes"] == []


# Scenario: Title match first
def test_note_title_match_comes_before_text_match_then_newest(client: TestClient) -> None:
    older_title = add_note(client, "Kafka basics", "brokers")
    text_only = add_note(client, "Streaming", "all about kafka here")
    newer_title = add_note(client, "More Kafka", "partitions")
    found = search(client, "kafka")["notes"]
    assert [n["id"] for n in found] == [newer_title, older_title, text_only]
    assert "kafka" in found[2]["snippet"].lower()


def test_notes_stop_at_eight_and_carry_node_id(client: TestClient) -> None:
    ids = [add_note(client, f"Queue {i}") for i in range(10)]
    linked = ids[9]
    assert (
        client.patch(f"/api/notes/{linked}", json={"node_id": "backend/caching"}).status_code == 200
    )
    found = search(client, "queue")["notes"]
    assert [n["id"] for n in found] == list(reversed(ids))[:8]
    assert found[0]["node_id"] == "backend/caching"
    assert found[1]["node_id"] is None
