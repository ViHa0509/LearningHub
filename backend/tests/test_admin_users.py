"""Spec: accounts - Invite only (the invitation routes) and Users page."""

from typing import Any

import pytest
from sqlalchemy import create_engine, text

from tests.auth_fakes import EMAIL, AuthKit
from tests.conftest import TEST_DATABASE_URL

ANA = "ana@example.test"
ANA_PASSWORD = "ana's long password"
HTML = "text/html"
EXPIRED = "This invitation has expired or was already used."


def scalar(sql: str) -> Any:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        value = connection.execute(text(sql)).scalar()
    engine.dispose()
    return value


def invite(kit: AuthKit, email: str = ANA) -> Any:
    return kit.client.post("/api/admin/invitations", json={"email": email})


def accept(kit: AuthKit, client: Any, token: str, password: str = ANA_PASSWORD) -> Any:
    return client.post(
        "/api/auth/invitation/accept",
        json={"token": token, "password": password, "display_name": "Ana"},
    )


def admin_kit(kit: AuthKit) -> AuthKit:
    assert kit.signup().status_code == 201
    return kit


def member(kit: AuthKit, email: str = ANA) -> Any:
    """A browser signed in as a new member (invited by the admin, who is ``kit.client``)."""
    assert invite(kit, email).status_code == 201
    browser = kit.browser()
    assert accept(kit, browser, kit.mailer.token("invitation")).status_code == 201
    return browser


def import_file(client: Any, name: str, body: str) -> dict[str, Any]:
    html = f"<title>{name}</title><p>{body}</p>".encode()
    response = client.post("/api/notes/import", files=[("files", (f"{name}.html", html, HTML))])
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()["results"][0]
    return result


def user_id(email: str) -> str:
    return str(scalar(f"SELECT id FROM users WHERE email = '{email}'"))


# --- inviting ------------------------------------------------------------------------------------


# Scenario: Invited by email
def test_invite_mails_a_link_that_creates_a_signed_in_member_once(kit: AuthKit) -> None:
    admin_kit(kit)
    created = invite(kit, "  Ana@Example.test ")
    assert created.status_code == 201
    body = created.json()
    # The test mailer is an outbox (no SMTP), so the link is answered to the admin too.
    assert set(body) == {"id", "email", "created_at", "expires_at", "invite_url"}
    assert body["email"] == ANA

    [mail] = [m for m in kit.mailer.sent if m.purpose == "invitation"]
    assert mail.to == ANA
    token = kit.mailer.token("invitation")
    assert f"http://localhost:5173/#/auth/invite?token={token}" in mail.body
    assert body["invite_url"] == f"http://localhost:5173/#/auth/invite?token={token}"

    info = kit.client.get("/api/auth/invitation", params={"token": token})
    assert info.status_code == 200
    assert info.json()["email"] == ANA and "expires_at" in info.json()

    browser = kit.browser()
    accepted = accept(kit, browser, token)
    assert accepted.status_code == 201
    me = accepted.json()
    assert (me["email"], me["role"], me["email_verified"], me["display_name"]) == (
        ANA,
        "member",
        True,
        "Ana",
    )
    assert "lh_session=" in accepted.headers["set-cookie"]
    assert browser.get("/api/auth/me").json()["role"] == "member"
    assert kit.client.get("/api/auth/me").json()["role"] == "admin"
    # Single use.
    again = accept(kit, kit.browser(), token)
    assert (again.status_code, again.json()["detail"]) == (404, EXPIRED)
    assert kit.client.get("/api/auth/invitation", params={"token": token}).status_code == 404
    assert kit.login(kit.browser(), email=ANA, password=ANA_PASSWORD).status_code == 200


def test_the_token_is_not_stored_or_listed(kit: AuthKit) -> None:
    admin_kit(kit)
    first = invite(kit)
    assert first.status_code == 201, first.text
    token = kit.mailer.token("invitation")
    assert token not in str(scalar("SELECT token_hash FROM invitations"))
    assert token not in kit.client.get("/api/admin/invitations").text


def test_invitation_needs_a_valid_email_and_the_app_header(kit: AuthKit) -> None:
    admin_kit(kit)
    assert invite(kit, "not-an-email").status_code == 400
    bare = kit.client.post(
        "/api/admin/invitations", json={"email": ANA}, headers={"X-LearningHub": ""}
    )
    assert bare.status_code in (400, 403)
    assert scalar("SELECT count(*) FROM invitations") == 0


