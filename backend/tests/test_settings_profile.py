"""Spec: settings - avatar, email change, link and unlink sign-in methods (change settings-tabs).

The OAuth provider is a local fake server; GitHub and Google are never called."""

import urllib.parse
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from tests.auth_fakes import PASSWORD, AuthKit, H, ProviderState, auth_kit, fake_provider
from tests.auth_fakes import provider_settings as provider_values
from tests.test_auth_email import db_scalar
from tests.test_auth_oauth import APP, approve, start

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 40
ADMIN = "me@example.test"
MEMBER = "member@example.test"
SECURITY = f"{APP}/#/profile/security"


def upload(client: Any, data: bytes, name: str = "a.png") -> Any:
    return client.post("/api/auth/avatar", files={"file": (name, data, "image/png")})


@pytest.fixture
def two(kit: AuthKit) -> tuple[Any, Any]:
    """(admin client, member client), both signed in."""
    assert kit.signup().status_code == 201
    member = kit.browser()
    assert kit.signup(member, email=MEMBER).status_code == 201
    return kit.client, member


def stored(kit: AuthKit, key: str) -> bool:
    try:
        kit.app.state.store.get(key)
    except FileNotFoundError:
        return False
    return True


# --- avatar


@pytest.mark.parametrize(
    ("data", "media"), [(PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp")]
)
def test_avatar_is_accepted_and_served_as_an_image(
    kit: AuthKit, data: bytes, media: str, two: tuple[Any, Any]
) -> None:
    admin, _ = two
    me = upload(admin, data)
    assert me.status_code == 200
    url = me.json()["avatar_url"]
    assert url.startswith(f"/api/auth/avatar/{me.json()['id']}?v=")
    assert admin.get("/api/auth/me").json()["avatar_url"] == url
    served = admin.get(url)
    assert served.status_code == 200 and served.content == data
    assert served.headers["content-type"] == media
    assert served.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in served.headers["content-security-policy"]
    assert served.headers["cache-control"].startswith("private")


def test_avatar_over_one_megabyte_is_refused(kit: AuthKit, two: tuple[Any, Any]) -> None:
    admin, _ = two
    assert upload(admin, PNG + b"\x00" * (1024 * 1024 - len(PNG))).status_code == 200
    before = admin.get("/api/auth/me").json()["avatar_url"]
    assert upload(admin, PNG + b"\x00" * (1024 * 1024 + 1 - len(PNG))).status_code == 413
    assert admin.get("/api/auth/me").json()["avatar_url"] == before


@pytest.mark.parametrize(
    "data",
    [b"%PDF-1.4 hello", b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"<html><script>1</script>"],
)
def test_other_content_named_png_is_refused(
    kit: AuthKit, data: bytes, two: tuple[Any, Any]
) -> None:
    admin, _ = two
    upload(admin, PNG).raise_for_status()
    before = admin.get("/api/auth/me").json()["avatar_url"]
    assert upload(admin, data, "evil.png").status_code == 415
    assert admin.get("/api/auth/me").json()["avatar_url"] == before


def test_another_members_avatar_is_404_and_the_admin_may_read_it(
    kit: AuthKit, two: tuple[Any, Any]
) -> None:
    admin, member = two
    member_url = upload(member, PNG).json()["avatar_url"]
    admin_url = upload(admin, JPEG).json()["avatar_url"]
    assert admin.get(member_url).status_code == 200
    assert member.get(admin_url).status_code == 404
    assert kit.browser().get(member_url).status_code == 401
    # A user without a picture: 404 for the admin too.
    third = kit.browser()
    third_id = kit.signup(third, email="third@example.test").json()["id"]
    assert admin.get(f"/api/auth/avatar/{third_id}").status_code == 404


def test_remove_returns_to_null_and_deletes_the_unused_file(
    kit: AuthKit, two: tuple[Any, Any]
) -> None:
    admin, _ = two
    upload(admin, PNG).raise_for_status()
    key = db_scalar("SELECT avatar_key FROM users WHERE email = 'me@example.test'")
    assert stored(kit, key)
    me = admin.delete("/api/auth/avatar")
    assert me.status_code == 200 and me.json()["avatar_url"] is None
    assert not stored(kit, key)
    assert admin.get(f"/api/auth/avatar/{me.json()['id']}").status_code == 404


def test_remove_keeps_a_file_another_user_has_too(kit: AuthKit, two: tuple[Any, Any]) -> None:
    admin, member = two
    upload(admin, PNG).raise_for_status()
    upload(member, PNG).raise_for_status()
    key = db_scalar("SELECT avatar_key FROM users WHERE email = 'me@example.test'")
    member.delete("/api/auth/avatar").raise_for_status()
    assert stored(kit, key)
    assert admin.get(admin.get("/api/auth/me").json()["avatar_url"]).content == PNG
    # Replacing a picture deletes the old unused file only.
    upload(admin, JPEG).raise_for_status()
    assert not stored(kit, key)


# --- email change


def test_email_change_waits_for_the_link(kit: AuthKit, two: tuple[Any, Any]) -> None:
    admin, _ = two
    kit.mailer.sent.clear()
    response = admin.post("/api/auth/email", json={"email": " New@Example.test "})
    assert response.status_code == 200
    by_purpose = {m.purpose: m for m in kit.mailer.sent}
    assert by_purpose["change-email"].to == "new@example.test"
    assert by_purpose["change-email-notice"].to == ADMIN
    assert "new@example.test" not in by_purpose["change-email-notice"].body
    assert admin.get("/api/auth/me").json()["email"] == ADMIN
    token = kit.mailer.token("change-email")
    me = admin.post("/api/auth/email/confirm", json={"token": token})
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.test" and me.json()["email_verified"] is True
    assert admin.get("/api/auth/me").json()["email"] == "new@example.test"
    # Single use.
    assert admin.post("/api/auth/email/confirm", json={"token": token}).status_code == 400


def test_email_change_link_expires_after_24_hours(kit: AuthKit, two: tuple[Any, Any]) -> None:
    admin, _ = two
    admin.post("/api/auth/email", json={"email": "new@example.test"}).raise_for_status()
    token = kit.mailer.token("change-email")
    kit.clock.advance(hours=25)
    assert admin.post("/api/auth/email/confirm", json={"token": token}).status_code == 400
    assert db_scalar("SELECT email FROM users WHERE role = 'admin'") == ADMIN


def test_taken_address_answers_the_same_and_is_refused_at_confirm(
    kit: AuthKit, two: tuple[Any, Any]
) -> None:
    admin, _ = two
    free = admin.post("/api/auth/email", json={"email": "free@example.test"})
    taken = admin.post("/api/auth/email", json={"email": MEMBER})
    assert taken.status_code == free.status_code == 200
    assert taken.json() == free.json()
    confirm = admin.post(
        "/api/auth/email/confirm", json={"token": kit.mailer.token("change-email")}
    )
    assert confirm.status_code == 409
    assert admin.get("/api/auth/me").json()["email"] == ADMIN


def test_same_email_is_refused(kit: AuthKit, two: tuple[Any, Any]) -> None:
    admin, _ = two
    assert admin.post("/api/auth/email", json={"email": ADMIN}).status_code == 422


def test_confirming_ends_other_sessions_and_keeps_this_one(
    kit: AuthKit, two: tuple[Any, Any]
) -> None:
    admin, _ = two
    other = kit.browser()
    assert kit.login(other).status_code == 200
    admin.post("/api/auth/email", json={"email": "new@example.test"}).raise_for_status()
    admin.post(
        "/api/auth/email/confirm", json={"token": kit.mailer.token("change-email")}
    ).raise_for_status()
    assert admin.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401


# --- link and unlink


@pytest.fixture
def provider() -> Iterator[tuple[str, ProviderState]]:
    with fake_provider() as running:
        yield running


@pytest.fixture
def okit(
    settings_factory: Callable[..., Settings], provider: tuple[str, ProviderState]
) -> Iterator[AuthKit]:
    with auth_kit(settings_factory(**provider_values(provider[0]))) as made:
        yield made


def _link(client: Any, name: str) -> dict[str, str]:
    response = client.get(f"/api/auth/oauth/{name}/link", follow_redirects=False)
    assert response.status_code == 302
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(response.headers["location"]).query))
    return query


