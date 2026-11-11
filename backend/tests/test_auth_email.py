"""Spec: auth - One Owner account; Email and password; Sessions protect the app (rate limit)."""

import logging
from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import create_engine, text

from app.config import Settings
from tests.auth_fakes import EMAIL, PASSWORD, AuthKit, auth_kit
from tests.conftest import TEST_DATABASE_URL

WRONG = "Wrong email or password"


def db_scalar(sql: str) -> Any:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        value = connection.execute(text(sql)).scalar()
    engine.dispose()
    return value


def db_rows(sql: str) -> list[Any]:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        rows = list(connection.execute(text(sql)))
    engine.dispose()
    return rows


# Scenario: First visit (the API side: no owner yet, which sign-ins are offered)
def test_status_before_the_owner_exists(kit: AuthKit) -> None:
    status = kit.client.get("/api/auth/status")
    assert status.status_code == 200
    assert status.json() == {
        "auth_required": True,
        "has_owner": False,
        "providers": {"github": {"configured": False}, "google": {"configured": False}},
        "mail": {"mode": "outbox"},
    }
    assert kit.client.get("/api/auth/me").status_code == 401


def test_signup_creates_the_owner_signs_in_and_sends_a_verify_link(kit: AuthKit) -> None:
    response = kit.client.post(
        "/api/auth/signup",
        json={"email": "  Me@Example.TEST ", "password": PASSWORD, "display_name": " Me "},
    )
    assert response.status_code == 201
    me = response.json()
    assert me["email"] == EMAIL
    assert me["email_verified"] is False
    assert me["display_name"] == "Me"
    assert me["has_password"] is True and me["linked"] == []
    assert kit.client.get("/api/auth/me").json()["id"] == me["id"]
    assert kit.client.get("/api/notes").status_code == 200
    assert kit.client.get("/api/auth/status").json()["has_owner"] is True
    [mail] = kit.mailer.sent
    assert mail.purpose == "verify-email" and mail.to == EMAIL
    assert "http://localhost:5173/#/auth/verify?token=" in mail.body
    stored = db_scalar("SELECT password_hash FROM users")
    assert stored.startswith("scrypt$") and PASSWORD not in stored


# Scenario: Sign-up closed
def test_signup_is_refused_once_the_owner_exists(kit: AuthKit) -> None:
    assert kit.signup().status_code == 201
    stranger = kit.browser()
    refused = kit.signup(stranger, email="other@example.test")
    assert refused.status_code == 403
    assert refused.json()["detail"] == "You need an invitation to join"
    assert "lh_session" not in refused.cookies
    assert db_scalar("SELECT count(*) FROM users") == 1


@pytest.mark.parametrize(
    ("email", "password", "detail"),
    [
        ("me@example.test", "short", "Use at least 10 characters for the password."),
        ("not-an-email", PASSWORD, "Enter a valid email address."),
    ],
)
def test_signup_checks_email_and_password(
    kit: AuthKit, email: str, password: str, detail: str
) -> None:
    response = kit.signup(email=email, password=password)
    assert response.status_code == 400
    assert response.json()["detail"] == detail
    assert db_scalar("SELECT count(*) FROM users") == 0


def test_auth_posts_need_the_app_header(kit: AuthKit) -> None:
    response = kit.client.post(
        "/api/auth/signup",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"X-LearningHub": ""},
    )
    assert response.status_code == 403
    assert db_scalar("SELECT count(*) FROM users") == 0


# Scenario: Log in and out
def test_log_in_and_out(kit: AuthKit) -> None:
    kit.signup()
    assert kit.client.post("/api/auth/logout").status_code == 204
    assert kit.client.get("/api/notes").status_code == 401
    assert kit.client.get("/api/auth/me").status_code == 401
    logged = kit.login()
    assert logged.status_code == 200
    assert logged.json()["email"] == EMAIL
    assert kit.client.get("/api/notes").status_code == 200
    # The ended session stays ended.
    assert db_scalar("SELECT count(*) FROM sessions") == 1


