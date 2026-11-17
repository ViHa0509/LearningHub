"""Spec: kh-connector, scenario "Backup": the archive holds no Knowledge Hub connection data, and
restoring it keeps the connection rows untouched."""

import io
import json
import zipfile
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import KhConnection, User
from tests.test_data_backup import download, restore

REFRESH_TOKEN = "REFRESH-TOKEN-IN-THE-BACKUP-TEST"
KH_EMAIL = "kh.person@example.test"
USER_CODE = "WXYZ-9876"


def seed(client: TestClient) -> None:
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        owner, member = list(db.scalars(select(User).order_by(User.created_at)))[:2]
        db.add(
            KhConnection(
                user_id=owner.id,
                status="connected",
                refresh_token_enc=app.state.box.encrypt(REFRESH_TOKEN),
                kh_email=KH_EMAIL,
                personal_project="p-1",
            )
        )
        db.add(
            KhConnection(
                user_id=member.id,
                status="pending",
                device_code_enc=app.state.box.encrypt("DEVICE-CODE"),
                verifier_enc=app.state.box.encrypt("VERIFIER"),
                user_code=USER_CODE,
                verification_uri="https://idp.test/device",
                interval=5,
            )
        )
        db.commit()


def rows(client: TestClient) -> list[tuple[Any, ...]]:
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        return [
            (
                r.user_id,
                r.status,
                r.refresh_token_enc,
                r.device_code_enc,
                r.verifier_enc,
                r.user_code,
                r.kh_email,
                r.personal_project,
            )
            for r in db.scalars(select(KhConnection).order_by(KhConnection.status))
        ]


def test_backup_holds_no_kh_connection_data(client: TestClient, second_client: TestClient) -> None:
    seed(client)
    backup = download(client)
    archive = zipfile.ZipFile(io.BytesIO(backup))
    for name in archive.namelist():
        content = archive.read(name).decode("utf-8", errors="ignore")
        assert "kh_connection" not in name.lower() and "kh_connection" not in content
        for secret in (REFRESH_TOKEN, KH_EMAIL, USER_CODE, "DEVICE-CODE", "VERIFIER"):
            assert secret not in content, name
    counts = json.loads(archive.read("manifest.json"))["counts"]
    assert not [key for key in counts if key.startswith("kh")]


def test_restore_keeps_the_connection_rows_untouched(
    client: TestClient, second_client: TestClient
) -> None:
    seed(client)
    before = rows(client)
    assert len(before) == 2
    backup = download(client)
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert rows(client) == before


def test_restore_of_an_archive_works_for_a_user_with_no_connection(
    client: TestClient, second_client: TestClient
) -> None:
    backup = download(client)
    seed(client)
    before = rows(client)
    assert restore(client, backup).status_code == 200
    assert rows(client) == before