def test_a_short_password_does_not_use_up_the_invitation(kit: AuthKit) -> None:
    admin_kit(kit)
    invite(kit)
    token = kit.mailer.token("invitation")
    assert accept(kit, kit.browser(), token, password="short").status_code == 400
    assert accept(kit, kit.browser(), token).status_code == 201


def test_inviting_an_email_that_has_an_account_is_409(kit: AuthKit) -> None:
    admin_kit(kit)
    own = invite(kit, EMAIL.upper())
    assert (own.status_code, own.json()["detail"]) == (409, "That email already has an account")
    member(kit)
    again = invite(kit)
    assert (again.status_code, again.json()["detail"]) == (409, "That email already has an account")


def test_a_second_invitation_replaces_the_first(kit: AuthKit) -> None:
    admin_kit(kit)
    invite(kit)
    first = kit.mailer.token("invitation")
    invite(kit)
    second = kit.mailer.token("invitation")
    assert first != second
    assert len(kit.client.get("/api/admin/invitations").json()) == 1
    assert accept(kit, kit.browser(), first).status_code == 404
    assert accept(kit, kit.browser(), second).status_code == 201


def test_list_shows_only_pending_invitations_and_revoke_ends_one(kit: AuthKit) -> None:
    admin_kit(kit)
    invite(kit, "a@example.test")
    invite(kit, "b@example.test")
    invite(kit, "c@example.test")
    listed = kit.client.get("/api/admin/invitations").json()
    assert sorted(i["email"] for i in listed) == [
        "a@example.test",
        "b@example.test",
        "c@example.test",
    ]
    assert all(set(i) == {"id", "email", "created_at", "expires_at"} for i in listed)

    b = next(i for i in listed if i["email"] == "b@example.test")
    assert kit.client.delete(f"/api/admin/invitations/{b['id']}").status_code == 204
    assert kit.client.delete(f"/api/admin/invitations/{b['id']}").status_code == 404
    left = sorted(i["email"] for i in kit.client.get("/api/admin/invitations").json())
    assert left == ["a@example.test", "c@example.test"]

    # An accepted one is no longer pending.
    accept(kit, kit.browser(), kit.mailer.token("invitation"))  # c
    left = [i["email"] for i in kit.client.get("/api/admin/invitations").json()]
    assert left == ["a@example.test"]


# Scenario: Expired or revoked invitation
def test_a_revoked_invitation_cannot_be_opened_or_accepted(kit: AuthKit) -> None:
    admin_kit(kit)
    created = invite(kit).json()
    token = kit.mailer.token("invitation")
    kit.client.delete(f"/api/admin/invitations/{created['id']}")
    info = kit.client.get("/api/auth/invitation", params={"token": token})
    assert (info.status_code, info.json()["detail"]) == (404, EXPIRED)
    assert accept(kit, kit.browser(), token).status_code == 404
    assert scalar("SELECT count(*) FROM users") == 1


def test_an_invitation_older_than_seven_days_is_refused(kit: AuthKit) -> None:
    admin_kit(kit)
    invite(kit)
    token = kit.mailer.token("invitation")
    kit.clock.advance(days=6, hours=23)
    assert kit.client.get("/api/auth/invitation", params={"token": token}).status_code == 200
    kit.clock.advance(hours=2)
    info = kit.client.get("/api/auth/invitation", params={"token": token})
    assert (info.status_code, info.json()["detail"]) == (404, EXPIRED)
    assert accept(kit, kit.browser(), token).status_code == 404
    assert kit.client.get("/api/admin/invitations").json() == []
    assert scalar("SELECT count(*) FROM users") == 1


def test_an_unknown_token_is_404(kit: AuthKit) -> None:
    admin_kit(kit)
    assert kit.client.get("/api/auth/invitation", params={"token": "nope"}).status_code == 404
    assert kit.client.get("/api/auth/invitation").status_code == 404
    assert accept(kit, kit.browser(), "nope").status_code == 404


def test_accepting_when_the_email_got_an_account_meanwhile_is_409(kit: AuthKit) -> None:
    admin_kit(kit)
    invite(kit)
    token = kit.mailer.token("invitation")
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, role, preferences) "
                f"VALUES (gen_random_uuid(), '{ANA}', 'member', '{{}}')"
            )
        )
    engine.dispose()
    refused = accept(kit, kit.browser(), token)
    assert refused.status_code == 409
    assert scalar("SELECT count(*) FROM users") == 2


# --- admin only ----------------------------------------------------------------------------------


