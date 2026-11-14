"""Spec: accounts - Admin and members; Invite only (sign-up and GitHub/Google rules);
Admin-only features (the admin check). The invitation routes are tested in test_admin_users.py."""

import urllib.parse
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text

from app.auth.current import ADMIN_ONLY, require_admin
from app.auth.invitations import accept, issue
from app.auth.passwords import hash_password
from app.config import Settings
from app.db import User
from tests.auth_fakes import EMAIL, PASSWORD, AuthKit, ProviderState, auth_kit, fake_provider
from tests.auth_fakes import provider_settings as provider_values
from tests.conftest import TEST_DATABASE_URL

APP = "http://localhost:5173"
EMAIL_TAKEN = "An account with this email already exists"
MEMBER_EMAIL = "ana@example.test"


def rows(sql: str) -> list[Any]:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        found = list(connection.execute(text(sql)))
    engine.dispose()
    return found


def scalar(sql: str) -> Any:
    return rows(sql)[0][0]


def run(sql: str) -> None:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text(sql))
    engine.dispose()


def invite_member(kit: AuthKit, email: str = MEMBER_EMAIL, password: str | None = PASSWORD) -> str:
    """An invitation for ``email`` accepted straight away; returns the member's id."""
    with kit.app.state.session_factory() as db:
        invitation, _token = issue(db, email, None, kit.clock())
        member = accept(
            db,
            invitation,
            kit.clock(),
            password_hash=hash_password(password) if password else None,
        )
        db.commit()
        return str(member.id)


# --- roles and sign-up ---------------------------------------------------------------------------


# Scenario: First visit; Sign up with a password (open-signup)
def test_first_signup_creates_the_admin_and_the_next_one_a_member(kit: AuthKit) -> None:
    assert kit.client.get("/api/auth/status").json()["has_owner"] is False
    assert kit.signup().status_code == 201
    assert rows("SELECT role, placeholder FROM users")[0] == ("admin", False)
    assert kit.client.get("/api/auth/status").json()["has_owner"] is True
    kit.client.post(
        "/api/notes/import",
        files=[("files", ("a.html", b"<title>Admin note</title>", "text/html"))],
    )
    stranger = kit.browser()
    created = kit.signup(stranger, email="other@example.test")
    assert created.status_code == 201, created.text
    assert created.json()["role"] == "member"
    assert created.json()["email_verified"] is False
    assert "lh_session" in created.cookies
    assert stranger.get("/api/auth/me").json()["email"] == "other@example.test"
    # Separate data: the admin's note is not the member's.
    assert stranger.get("/api/notes").json() == []
    assert kit.mailer.token("verify-email")
    assert rows("SELECT role FROM users WHERE email = 'other@example.test'") == [("member",)]
    assert scalar("SELECT count(*) FROM users") == 2


# Scenario: Email already used
def test_signup_with_a_used_email_is_refused(kit: AuthKit) -> None:
    kit.signup()
    invite_member(kit)
    for email in (MEMBER_EMAIL, EMAIL, EMAIL.upper()):
        refused = kit.signup(kit.browser(), email=email)
        assert (refused.status_code, refused.json()["detail"]) == (409, EMAIL_TAKEN), email
        assert "lh_session" not in refused.cookies
    assert scalar("SELECT count(*) FROM users") == 2


def test_signup_after_the_admin_keeps_the_password_rules(kit: AuthKit) -> None:
    kit.signup()
    weak = kit.signup(kit.browser(), email="weak@example.test", password="short")
    assert weak.status_code == 400
    assert scalar("SELECT count(*) FROM users") == 1


