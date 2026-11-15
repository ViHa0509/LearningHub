"""Spec: agent-settings (area settings are the user's own data, scenario Round trip)."""

import io
import json
import zipfile
from datetime import datetime
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db import AreaAgentSetting, User
from tests.test_data_backup import download, restore, rewrite

FILE = "data/area_agent_settings.json"


def user_ids(client: TestClient) -> tuple[Any, Any]:
    """The ids of the signed-in owner and of the member (the second user)."""
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        users = list(db.scalars(select(User).order_by(User.created_at)))
    assert len(users) >= 2
    return users[0].id, users[1].id


def seed(client: TestClient) -> None:
    owner, member = user_ids(client)
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        db.add_all(
            [
                AreaAgentSetting(
                    user_id=owner,
                    domain_id="cooking",
                    instructions="Be brief.",
                    tools=["read_note"],
                ),
                AreaAgentSetting(user_id=owner, domain_id="music", instructions="", tools=None),
                AreaAgentSetting(
                    user_id=member, domain_id="cooking", instructions="Member only.", tools=[]
                ),
            ]
        )
        db.commit()


def shape(client: TestClient, which: int) -> list[tuple[Any, ...]]:
    owner_or_member = user_ids(client)[which]
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        rows = db.scalars(
            select(AreaAgentSetting)
            .where(AreaAgentSetting.user_id == owner_or_member)
            .order_by(AreaAgentSetting.domain_id)
        )
        return [(r.domain_id, r.instructions, r.tools, r.updated_at) for r in rows]


def wipe(client: TestClient) -> None:
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        db.execute(delete(AreaAgentSetting))
        db.commit()


# Scenario: Round trip
def test_round_trip_brings_back_the_rows_and_never_holds_another_users(
    client: TestClient, second_client: TestClient
) -> None:
    seed(client)
    before = shape(client, 0)
    member_before = shape(client, 1)
    backup = download(client)
    archive = zipfile.ZipFile(io.BytesIO(backup))
    rows = json.loads(archive.read(FILE))
    assert [r["domain_id"] for r in rows] == ["cooking", "music"]
    assert rows[0]["tools"] == ["read_note"] and rows[1]["tools"] is None
    datetime.fromisoformat(rows[0]["updated_at"])
    assert json.loads(archive.read("manifest.json"))["counts"]["area_agent_settings"] == 2
    assert "Member only." not in archive.read(FILE).decode()

    wipe(client)
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["area_agent_settings"] == 2
    assert shape(client, 0) == before
    assert shape(client, 1) == []  # the restore did not give the owner's rows to the member
    assert member_before == [("cooking", "Member only.", [], member_before[0][3])]


def test_restore_replaces_rows_made_after_the_backup(
    client: TestClient, second_client: TestClient
) -> None:
    seed(client)
    before = shape(client, 0)
    backup = download(client)
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        db.add(AreaAgentSetting(user_id=user_ids(client)[0], domain_id="later", instructions="x"))
        db.commit()
    assert restore(client, backup).status_code == 200
    assert shape(client, 0) == before


def test_an_archive_from_before_area_settings_restores_without_rows(
    client: TestClient, second_client: TestClient
) -> None:
    seed(client)
    old = rewrite(download(client), lambda entries: entries.pop(FILE))
    response = restore(client, old)
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["area_agent_settings"] == 0
    assert shape(client, 0) == []


def test_a_malformed_entry_is_refused_and_changes_nothing(
    client: TestClient, second_client: TestClient
) -> None:
    seed(client)
    before = shape(client, 0)
    backup = download(client)
    bad_files = [
        [
            {
                "domain_id": "cooking",
                "instructions": "",
                "tools": "read_note",
                "updated_at": "2026-01-01T00:00:00Z",
            }
        ],
        [
            {
                "domain_id": "cooking",
                "instructions": "",
                "tools": [1],
                "updated_at": "2026-01-01T00:00:00Z",
            }
        ],
        [{"domain_id": 5, "instructions": "", "tools": None, "updated_at": "2026-01-01T00:00:00Z"}],
        {"domain_id": "cooking"},
    ]
    for bad in bad_files:

        def change(entries: dict[str, bytes], bad: Any = bad) -> None:
            entries[FILE] = json.dumps(bad).encode()

        response = restore(client, rewrite(backup, change))
        assert response.status_code == 422, response.text
        assert shape(client, 0) == before