def test_logout_without_a_session_is_harmless(kit: AuthKit) -> None:
    assert kit.client.post("/api/auth/logout").status_code == 204


# Scenario: Wrong password
def test_wrong_password_and_unknown_email_get_the_same_answer(
    kit: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    kit.signup()
    kit.client.post("/api/auth/logout")
    burned: list[str] = []
    import app.routes.auth as auth_routes

    real_burn = auth_routes.burn_time
    monkeypatch.setattr(auth_routes, "burn_time", lambda pw: (burned.append("x"), real_burn(pw)))
    wrong_password = kit.login(password="incorrect pass")
    unknown_email = kit.login(email="nobody@example.test")
    for response in (wrong_password, unknown_email):
        assert response.status_code == 401
        assert response.json() == {"detail": WRONG}
        assert "lh_session" not in response.cookies
    # The unknown email still pays for one scrypt check (no timing difference).
    assert burned == ["x"]
    assert kit.client.get("/api/notes").status_code == 401
    assert db_scalar("SELECT count(*) FROM sessions") == 0


def test_session_cookie_flags(kit: AuthKit) -> None:
    response = kit.signup()
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("lh_session=")
    flags = [part.strip().lower() for part in cookie.split(";")]
    assert "httponly" in flags
    assert "samesite=lax" in flags
    assert "path=/" in flags
    assert "max-age=2592000" in flags
    assert "secure" not in flags
    token = response.cookies["lh_session"]
    hashes = [r.token_hash for r in db_rows("SELECT token_hash FROM sessions")]
    assert token not in hashes and len(hashes[0]) == 64


def test_session_cookie_is_secure_behind_https(settings_factory: Callable[..., Settings]) -> None:
    with auth_kit(settings_factory(public_url="https://hub.example.test")) as https_kit:
        cookie = https_kit.signup().headers["set-cookie"].lower()
    assert "; secure" in cookie


# Scenario: Reset password
def test_reset_password(kit: AuthKit) -> None:
    kit.signup()
    other = kit.browser()
    assert kit.login(other).status_code == 200
    answer = kit.browser().post("/api/auth/forgot", json={"email": "ME@example.test"})
    assert answer.status_code == 200
    reset_mail = kit.mailer.sent[-1]
    assert reset_mail.purpose == "reset-password"
    token = kit.mailer.token("reset-password")
    assert f"http://localhost:5173/#/auth/reset?token={token}" in reset_mail.body

    fresh = kit.browser()
    short = fresh.post("/api/auth/reset", json={"token": token, "password": "short"})
    assert short.status_code == 400  # the link is not used up by a short password
    done = fresh.post("/api/auth/reset", json={"token": token, "password": "a brand new pass"})
    assert done.status_code == 200
    assert fresh.get("/api/notes").status_code == 200
    # Other sessions are logged out, the old password stops working, the link works once.
    assert other.get("/api/notes").status_code == 401
    assert kit.client.get("/api/notes").status_code == 401
    assert kit.login(kit.browser()).status_code == 401
    assert kit.login(kit.browser(), password="a brand new pass").status_code == 200
    again = kit.browser().post(
        "/api/auth/reset", json={"token": token, "password": "another new pass"}
    )
    assert again.status_code == 400
    assert "invalid or has expired" in again.json()["detail"]
    # Opening the link proved the mailbox.
    assert fresh.get("/api/auth/me").json()["email_verified"] is True


def test_reset_link_expires_after_30_minutes(kit: AuthKit) -> None:
    kit.signup()
    kit.client.post("/api/auth/forgot", json={"email": EMAIL})
    token = kit.mailer.token("reset-password")
    kit.clock.advance(minutes=31)
    late = kit.browser().post("/api/auth/reset", json={"token": token, "password": "new password!"})
    assert late.status_code == 400
    assert kit.login(kit.browser()).status_code == 200


def test_forgot_answers_the_same_for_unknown_emails(kit: AuthKit) -> None:
    kit.signup()
    sent_before = len(kit.mailer.sent)
    unknown = kit.client.post("/api/auth/forgot", json={"email": "nobody@example.test"})
    known = kit.client.post("/api/auth/forgot", json={"email": EMAIL})
    assert unknown.status_code == known.status_code == 200
    assert unknown.json() == known.json()
    assert len(kit.mailer.sent) == sent_before + 1


def test_change_password_logs_out_other_sessions(kit: AuthKit) -> None:
    kit.signup()
    other = kit.browser()
    kit.login(other)
    wrong = kit.client.post(
        "/api/auth/password", json={"current": "not it at all", "new": "a brand new pass"}
    )
    assert wrong.status_code == 400
    assert other.get("/api/notes").status_code == 200
    short = kit.client.post("/api/auth/password", json={"current": PASSWORD, "new": "short"})
    assert short.status_code == 400
    changed = kit.client.post(
        "/api/auth/password", json={"current": PASSWORD, "new": "a brand new pass"}
    )
    assert changed.status_code == 204
    assert kit.client.get("/api/notes").status_code == 200
    assert other.get("/api/notes").status_code == 401
    assert kit.login(kit.browser()).status_code == 401
    assert kit.login(kit.browser(), password="a brand new pass").status_code == 200


def test_change_password_needs_a_session(kit: AuthKit) -> None:
    response = kit.client.post("/api/auth/password", json={"current": "x", "new": "y" * 12})
    assert response.status_code == 401


# Scenario: Too many attempts
def test_eleventh_failed_login_in_a_minute_is_refused(kit: AuthKit) -> None:
    kit.signup()
    for attempt in range(10):
        response = kit.login(kit.browser(), email=f"guess{attempt}@example.test")
        assert response.status_code == 401
    eleventh = kit.login(kit.browser(), email="guess10@example.test")
    assert eleventh.status_code == 429
    wait = int(eleventh.headers["retry-after"])
    assert 1 <= wait <= 60
    assert eleventh.json()["detail"] == f"Too many attempts. Try again in {wait} seconds."
    # Even the right password waits: the address is limited, not just the email.
    assert kit.login(kit.browser()).status_code == 429


def test_attempts_per_email_are_limited_too(kit: AuthKit) -> None:
    from fastapi.testclient import TestClient

    from app.auth.ratelimit import AuthLimiter

    kit.signup()
    now = [0.0]
    kit.app.state.auth_limiter = AuthLimiter(10, clock=lambda: now[0])

    def from_address(number: int) -> TestClient:
        return TestClient(kit.app, headers={"X-LearningHub": "1"}, client=(f"10.0.0.{number}", 1))

    for number in range(10):
        assert kit.login(from_address(number), password="wrong password").status_code == 401
    assert kit.login(from_address(50), password="wrong password").status_code == 429
    assert kit.login(from_address(51), email="other@example.test").status_code == 401
    now[0] = 61.0
    assert kit.login(from_address(52)).status_code == 200


def test_no_password_or_token_in_answers_or_logs(
    kit: AuthKit, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    answers = [kit.signup().text, kit.client.get("/api/auth/me").text]
    session_token = kit.client.cookies.get("lh_session")
    answers.append(kit.client.post("/api/auth/forgot", json={"email": EMAIL}).text)
    reset_token = kit.mailer.token("reset-password")
    answers.append(
        kit.client.post(
            "/api/auth/reset", json={"token": reset_token, "password": "a brand new pass"}
        ).text
    )
    answers.append(kit.client.get("/api/auth/sessions").text)
    answers.append(kit.login(kit.browser(), password="wrong password").text)
    secrets = [PASSWORD, "a brand new pass", reset_token, session_token]
    for secret in secrets:
        assert secret
        assert secret not in caplog.text
        for answer in answers:
            assert secret not in answer
    assert "token_hash" not in answers[-2] and "password_hash" not in "".join(answers)
