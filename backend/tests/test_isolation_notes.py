"""Spec: accounts (personal data is separate per user) - notes, lessons and domain views."""

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

HTML = "text/html"
NODE = "backend/caching"


def import_one(client: TestClient, name: str, data: bytes) -> dict:
    response = client.post("/api/notes/import", files=[("files", (name, data, HTML))])
    assert response.status_code == 200, response.text
    (result,) = response.json()["results"]
    return result


def test_lists_and_views_show_only_own_notes(
    client: TestClient, second_client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    note = import_one(client, "a.html", fixture_bytes("redis-eviction.html"))["note"]
    assert client.patch(f"/api/notes/{note['id']}", json={"node_id": NODE}).status_code == 200
    assert client.get("/api/notes").json() != []
    assert second_client.get("/api/notes").json() == []
    assert second_client.get("/api/notes", params={"node": NODE}).json() == []
    assert second_client.get("/api/notes", params={"unsorted": "true"}).json() == []
    assert second_client.get("/api/notes", params={"archived": "true"}).json() == []
    # Domain views count only the user's notes.
    assert client.get("/api/domains/backend/counts").json()["counts"] == {"caching": 1}
    assert second_client.get("/api/domains/backend/counts").json()["counts"] == {}
    mine = {d["id"]: d["learned_nodes"] for d in client.get("/api/domains").json()}
    theirs = {d["id"]: d["learned_nodes"] for d in second_client.get("/api/domains").json()}
    assert mine["backend"] == 1
    assert theirs["backend"] == 0


def test_other_users_note_answers_404_and_stays_unchanged(
    client: TestClient, second_client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    data = fixture_bytes("redis-eviction.html")
    note = import_one(client, "a.html", data)["note"]
    nid = note["id"]
    missing = uuid4()

    calls = [
        ("get", "", {}),
        ("get", "/original", {}),
        ("get", "/print", {}),
        ("patch", "", {"json": {"title": "Hijacked"}}),
        ("patch", "", {"json": {"node_id": NODE}}),
        ("patch", "", {"json": {"archived": True}}),
        ("put", "/content", {"json": {"html": "<html><body>x</body></html>"}}),
        ("delete", "", {}),
    ]
    for method, suffix, kwargs in calls:
        other = getattr(second_client, method)(f"/api/notes/{nid}{suffix}", **kwargs)
        absent = getattr(second_client, method)(f"/api/notes/{missing}{suffix}", **kwargs)
        assert other.status_code == 404, (method, suffix, other.text)
        assert other.json() == absent.json(), (method, suffix)

    after = client.get(f"/api/notes/{nid}").json()
    assert after["title"] == note["title"]
    assert after["node_id"] is None
    assert after["archived_at"] is None
    assert client.get(f"/api/notes/{nid}/original").content == data
    assert [n["id"] for n in client.get("/api/notes").json()] == [nid]


def test_same_file_is_not_a_duplicate_for_another_user_and_blob_is_shared(
    client: TestClient, second_client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    data = fixture_bytes("redis-eviction.html")
    a = import_one(client, "a.html", data)
    b = import_one(second_client, "b.html", data)
    assert a["outcome"] == "created"
    assert b["outcome"] == "created"
    assert a["note"]["id"] != b["note"]["id"]
    # Importing it again is a duplicate only within the same user.
    assert import_one(second_client, "c.html", data)["outcome"] == "duplicate"

    assert client.delete(f"/api/notes/{a['note']['id']}").status_code == 204
    opened = second_client.get(f"/api/notes/{b['note']['id']}/original")
    assert opened.status_code == 200
    assert opened.content == data

    # The last reference removes the blob.
    assert second_client.delete(f"/api/notes/{b['note']['id']}").status_code == 204
    assert second_client.get(f"/api/notes/{b['note']['id']}/original").status_code == 404


def test_replace_content_duplicate_check_is_per_user(
    client: TestClient, second_client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    other_data = fixture_bytes("jwt-no-title.html")
    a = import_one(client, "a.html", fixture_bytes("redis-eviction.html"))["note"]
    import_one(second_client, "b.html", other_data)
    # B holds that exact page, but A may still use it.
    response = client.put(
        f"/api/notes/{a['id']}/content", json={"html": other_data.decode("utf-8")}
    )
    assert response.status_code == 200, response.text


def test_replace_content_keeps_blob_other_user_still_uses(
    client: TestClient, second_client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    data = fixture_bytes("redis-eviction.html")
    a = import_one(client, "a.html", data)["note"]
    b = import_one(second_client, "b.html", data)["note"]
    response = client.put(
        f"/api/notes/{a['id']}/content", json={"html": "<html><body>new</body></html>"}
    )
    assert response.status_code == 200, response.text
    assert second_client.get(f"/api/notes/{b['id']}/original").content == data


def test_lessons_are_per_user(client: TestClient, second_client: TestClient) -> None:
    url = f"/api/lessons/{NODE}"
    assert client.put(url, json={"body": "Mine", "source": "user"}).status_code == 200
    assert second_client.get(url).json()["body"] == ""
    assert second_client.get(url).json()["updated_at"] is None

    # B writes their own lesson; A's is unchanged.
    assert second_client.put(url, json={"body": "Theirs", "source": "user"}).status_code == 200
    assert client.get(url).json()["body"] == "Mine"
    assert second_client.get(url).json()["body"] == "Theirs"

    # B deleting (empty body) leaves A's lesson in place.
    second_client.put(url, json={"body": "  ", "source": "user"})
    assert second_client.get(url).json()["body"] == ""
    assert client.get(url).json()["body"] == "Mine"