# Scenario: Members cannot manage users
def test_members_get_403_on_every_admin_route(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    admin_id = user_id(EMAIL)
    fake = "00000000-0000-0000-0000-000000000001"
    calls = [
        ("POST", "/api/admin/invitations", {"email": "x@example.test"}),
        ("GET", "/api/admin/invitations", None),
        ("DELETE", f"/api/admin/invitations/{fake}", None),
        ("GET", "/api/admin/users", None),
        ("PUT", f"/api/admin/users/{admin_id}/disabled", {"disabled": True}),
        ("DELETE", f"/api/admin/users/{admin_id}", {"confirm_email": EMAIL}),
    ]
    for method, path, body in calls:
        response = browser.request(method, path, json=body)
        assert response.status_code == 403, (method, path, response.status_code)
    assert scalar("SELECT count(*) FROM users") == 2
    assert scalar("SELECT disabled_at IS NULL FROM users WHERE role = 'admin'") is True


def test_signed_out_admin_routes_are_401(kit: AuthKit) -> None:
    admin_kit(kit)
    other = kit.browser()
    assert other.get("/api/admin/users").status_code == 401
    assert other.post("/api/admin/invitations", json={"email": ANA}).status_code == 401


# --- users ---------------------------------------------------------------------------------------


def test_users_lists_accounts_without_the_placeholder(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    browser.get("/api/notes")
    users = kit.client.get("/api/admin/users").json()
    assert [u["email"] for u in users] == [EMAIL, ANA]
    assert all(
        set(u) == {"id", "email", "display_name", "role", "created_at", "last_seen_at", "disabled"}
        for u in users
    )
    assert [u["role"] for u in users] == ["admin", "member"]
    assert users[1]["display_name"] == "Ana"
    assert users[0]["last_seen_at"] is not None and users[1]["last_seen_at"] is not None
    assert [u["disabled"] for u in users] == [False, False]


def test_last_seen_is_null_without_a_session(kit: AuthKit) -> None:
    admin_kit(kit)
    member(kit)
    kit.client.put(f"/api/admin/users/{user_id(ANA)}/disabled", json={"disabled": True})
    ana = next(u for u in kit.client.get("/api/admin/users").json() if u["email"] == ANA)
    assert ana["last_seen_at"] is None and ana["disabled"] is True


# Scenario: Disable a member
def test_disabling_ends_the_members_sessions_and_blocks_sign_in(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    other = kit.browser()
    assert kit.login(other, email=ANA, password=ANA_PASSWORD).status_code == 200
    assert other.get("/api/notes").status_code == 200

    response = kit.client.put(f"/api/admin/users/{user_id(ANA)}/disabled", json={"disabled": True})
    assert response.status_code == 200
    assert response.json()["disabled"] is True and response.json()["email"] == ANA
    assert scalar(f"SELECT count(*) FROM sessions WHERE user_id = '{user_id(ANA)}'") == 0

    assert other.get("/api/notes").status_code == 401
    assert browser.get("/api/notes").status_code == 401
    refused = kit.login(kit.browser(), email=ANA, password=ANA_PASSWORD)
    assert (refused.status_code, refused.json()["detail"]) == (403, "This account is disabled")

    enabled = kit.client.put(f"/api/admin/users/{user_id(ANA)}/disabled", json={"disabled": False})
    assert enabled.json()["disabled"] is False
    assert kit.login(kit.browser(), email=ANA, password=ANA_PASSWORD).status_code == 200


def test_the_admin_cannot_disable_or_delete_themself(kit: AuthKit) -> None:
    admin_kit(kit)
    me = user_id(EMAIL)
    disabled = kit.client.put(f"/api/admin/users/{me}/disabled", json={"disabled": True})
    assert (disabled.status_code, disabled.json()["detail"]) == (
        422,
        "You cannot disable your own account",
    )
    deleted = kit.client.request("DELETE", f"/api/admin/users/{me}", json={"confirm_email": EMAIL})
    assert deleted.status_code == 422
    assert kit.client.get("/api/auth/me").status_code == 200
    assert scalar("SELECT count(*) FROM users") == 1


def test_unknown_user_is_404(kit: AuthKit) -> None:
    admin_kit(kit)
    fake = "00000000-0000-0000-0000-000000000001"
    assert (
        kit.client.put(f"/api/admin/users/{fake}/disabled", json={"disabled": True}).status_code
        == 404
    )
    gone = kit.client.request("DELETE", f"/api/admin/users/{fake}", json={"confirm_email": ANA})
    assert gone.status_code == 404


# Scenario: Delete a member
def test_delete_needs_the_exact_email(kit: AuthKit) -> None:
    admin_kit(kit)
    member(kit)
    ana = user_id(ANA)
    for wrong in ("", "other@example.test", "ana"):
        refused = kit.client.request(
            "DELETE", f"/api/admin/users/{ana}", json={"confirm_email": wrong}
        )
        assert refused.status_code == 422
    assert scalar("SELECT count(*) FROM users") == 2


def test_delete_removes_the_members_data_and_keeps_the_admins(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    import_file(kit.client, "admin-note", "admin only text")
    assert (
        kit.client.put("/api/lessons/backend/caching", json={"body": "Admin lesson"}).status_code
        == 200
    )
    kit.client.post(
        "/api/ai-providers",
        json={
            "name": "admin-p",
            "provider_type": "anthropic",
            "model_name": "claude-sonnet-5-5",
            "api_key": "sk-test-admin1234",
        },
    )

    import_file(browser, "member-note", "member only text")
    assert (
        browser.put("/api/lessons/backend/caching", json={"body": "Member lesson"}).status_code
        == 200
    )
    made = browser.post(
        "/api/ai-providers",
        json={
            "name": "member-p",
            "provider_type": "anthropic",
            "model_name": "claude-sonnet-5-5",
            "api_key": "sk-test-member1234",
        },
    )
    assert made.status_code == 201, made.text
    ana = user_id(ANA)
    member_key = scalar(f"SELECT storage_key FROM notes WHERE user_id = '{ana}'")
    admin_key = scalar(f"SELECT storage_key FROM notes WHERE user_id = '{user_id(EMAIL)}'")
    store = kit.app.state.store
    assert store.get(member_key) and store.get(admin_key)

    response = kit.client.request(
        "DELETE", f"/api/admin/users/{ana}", json={"confirm_email": "Ana@Example.test"}
    )
    assert response.status_code == 204

    assert scalar("SELECT count(*) FROM users") == 1
    for table in ("notes", "lessons", "ai_providers"):
        assert scalar(f"SELECT count(*) FROM {table} WHERE user_id = '{ana}'") == 0
        assert scalar(f"SELECT count(*) FROM {table}") == 1
    assert scalar(f"SELECT count(*) FROM sessions WHERE user_id = '{ana}'") == 0
    assert browser.get("/api/notes").status_code == 401
    with pytest.raises(FileNotFoundError):
        store.get(member_key)
    assert store.get(admin_key)
    assert [n["title"] for n in kit.client.get("/api/notes").json()] == ["admin-note"]
    assert kit.client.get("/api/lessons/backend/caching").json()["body"] == "Admin lesson"


def test_delete_keeps_a_file_another_user_still_has(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    first = import_file(kit.client, "shared", "same bytes")
    second = import_file(browser, "shared", "same bytes")
    assert first["outcome"] == "created" and second["outcome"] == "created"
    assert scalar("SELECT count(DISTINCT storage_key) FROM notes") == 1
    key = scalar("SELECT DISTINCT storage_key FROM notes")

    deleted = kit.client.request(
        "DELETE", f"/api/admin/users/{user_id(ANA)}", json={"confirm_email": ANA}
    )
    assert deleted.status_code == 204
    assert kit.app.state.store.get(key)
    note_id = first["note"]["id"]
    assert kit.client.get(f"/api/notes/{note_id}").status_code == 200


def test_deleting_a_member_leaves_an_invitation_they_never_sent_alone(kit: AuthKit) -> None:
    admin_kit(kit)
    member(kit)
    invite(kit, "next@example.test")
    kit.client.request("DELETE", f"/api/admin/users/{user_id(ANA)}", json={"confirm_email": ANA})
    assert len(kit.client.get("/api/admin/invitations").json()) == 1


# Scenario: Copy an invite link (server side) - no SMTP gives the link, SMTP does not
def test_invite_url_is_answered_only_without_smtp(kit: AuthKit) -> None:
    admin_kit(kit)
    without = invite(kit, "one@example.test").json()
    assert without["invite_url"].startswith("http://localhost:5173/#/auth/invite?token=")
    listed = kit.client.get("/api/admin/invitations").json()
    assert all("invite_url" not in item for item in listed)

    kit.mailer.mode = "smtp"  # a configured mail server: nothing real is sent, the mailer is fake
    with_smtp = invite(kit, "two@example.test")
    assert with_smtp.status_code == 201
    assert "invite_url" not in with_smtp.json()
    assert kit.mailer.token("invitation") not in with_smtp.text