# Scenario: Existing data kept (no login yet, then the first sign-up)
def test_login_off_acts_as_the_admin_and_the_first_signup_takes_over_its_data(
    settings_factory: Callable[..., Settings],
) -> None:
    with auth_kit(settings_factory(auth_required=False)) as kit:
        # A route that needs the current user creates the placeholder admin, once.
        assert kit.client.post("/api/data/sync-key").status_code == 200
        assert kit.client.post("/api/data/sync-key").status_code == 200
        [(placeholder_id, email, role, placeholder)] = rows(
            "SELECT id, email, role, placeholder FROM users"
        )
        assert (email, role, placeholder) == ("admin@localhost.invalid", "admin", True)
        assert scalar(f"SELECT count(*) FROM sync_keys WHERE user_id = '{placeholder_id}'") == 1
        # The placeholder does not count as an account.
        assert kit.client.get("/api/auth/status").json()["has_owner"] is False

        assert kit.signup().status_code == 201
        [(user_id, email, role, placeholder)] = rows(
            "SELECT id, email, role, placeholder FROM users"
        )
        assert user_id == placeholder_id
        assert (email, role, placeholder) == (EMAIL, "admin", False)
        assert scalar(f"SELECT count(*) FROM sync_keys WHERE user_id = '{user_id}'") == 1
        assert kit.client.get("/api/auth/status").json()["has_owner"] is True
        # A later sign-up is a member with none of that data (open-signup).
        later = kit.browser()
        created = kit.signup(later, email="x@example.test")
        assert (created.status_code, created.json()["role"]) == (201, "member")
        assert later.get("/api/notes").json() == []


def test_the_placeholder_admin_cannot_sign_in(
    settings_factory: Callable[..., Settings],
) -> None:
    with auth_kit(settings_factory(auth_required=False)) as kit:
        kit.client.post("/api/data/sync-key")
        refused = kit.login(kit.browser(), email="admin@localhost.invalid", password=PASSWORD)
        assert refused.status_code == 401


def test_require_admin_refuses_a_member() -> None:
    member = User(email=MEMBER_EMAIL, role="member", preferences={})
    with pytest.raises(HTTPException) as refused:
        require_admin(member)
    assert (refused.value.status_code, refused.value.detail) == (403, ADMIN_ONLY)
    admin = User(email=EMAIL, role="admin", preferences={})
    assert require_admin(admin) is admin


# --- disabled users ----------------------------------------------------------------------------


# Scenario: Disable a member (the sign-in side)
def test_a_disabled_user_cannot_sign_in_and_their_session_is_refused(kit: AuthKit) -> None:
    kit.signup()
    member_id = invite_member(kit)
    browser = kit.browser()
    assert kit.login(browser, email=MEMBER_EMAIL).status_code == 200
    assert browser.get("/api/notes").status_code == 200

    run(f"UPDATE users SET disabled_at = now() WHERE id = '{member_id}'")

    assert browser.get("/api/notes").status_code == 401
    assert browser.post("/api/data/sync-key").status_code == 401
    assert browser.get("/api/auth/me").status_code == 401
    refused = kit.login(kit.browser(), email=MEMBER_EMAIL)
    assert (refused.status_code, refused.json()["detail"]) == (403, "This account is disabled")
    assert "lh_session" not in refused.cookies

    run(f"UPDATE users SET disabled_at = NULL WHERE id = '{member_id}'")
    assert kit.login(kit.browser(), email=MEMBER_EMAIL).status_code == 200


def test_login_does_not_reveal_a_disabled_account_to_a_wrong_password(kit: AuthKit) -> None:
    kit.signup()
    member_id = invite_member(kit)
    run(f"UPDATE users SET disabled_at = now() WHERE id = '{member_id}'")
    wrong = kit.login(kit.browser(), email=MEMBER_EMAIL, password="not the password 1")
    unknown = kit.login(kit.browser(), email="nobody@example.test", password="not the password 1")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


# --- GitHub and Google ---------------------------------------------------------------------------


@pytest.fixture
def provider() -> Iterator[tuple[str, ProviderState]]:
    with fake_provider() as running:
        yield running


@pytest.fixture
def okit(
    settings_factory: Callable[..., Settings], provider: tuple[str, ProviderState]
) -> Iterator[AuthKit]:
    base, _ = provider
    with auth_kit(settings_factory(**provider_values(base))) as made:
        yield made


def start(client: Any, name: str) -> dict[str, str]:
    response = client.get(f"/api/auth/oauth/{name}/start", follow_redirects=False)
    assert response.status_code == 302
    return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(response.headers["location"]).query))


def approve(client: Any, state: ProviderState, name: str) -> Any:
    query = start(client, name)
    code = f"code-{len(state.challenges)}"
    state.challenges[code] = query["code_challenge"]
    return client.get(
        f"/api/auth/oauth/{name}/callback",
        params={"code": code, "state": query["state"]},
        follow_redirects=False,
    )


