"""Spec: data-sync - fields in the backup (data/learning_fields.json)."""

import io
import json
import zipfile
from typing import Any

from fastapi.testclient import TestClient

from tests.test_data_backup import download, restore, rewrite
from tests.test_learning_fields import aws, fields, make_area, make_field, put_topics

FIELDS = "data/learning_fields.json"


def shape(client: TestClient) -> list[Any]:
    """Own fields with areas and topics, without ids."""
    out = []
    for field in fields(client)[1:]:
        areas = []
        for area in field["areas"]:
            nodes = client.get(f"/api/domains/{area['id']}/roadmap").json()["nodes"]
            topics = [(n["id"], n["title"], n["description"], n["parent"]) for n in nodes]
            areas.append((area["id"], area["title"], area["description"], topics))
        out.append((field["title"], field["order"], field["published"], areas))
    return out


def test_backup_holds_fields_with_areas_and_topics(client: TestClient) -> None:
    aws(client)
    archive = zipfile.ZipFile(io.BytesIO(download(client)))
    manifest = json.loads(archive.read("manifest.json"))
    counts = manifest["counts"]
    assert (counts["learning_fields"], counts["learning_areas"], counts["learning_topics"]) == (
        1,
        1,
        3,
    )
    data = json.loads(archive.read(FIELDS))
    assert [f["title"] for f in data] == ["Cloud"]
    assert [a["slug"] for a in data[0]["areas"]] == ["aws"]
    assert [t["slug"] for t in data[0]["areas"][0]["topics"]] == ["iam", "compute", "ec2"]
    assert "id" not in data[0] and "user_id" not in data[0] and "id" not in data[0]["areas"][0]


# Scenario: Round trip
def test_round_trip_brings_back_fields_areas_and_topics(client: TestClient) -> None:
    field_id = aws(client)
    client.patch(f"/api/fields/{field_id}", json={"published": True})
    before = shape(client)
    assert before[0][2] is True
    backup = download(client)
    assert client.delete(f"/api/fields/{field_id}").status_code == 204
    assert shape(client) == []
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["learning_topics"] == 3
    assert shape(client) == before
    assert client.get("/api/lessons/aws/iam").status_code == 200


def test_restore_replaces_the_fields_made_after_the_backup(client: TestClient) -> None:
    aws(client)
    backup = download(client)
    make_field(client, "Later")
    assert restore(client, backup).status_code == 200
    assert [f[0] for f in shape(client)] == ["Cloud"]


def test_archive_without_a_fields_entry_leaves_the_fields(client: TestClient) -> None:
    aws(client)
    before = shape(client)
    old = rewrite(download(client), lambda entries: entries.pop(FIELDS))
    response = restore(client, old)
    assert response.status_code == 200, response.text
    assert "learning_fields" not in response.json()["counts"]
    assert shape(client) == before


def test_slug_used_by_another_user_stops_the_restore(
    client: TestClient, second_client: TestClient
) -> None:
    field_id = aws(client)
    backup = download(client)
    client.delete(f"/api/fields/{field_id}")
    own = make_field(second_client, "Mine")
    make_area(second_client, own["id"], "aws")
    mine = make_field(client, "Admin keeps this")
    before = shape(client)
    response = restore(client, backup)
    assert response.status_code == 422, response.text
    assert "'aws'" in response.json()["detail"]
    assert shape(client) == before
    assert [f["title"] for f in fields(client)[1:]] == [mine["title"]]
    assert [a["id"] for a in fields(second_client)[1]["areas"]] == ["aws"]


def test_a_member_restoring_a_published_field_does_not_publish_it(
    client: TestClient, second_client: TestClient
) -> None:
    field_id = aws(client)
    client.patch(f"/api/fields/{field_id}", json={"published": True})
    backup = download(client)
    client.delete(f"/api/fields/{field_id}")
    response = restore(second_client, backup)
    assert response.status_code == 200, response.text
    assert [(f[0], f[2]) for f in shape(second_client)] == [("Cloud", False)]
    assert [f["id"] for f in fields(client)] == ["it"]


def test_invalid_fields_entry_is_refused_and_changes_nothing(client: TestClient) -> None:
    aws(client)
    before = shape(client)

    def bad_parent(entries: dict[str, bytes]) -> None:
        data = json.loads(entries[FIELDS])
        data[0]["areas"][0]["topics"][0]["parent_slug"] = "missing"
        entries[FIELDS] = json.dumps(data).encode()

    def bad_slug(entries: dict[str, bytes]) -> None:
        data = json.loads(entries[FIELDS])
        data[0]["areas"][0]["slug"] = "Not Kebab"
        entries[FIELDS] = json.dumps(data).encode()

    def duplicate_area(entries: dict[str, bytes]) -> None:
        data = json.loads(entries[FIELDS])
        data[0]["areas"].append(dict(data[0]["areas"][0]))
        entries[FIELDS] = json.dumps(data).encode()

    def not_a_list(entries: dict[str, bytes]) -> None:
        entries[FIELDS] = b'{"fields": []}'

    for change in (bad_parent, bad_slug, duplicate_area, not_a_list):
        response = restore(client, rewrite(download(client), change))
        assert response.status_code == 422, response.text
        assert "learning_fields.json" in response.json()["detail"]
        assert shape(client) == before


def test_a_roadmap_slug_in_the_archive_is_refused(client: TestClient) -> None:
    aws(client)
    before = shape(client)

    def take_builtin(entries: dict[str, bytes]) -> None:
        data = json.loads(entries[FIELDS])
        data[0]["areas"][0]["slug"] = "backend"
        entries[FIELDS] = json.dumps(data).encode()

    response = restore(client, rewrite(download(client), take_builtin))
    assert response.status_code == 422, response.text
    assert "'backend'" in response.json()["detail"]
    assert shape(client) == before
    assert put_topics(client, "aws", []).status_code == 200
