"""Spec: accounts - Each user chooses a time zone (backend side)."""

from collections.abc import Callable

from fastapi.testclient import TestClient

from app.config import Settings
from app.db import User
from tests.auth_fakes import H, auth_kit

URL = "/api/auth/timezone"


def stored_zone(client: TestClient, email: str | None = None) -> str | None:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        from sqlalchemy import select

        query = select(User.timezone)
        query = query.where(User.email == email) if email else query.where(User.role == "admin")
        return db.scalars(query).one()


# Scenario: Asked after sign-in (a member without a zone reads null; Save stores it)
def test_new_member_has_no_zone_and_save_stores_it(
    settings_factory: Callable[..., Settings],
) -> None:
    with auth_kit(settings_factory()) as kit:
        signup = kit.signup()
        assert signup.status_code == 201 and signup.json()["timezone"] is None
        assert kit.client.get("/api/auth/me").json()["timezone"] is None
        saved = kit.client.put(URL, json={"timezone": "Asia/Ho_Chi_Minh"})
        assert saved.status_code == 200
        assert saved.json()["timezone"] == "Asia/Ho_Chi_Minh"
        assert saved.json()["email"] == "me@example.test"
        assert stored_zone(kit.client, "me@example.test") == "Asia/Ho_Chi_Minh"


# Scenario: Not now (nothing is stored until Save; no call, no change)
def test_nothing_is_stored_without_a_save(settings_factory: Callable[..., Settings]) -> None:
    with auth_kit(settings_factory()) as kit:
        kit.signup()
        kit.client.get("/api/auth/me")
        assert stored_zone(kit.client, "me@example.test") is None


# Scenario: Not asked again (the zone is still there after signing in again)
def test_zone_survives_a_new_sign_in(settings_factory: Callable[..., Settings]) -> None:
    with auth_kit(settings_factory()) as kit:
        kit.signup()
        kit.client.put(URL, json={"timezone": "Europe/Berlin"})
        other = kit.browser()
        login = kit.login(other)
        assert login.json()["timezone"] == "Europe/Berlin"
        assert other.get("/api/auth/me").json()["timezone"] == "Europe/Berlin"


# Scenario: Change in Settings (a stored zone can be replaced; still there on the next read)
def test_zone_can_be_changed(client: TestClient) -> None:
    assert client.get("/api/auth/me").json()["timezone"] == "UTC"
    assert client.put(URL, json={"timezone": "America/New_York"}).status_code == 200
    assert client.put(URL, json={"timezone": "Asia/Tokyo"}).json()["timezone"] == "Asia/Tokyo"
    assert client.get("/api/auth/me").json()["timezone"] == "Asia/Tokyo"
    assert stored_zone(client) == "Asia/Tokyo"


# Scenario: Unknown name (refused, nothing changes)
def test_unknown_names_are_refused_and_change_nothing(client: TestClient) -> None:
    client.put(URL, json={"timezone": "Asia/Tokyo"})
    for bad in ["Mars/Olympus", "", "utc-ish", "asia/tokyo", "x" * 65, "Asia/Tokyo" + " " * 60]:
        response = client.put(URL, json={"timezone": bad})
        assert response.status_code == 422, bad
        assert response.json()["detail"] == "unknown time zone", bad
    assert stored_zone(client) == "Asia/Tokyo"


def test_null_and_missing_values_are_refused(client: TestClient) -> None:
    for body in ({"timezone": None}, {}, {"timezone": 5}):
        assert client.put(URL, json=body).status_code == 422, body
    assert client.get("/api/auth/me").json()["timezone"] == "UTC"


# Scenario: Missing header (forbidden, nothing changes)
def test_missing_header_is_forbidden(client: TestClient) -> None:
    del client.headers["X-LearningHub"]
    response = client.put(URL, json={"timezone": "Asia/Tokyo"})
    assert response.status_code == 403
    assert stored_zone(client) == "UTC"


# Needs a session
def test_a_session_is_needed(settings_factory: Callable[..., Settings]) -> None:
    with auth_kit(settings_factory()) as kit:
        response = kit.browser().put(URL, json={"timezone": "Asia/Tokyo"})
        assert response.status_code == 401


# Only the caller's own row changes
def test_only_the_callers_own_row_changes(settings_factory: Callable[..., Settings]) -> None:
    with auth_kit(settings_factory()) as kit:
        kit.signup(email="a@example.test")
        other = kit.browser()
        kit.signup(other, email="b@example.test")
        assert kit.client.put(URL, json={"timezone": "Asia/Tokyo"}).status_code == 200
        assert stored_zone(kit.client, "a@example.test") == "Asia/Tokyo"
        assert stored_zone(kit.client, "b@example.test") is None
        assert other.get("/api/auth/me").json()["timezone"] is None
        assert H["X-LearningHub"] == "1"