def error_of(response: Any) -> str | None:
    assert response.status_code == 302
    location = response.headers["location"]
    prefix = f"{APP}/#/auth/login?error="
    return location.removeprefix(prefix) if location.startswith(prefix) else None


def with_admin(okit: AuthKit) -> None:
    assert okit.signup(email="boss@example.test").status_code == 201


# Scenario: Invited, signs in with GitHub
def test_github_with_an_invited_verified_email_creates_a_member(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    with_admin(okit)
    with okit.app.state.session_factory() as db:
        issue(db, "owner@example.test", None, okit.clock())  # GitHub's verified email
        db.commit()
    browser = okit.browser()
    response = approve(browser, state, "github")
    assert error_of(response) is None
    assert "lh_session=" in response.headers["set-cookie"]
    me = browser.get("/api/auth/me").json()
    assert me["email"] == "owner@example.test" and me["linked"] == ["github"]
    assert me["email_verified"] is True
    assert rows("SELECT role FROM users WHERE email = 'owner@example.test'") == [("member",)]
    assert scalar("SELECT count(*) FROM oauth_accounts") == 1
    assert scalar("SELECT count(*) FROM invitations WHERE accepted_at IS NOT NULL") == 1
    # The invitation is used up; the linked identity still signs in.
    assert error_of(approve(okit.browser(), state, "github")) is None
    assert scalar("SELECT count(*) FROM users") == 2


# Scenario: Sign up with GitHub (open-signup)
def test_github_without_an_invitation_creates_a_verified_member(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    with_admin(okit)
    with okit.app.state.session_factory() as db:
        issue(db, "someone-else@example.test", None, okit.clock())
        db.commit()
    browser = okit.browser()
    response = approve(browser, state, "github")
    assert error_of(response) is None
    assert "lh_session" in response.headers.get("set-cookie", "")
    me = browser.get("/api/auth/me").json()
    assert (me["role"], me["email_verified"], me["linked"]) == ("member", True, ["github"])
    assert browser.get("/api/notes").json() == []
    assert scalar("SELECT count(*) FROM users") == 2
    assert scalar("SELECT count(*) FROM oauth_accounts") == 1
    # The other invitation is untouched.
    assert scalar("SELECT count(*) FROM invitations WHERE accepted_at IS NULL") == 1


# A dead invitation no longer matters: sign-up is open (open-signup).
@pytest.mark.parametrize("how", ["expired", "revoked", "used"])
def test_github_with_a_dead_invitation_still_signs_up_a_member(
    okit: AuthKit, provider: tuple[str, ProviderState], how: str
) -> None:
    _, state = provider
    with_admin(okit)
    with okit.app.state.session_factory() as db:
        invitation, _ = issue(db, "owner@example.test", None, okit.clock())
        if how == "revoked":
            invitation.revoked_at = okit.clock()
        if how == "used":
            invitation.accepted_at = okit.clock()
        db.commit()
    if how == "expired":
        okit.clock.advance(days=7, seconds=1)
    response = approve(okit.browser(), state, "github")
    assert error_of(response) is None
    assert rows("SELECT role FROM users WHERE email = 'owner@example.test'") == [("member",)]


def test_github_with_the_email_of_an_unverified_account_is_refused(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    okit.signup(email="owner@example.test")  # the admin, email not verified yet
    # Scenario: Unverified account is not taken over
    assert error_of(approve(okit.browser(), state, "github")) == "account_unverified"
    assert scalar("SELECT count(*) FROM oauth_accounts") == 0


def test_a_disabled_user_cannot_sign_in_with_github(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    approve(okit.browser(), state, "github")  # the first identity becomes the admin
    # A member who has the same linked identity is not possible; disable the admin's row.
    run("UPDATE users SET disabled_at = now()")
    sessions = scalar("SELECT count(*) FROM sessions")
    browser = okit.browser()
    response = approve(browser, state, "github")
    assert error_of(response) == "account_disabled"
    assert browser.get("/api/notes").status_code == 401
    assert scalar("SELECT count(*) FROM sessions") == sessions
