"""Spec: knowledge-import (API)."""

from collections.abc import Callable
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in_client

HTML = "text/html"


def upload(client: TestClient, *files: tuple[str, bytes, str]) -> list[dict]:
    response = client.post("/api/notes/import", files=[("files", f) for f in files])
    assert response.status_code == 200, response.text
    return response.json()["results"]


def import_one(client: TestClient, name: str, data: bytes) -> dict:
    (result,) = upload(client, (name, data, HTML))
    assert result["outcome"] == "created", result
    return result["note"]


# Scenario: Import one file
def test_import_one_file(client: TestClient, fixture_bytes: Callable[[str], bytes]) -> None:
    data = fixture_bytes("redis-eviction.html")
    note = import_one(client, "redis-eviction.html", data)
    assert note["title"] == "Redis eviction policies"
    assert note["original_name"] == "redis-eviction.html"
    assert note["size_bytes"] == len(data)
    assert note["id"] and note["created_at"]
    assert note["node_id"] is None


# Scenario: Import several files at once (a rejected file does not stop the others)
def test_import_several_files_each_with_own_outcome(
    client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    redis = fixture_bytes("redis-eviction.html")
    import_one(client, "redis-eviction.html", redis)
    results = upload(
        client,
        ("notes.pdf", b"%PDF-1.4", "application/pdf"),
        ("jwt.html", fixture_bytes("jwt-no-title.html"), HTML),
        ("again.html", redis, HTML),
    )
    assert [r["outcome"] for r in results] == ["rejected", "created", "duplicate"]
    assert [r["filename"] for r in results] == ["notes.pdf", "jwt.html", "again.html"]


# Scenario: Wrong file type
def test_wrong_file_type_is_rejected(client: TestClient) -> None:
    (result,) = upload(client, ("notes.docx", b"PK..", "application/octet-stream"))
    assert result == {
        "filename": "notes.docx",
        "outcome": "rejected",
        "reason": "not an HTML or PDF file",
        "note": None,
    }
    assert client.get("/api/notes").json() == []


def test_htm_extension_and_uppercase_are_accepted(client: TestClient) -> None:
    import_one(client, "PAGE.HTM", b"<title>Upper</title>")


def test_empty_file_is_rejected(client: TestClient) -> None:
    (result,) = upload(client, ("empty.html", b"", HTML))
    assert (result["outcome"], result["reason"]) == ("rejected", "empty file")


def test_undecodable_file_is_rejected(client: TestClient) -> None:
    (result,) = upload(client, ("bin.html", b"\xff\xfe\x00\x81\x9d", HTML))
    assert (result["outcome"], result["reason"]) == ("rejected", "not decodable as text")


# Scenario: File too large
def test_file_over_10_mb_is_rejected(client: TestClient) -> None:
    big = b"<p>" + b"a" * (12 * 1024 * 1024) + b"</p>"
    (result,) = upload(client, ("big.html", big, HTML))
    assert (result["outcome"], result["reason"]) == ("rejected", "larger than 10 MB")


def test_file_of_exactly_10_mb_is_accepted(client: TestClient) -> None:
    data = b"<title>Edge</title>" + b"a" * (10 * 1024 * 1024 - 19)
    assert len(data) == 10 * 1024 * 1024
    import_one(client, "edge.html", data)


# Scenario: Original is preserved
def test_original_is_byte_identical(
    client: TestClient, settings: Settings, fixture_bytes: Callable[[str], bytes]
) -> None:
    data = fixture_bytes("redis-eviction.html")
    note = import_one(client, "redis-eviction.html", data)
    response = client.get(f"/api/notes/{note['id']}/original")
    assert response.status_code == 200
    assert response.content == data


# Requirement: Show the original page safely (server side of the isolation)
def test_original_is_served_sandboxed(client: TestClient) -> None:
    note = import_one(client, "s.html", b"<title>S</title><script>alert(1)</script>")
    response = client.get(f"/api/notes/{note['id']}/original")
    assert response.headers["content-security-policy"] == "sandbox allow-scripts"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-type"].startswith("text/html")


# Scenario: Same file imported twice (even under another name)
def test_same_content_under_another_name_is_duplicate(
    client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    data = fixture_bytes("redis-eviction.html")
    first = import_one(client, "redis-eviction.html", data)
    (second,) = upload(client, ("copy-of-redis.html", data, HTML))
    assert second["outcome"] == "duplicate"
    assert second["note"]["id"] == first["id"]
    assert len(client.get("/api/notes").json()) == 1


# Requirement: List, read, rename and delete notes
def test_list_is_newest_first(client: TestClient) -> None:
    a = import_one(client, "a.html", b"<title>A</title>")
    b = import_one(client, "b.html", b"<title>B</title>")
    ids = [n["id"] for n in client.get("/api/notes").json()]
    assert ids == [b["id"], a["id"]]


def test_read_note_has_text_and_metadata(
    client: TestClient, fixture_bytes: Callable[[str], bytes]
) -> None:
    note = import_one(client, "redis-eviction.html", fixture_bytes("redis-eviction.html"))
    detail = client.get(f"/api/notes/{note['id']}").json()
    assert detail["title"] == "Redis eviction policies"
    assert "allkeys-lru" in detail["body_text"]
    assert detail["node_id"] is None


def test_unknown_note_is_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/notes/{missing}").status_code == 404
    assert client.get(f"/api/notes/{missing}/original").status_code == 404
    assert client.delete(f"/api/notes/{missing}").status_code == 404


# Scenario: Rename a note
def test_rename_keeps_original(client: TestClient, fixture_bytes: Callable[[str], bytes]) -> None:
    data = fixture_bytes("redis-eviction.html")
    note = import_one(client, "redis-eviction.html", data)
    response = client.patch(f"/api/notes/{note['id']}", json={"title": "Redis: eviction and TTL"})
    assert response.status_code == 200
    assert response.json()["title"] == "Redis: eviction and TTL"
    assert client.get(f"/api/notes/{note['id']}").json()["title"] == "Redis: eviction and TTL"
    assert client.get(f"/api/notes/{note['id']}/original").content == data


def test_blank_title_is_rejected(client: TestClient) -> None:
    note = import_one(client, "a.html", b"<title>A</title>")
    assert client.patch(f"/api/notes/{note['id']}", json={"title": "  "}).status_code == 422
    assert client.get(f"/api/notes/{note['id']}").json()["title"] == "A"


# Scenario: Delete a note
def test_delete_removes_note_and_original(client: TestClient, settings: Settings) -> None:
    note = import_one(client, "a.html", b"<title>A</title>")
    blobs = list(Path(settings.storage_dir).rglob("*.html"))
    assert len(blobs) == 1
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert client.get("/api/notes").json() == []
    assert client.get(f"/api/notes/{note['id']}").status_code == 404
    assert not blobs[0].exists()


# Spec: knowledge-import - Scenario: Lower limit on the hosted copy
def test_the_too_large_reason_names_the_configured_limit(
    settings_factory: Callable[..., Settings],
) -> None:
    app = create_app(settings_factory(max_upload_bytes=4 * 1024 * 1024))
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as small:
        big = b"<html><body>" + b"x" * (6 * 1024 * 1024) + b"</body></html>"
        response = small.post(
            "/api/notes/import", files=[("files", ("big.html", big, "text/html"))]
        )
        assert response.status_code == 200, response.text
        [outcome] = response.json()["results"]
        assert (outcome["outcome"], outcome["reason"]) == ("rejected", "larger than 4 MB")
    app.state.engine.dispose()


# Spec: delivery - Large answers are streamed (Scenario: Open a 9 MB note)
def test_a_large_note_page_is_streamed_whole_with_the_sandbox_headers(client: TestClient) -> None:
    body = b"<html><body><p>" + b"y" * (5 * 1024 * 1024 + 123) + b"</p></body></html>"
    imported = client.post(
        "/api/notes/import", files=[("files", ("large.html", body, "text/html"))]
    )
    note_id = imported.json()["results"][0]["note"]["id"]
    with client.stream("GET", f"/api/notes/{note_id}/original") as response:
        chunks = list(response.iter_bytes())
        assert response.status_code == 200
        assert response.headers["content-security-policy"] == "sandbox allow-scripts"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["content-type"].startswith("text/html")
        # Streamed, not buffered: no fixed length is announced.
        assert "content-length" not in response.headers
    assert b"".join(chunks) == body
