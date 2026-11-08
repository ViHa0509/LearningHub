"""Spec: auth - Sessions protect the app (the gate on every router, sessions list and revoke)."""

import re
import uuid
from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.auth_fakes import AuthKit
from tests.conftest import signed_in_client

PUBLIC = ("/api/health", "/api/auth/")


def gated_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Every API operation (from the OpenAPI schema) except health and auth."""
    found = []
    for raw_path, operations in app.openapi()["paths"].items():
        if raw_path.startswith(PUBLIC):
            continue
        path = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), raw_path)
        found.extend((method.upper(), path) for method in operations)
    return found


# Scenario: No session (for every router, not only notes)
def test_every_data_route_answers_401_without_a_session(
    settings_factory: Callable[..., Settings],
) -> None:
    app = create_app(settings_factory())
    routes = gated_routes(app)
    prefixes = {path.split("/")[2] for _, path in routes}
    assert {
        "domains",
        "notes",
        "lessons",
        "agent",
        "ai-providers",
        "agents",
        "resources",
        "news",
    } <= prefixes
    with TestClient(app, headers={"X-LearningHub": "1"}) as client:
        for method, path in routes:
            response = client.request(method, path)
            assert response.status_code == 401, (method, path)
            assert response.json() == {"detail": "Sign in to continue"}
    app.state.engine.dispose()


def test_no_session_on_get_notes(kit: AuthKit) -> None:
    response = kit.client.get("/api/notes")
    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in to continue"
    assert kit.client.get("/api/health").status_code == 200
    assert kit.client.get("/api/auth/status").status_code == 200


def test_a_forged_or_expired_cookie_is_not_a_session(kit: AuthKit) -> None:
    kit.signup()
    forged = TestClient(kit.app, cookies={"lh_session": "made-up-token"})
    assert forged.get("/api/notes").status_code == 401
    kit.clock.advance(days=31)
    assert kit.client.get("/api/notes").status_code == 401


def test_sessions_slide_forward(kit: AuthKit) -> None:
    kit.signup()
    [first] = kit.client.get("/api/auth/sessions").json()
    kit.clock.advance(minutes=30)
    quiet = kit.client.get("/api/notes")
    assert "set-cookie" not in quiet.headers  # at most one write per hour
    kit.clock.advance(days=20)
    slid = kit.client.get("/api/notes")
    assert slid.status_code == 200
    assert "max-age=2592000" in slid.headers["set-cookie"].lower()
    [after] = kit.client.get("/api/auth/sessions").json()
    assert after["expires_at"] > first["expires_at"]
    # 29 days after the slide the session is still good, though 49 days passed since login.
    kit.clock.advance(days=29)
    assert kit.client.get("/api/notes").status_code == 200


def test_login_off_keeps_the_old_open_behaviour(settings_factory: Callable[..., Settings]) -> None:
    app = create_app(settings_factory(auth_required=False))
    with TestClient(app) as client:
        assert client.get("/api/notes").status_code == 200
        assert client.get("/api/domains").status_code == 200
        assert client.get("/api/ai-providers").status_code == 200
        # The app-header rule is unchanged.
        refused = client.post("/api/news/refresh")
        assert refused.status_code == 403
        assert client.get("/api/auth/status").json()["auth_required"] is False
        assert client.get("/api/auth/me").status_code == 401
    app.state.engine.dispose()


def test_login_on_answers_401_without_and_200_with_a_session(
    settings_factory: Callable[..., Settings],
) -> None:
    app = create_app(settings_factory(auth_required=True))
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/notes").status_code == 401
        assert anonymous.get("/api/domains").status_code == 401
        # A missing session is reported before a missing app header.
        assert anonymous.post("/api/news/refresh").status_code == 401
    with signed_in_client(app) as signed:
        assert signed.get("/api/notes").status_code == 200
        assert signed.get("/api/domains").status_code == 200
        assert signed.post("/api/news/refresh").status_code == 403
    app.state.engine.dispose()


def test_note_original_and_print_need_the_session_cookie(kit: AuthKit) -> None:
    note = str(uuid.uuid4())
    for path in (f"/api/notes/{note}/original", f"/api/notes/{note}/print"):
        assert kit.client.get(path).status_code == 401
    kit.signup()
    # Signed in, the same URLs reach the route (an unknown note: 404, not 401).
    for path in (f"/api/notes/{note}/original", f"/api/notes/{note}/print"):
        assert kit.client.get(path).status_code == 404


def test_list_sessions_marks_the_current_one(kit: AuthKit) -> None:
    kit.signup()
    other = kit.browser()
    kit.login(other)
    listing = kit.client.get("/api/auth/sessions")
    assert listing.status_code == 200
    sessions = listing.json()
    assert len(sessions) == 2
    assert sorted(s["current"] for s in sessions) == [False, True]
    assert set(sessions[0]) == {
        "id",
        "created_at",
        "last_seen_at",
        "expires_at",
        "user_agent",
        "ip",
        "current",
    }
    assert kit.client.cookies["lh_session"] not in listing.text


def test_revoke_one_session(kit: AuthKit) -> None:
    kit.signup()
    other = kit.browser()
    kit.login(other)
    other_id = next(s["id"] for s in other.get("/api/auth/sessions").json() if s["current"])
    assert kit.client.delete(f"/api/auth/sessions/{other_id}").status_code == 204
    assert other.get("/api/notes").status_code == 401
    assert kit.client.get("/api/notes").status_code == 200
    missing = kit.client.delete(f"/api/auth/sessions/{uuid.uuid4()}")
    assert missing.status_code == 404


def test_revoking_the_current_session_clears_the_cookie(kit: AuthKit) -> None:
    kit.signup()
    [mine] = kit.client.get("/api/auth/sessions").json()
    response = kit.client.delete(f"/api/auth/sessions/{mine['id']}")
    assert response.status_code == 204
    assert "lh_session=" in response.headers["set-cookie"]
    assert kit.client.get("/api/notes").status_code == 401


# Scenario: Log out everywhere else
def test_log_out_everywhere_else(kit: AuthKit) -> None:
    kit.signup()
    others = [kit.browser(), kit.browser()]
    for browser in others:
        kit.login(browser)
    response = kit.client.post("/api/auth/sessions/logout-others")
    assert response.status_code == 200
    assert response.json() == {"revoked": 2}
    for browser in others:
        assert browser.get("/api/notes").status_code == 401
    assert kit.client.get("/api/notes").status_code == 200
    assert len(kit.client.get("/api/auth/sessions").json()) == 1


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/auth/sessions"),
        ("POST", "/api/auth/sessions/logout-others"),
        ("DELETE", f"/api/auth/sessions/{uuid.uuid4()}"),
    ],
)
def test_session_routes_need_a_session(kit: AuthKit, method: str, path: str) -> None:
    assert kit.client.request(method, path).status_code == 401