def linked(client: Any) -> list[str]:
    return list(client.get("/api/auth/me").json()["linked"])


def test_link_needs_a_session(okit: AuthKit) -> None:
    anonymous = okit.browser()
    assert anonymous.get("/api/auth/oauth/github/link", follow_redirects=False).status_code == 401


def test_link_adds_the_identity(okit: AuthKit, provider: tuple[str, ProviderState]) -> None:
    _, state = provider
    okit.signup()
    response = approve(okit.client, state, "github", _link(okit.client, "github"))
    assert response.status_code == 302
    assert response.headers["location"] == f"{SECURITY}?linked=github"
    assert linked(okit.client) == ["github"]
    me = okit.client.get("/api/auth/me").json()
    assert me["email"] == ADMIN and me["has_password"] is True


def test_link_callback_of_another_session_is_refused(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    okit.signup()
    query = _link(okit.client, "github")
    pending = okit.client.cookies.get("lh_oauth")
    # Another signed-in user finishes the flow with the first user's pending cookie.
    member = okit.browser()
    okit.signup(member, email=MEMBER)
    member.cookies.set("lh_oauth", pending, path="/api/auth/oauth")
    response = approve(member, state, "github", query)
    assert response.headers["location"] == f"{SECURITY}?error=state_mismatch"
    assert linked(member) == [] and linked(okit.client) == []
    assert state.token_requests == []
    # No session at all: refused too.
    query = _link(okit.client, "github")
    anonymous = okit.browser()
    anonymous.cookies.set("lh_oauth", okit.client.cookies.get("lh_oauth"), path="/api/auth/oauth")
    response = approve(anonymous, state, "github", query)
    assert response.headers["location"] == f"{SECURITY}?error=state_mismatch"
    assert "lh_session" not in response.headers.get("set-cookie", "")


def test_identity_of_another_account_is_refused(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    okit.signup()
    other = okit.browser()
    approve(other, state, "github", start(other, "github"))
    assert linked(other) == ["github"]
    response = approve(okit.client, state, "github", _link(okit.client, "github"))
    assert response.headers["location"] == f"{SECURITY}?error=identity_taken"
    assert linked(okit.client) == [] and linked(other) == ["github"]


def test_a_second_identity_of_a_provider_is_refused(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    okit.signup()
    approve(okit.client, state, "github", _link(okit.client, "github"))
    state.github_user = {"id": 9999, "login": "other", "name": "Other"}
    response = approve(okit.client, state, "github", _link(okit.client, "github"))
    assert response.headers["location"] == f"{SECURITY}?error=already_linked"
    assert db_scalar("SELECT count(*) FROM oauth_accounts") == 1


def test_sign_in_through_start_still_works(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    response = approve(okit.client, state, "github", start(okit.client, "github", "#/notes"))
    assert response.headers["location"] == f"{APP}/#/notes"
    assert okit.client.get("/api/auth/me").status_code == 200


def test_unlink(okit: AuthKit, provider: tuple[str, ProviderState]) -> None:
    _, state = provider
    okit.signup()
    approve(okit.client, state, "github", _link(okit.client, "github"))
    assert okit.client.delete("/api/auth/identities/google").status_code == 404
    me = okit.client.delete("/api/auth/identities/github")
    assert me.status_code == 200 and me.json()["linked"] == []


def test_the_last_sign_in_method_cannot_be_unlinked(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    approve(okit.client, state, "github", start(okit.client, "github"))
    assert okit.client.get("/api/auth/me").json()["has_password"] is False
    assert okit.client.delete("/api/auth/identities/github").status_code == 422
    assert linked(okit.client) == ["github"]


# --- the app header


def test_mutating_calls_need_the_app_header(kit: AuthKit, two: tuple[Any, Any]) -> None:
    admin, _ = two
    bare = TestClient(kit.app)
    bare.cookies.update(admin.cookies)
    assert H["X-LearningHub"] == "1"
    calls = [
        ("POST", "/api/auth/avatar", {"files": {"file": ("a.png", PNG, "image/png")}}),
        ("DELETE", "/api/auth/avatar", {}),
        ("POST", "/api/auth/email", {"json": {"email": "x@example.test"}}),
        ("POST", "/api/auth/email/confirm", {"json": {"token": "x" * 20}}),
        ("DELETE", "/api/auth/identities/github", {}),
    ]
    for method, url, kwargs in calls:
        assert bare.request(method, url, **kwargs).status_code == 403, url
    assert PASSWORD
