"""Spec: notifications - New sign-in and Restore notifications."""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.auth.sessions import device_of
from app.db import Notification, User, UserSession
from tests.auth_fakes import EMAIL, PASSWORD, AuthKit
from tests.conftest import user_id_of
from tests.test_data_backup import download, import_note, restore
from tests.test_data_sync import UPLOAD, anonymous, app_of, bearer, make_key, start

EDGE = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
)
FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"


def sign_ins(app: Any, email: str = EMAIL) -> list[Notification]:
    with app.state.session_factory() as db:
        return list(
            db.scalars(
                select(Notification)
                .where(Notification.user_id == user_id_of(app, email))
                .where(Notification.kind == "new_sign_in")
                .order_by(Notification.created_at)
            )
        )


def login_as(kit: AuthKit, agent: str) -> None:
    response = kit.browser().post(
        "/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"user-agent": agent},
    )
    assert response.status_code == 200, response.text


def age_account(app: Any, days: int = 1) -> None:
    """The sign-in that comes with creating an account is skipped; later ones are checked."""
    with app.state.session_factory() as db:
        db.execute(update(User).values(created_at=datetime.now(UTC) - timedelta(days=days)))
        db.commit()


def test_device_labels() -> None:
    assert device_of(EDGE) == ("Edge", "Windows")
    assert device_of(FIREFOX) == ("Firefox", "Linux")
    assert device_of(None) == ("Unknown browser", "Unknown system")


# Scenario: New browser
def test_a_new_browser_notifies_and_a_known_one_does_not(kit: AuthKit) -> None:
    first = kit.browser().post(
        "/api/auth/signup",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"user-agent": EDGE},
    )
    assert first.status_code == 201
    assert sign_ins(kit.app) == []  # the sign-in that creates the account is no news
    age_account(kit.app)
    login_as(kit, FIREFOX)
    (note,) = sign_ins(kit.app)
    assert note.params == {"browser": "Firefox", "system": "Linux", "address": "testclient"}
    assert note.link == "#/profile/security"
    login_as(kit, EDGE)
    login_as(kit, FIREFOX)
    assert len(sign_ins(kit.app)) == 1


def test_a_browser_last_seen_over_90_days_ago_is_new_again(kit: AuthKit) -> None:
    kit.browser().post(
        "/api/auth/signup",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"user-agent": EDGE},
    ).raise_for_status()
    with kit.app.state.session_factory() as db:
        old = datetime.now(UTC) - timedelta(days=100)
        db.execute(update(UserSession).values(last_seen_at=old, created_at=old))
        db.commit()
    age_account(kit.app)
    login_as(kit, EDGE)
    assert len(sign_ins(kit.app)) == 1


def test_a_sign_in_with_no_sessions_left_still_notifies(kit: AuthKit) -> None:
    """After every session ended (log out everywhere), a stranger's sign-in must not be silent."""
    kit.browser().post(
        "/api/auth/signup",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"user-agent": EDGE},
    ).raise_for_status()
    age_account(kit.app)
    with kit.app.state.session_factory() as db:
        db.execute(UserSession.__table__.delete())
        db.commit()
    login_as(kit, FIREFOX)
    (note,) = sign_ins(kit.app)
    assert note.params["browser"] == "Firefox"


def test_a_sign_in_right_after_sign_up_is_not_new(kit: AuthKit) -> None:
    kit.browser().post(
        "/api/auth/signup",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"user-agent": EDGE},
    ).raise_for_status()
    login_as(kit, FIREFOX)
    assert sign_ins(kit.app) == []


# Scenario: Sync upload restored
def counts_of(app: Any) -> list[Notification]:
    with app.state.session_factory() as db:
        return list(db.scalars(select(Notification).where(Notification.kind == "restored")))


def test_restore_notifies_with_the_counts(client: TestClient) -> None:
    import_note(client, "Alpha")
    import_note(client, "Beta")
    backup = download(client)
    assert restore(client, backup).status_code == 200
    (note,) = counts_of(client.app)
    assert note.params == {"notes": 2, "lessons": 0}
    assert note.link == "#/" and note.read_at is None


def test_sync_upload_notifies_the_owner(client: TestClient) -> None:
    import_note(client, "Travels")
    backup = download(client)
    key = make_key(client)["key"]
    other = anonymous(app_of(client))
    upload_id = start(other, key)
    sent = other.put(f"{UPLOAD}/{upload_id}/0", content=backup, headers=bearer(key))
    assert sent.status_code == 200
    done = other.post(
        f"{UPLOAD}/{upload_id}/finish",
        json={"parts": 1, "sha256": hashlib.sha256(backup).hexdigest()},
        headers=bearer(key),
    )
    assert done.status_code == 200, done.text
    (note,) = counts_of(client.app)
    assert note.params == {"notes": 1, "lessons": 0}
    assert note.user_id == user_id_of(client.app)
