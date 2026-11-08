"""Spec: auth - Sign in with GitHub or Google; One Owner account (provider rules).

The provider is a local fake server; GitHub and Google are never called."""

import logging
import urllib.parse
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from sqlalchemy import create_engine, text

from app.config import Settings
from tests.auth_fakes import EMAIL, PASSWORD, AuthKit, ProviderState, auth_kit, fake_provider
from tests.auth_fakes import provider_settings as provider_values
from tests.conftest import TEST_DATABASE_URL

APP = "http://localhost:5173"


def count(sql: str) -> int:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        value = int(connection.execute(text(sql)).scalar() or 0)
    engine.dispose()
    return value


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


def start(client: Any, name: str, next_route: str | None = None) -> dict[str, str]:
    params = {"next": next_route} if next_route is not None else {}
    response = client.get(f"/api/auth/oauth/{name}/start", params=params, follow_redirects=False)
    assert response.status_code == 302
    location = response.headers["location"]
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(location).query))
    query["_location"] = location
    query["_cookie"] = response.headers.get("set-cookie", "")
    return query


def approve(client: Any, state: ProviderState, name: str, query: dict[str, str]) -> Any:
    """The provider approves: it redirects back with a code bound to the PKCE challenge."""
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
    if location.startswith(f"{APP}/#/auth/login?error="):
        return location.rsplit("=", 1)[1]
    return None


def test_authorize_redirect_uses_state_and_pkce(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    base, _ = provider
    query = start(okit.client, "github", "#/domains/backend")
    assert query["_location"].startswith(f"{base}/login/oauth/authorize?")
    assert query["client_id"] == "gh-client"
    assert query["redirect_uri"] == f"{APP}/api/auth/oauth/github/callback"
    assert query["code_challenge_method"] == "S256"
    assert len(query["state"]) >= 40 and len(query["code_challenge"]) == 43
    assert "gh-secret-value" not in query["_location"]
    cookie = [part.strip().lower() for part in query["_cookie"].split(";")]
    assert cookie[0].startswith("lh_oauth=")
    assert {"httponly", "samesite=lax", "path=/api/auth/oauth", "max-age=600"} <= set(cookie)
    google = start(okit.client, "google")
    assert google["scope"] == "openid email profile"


def test_status_shows_configured_providers(okit: AuthKit) -> None:
    providers = okit.client.get("/api/auth/status").json()["providers"]
    assert providers == {"github": {"configured": True}, "google": {"configured": True}}


# Scenario: Not configured
def test_unconfigured_provider_is_reported_and_refused(
    settings_factory: Callable[..., Settings], provider: tuple[str, ProviderState]
) -> None:
    base, _ = provider
    values = provider_values(base)
    values.update(google_client_id=None, google_client_secret=None)
    with auth_kit(settings_factory(**values)) as half:
        status = half.client.get("/api/auth/status").json()["providers"]
        assert status == {"github": {"configured": True}, "google": {"configured": False}}
        response = half.client.get("/api/auth/oauth/google/start", follow_redirects=False)
        assert error_of(response) == "not_configured"
        assert "set-cookie" not in response.headers


def test_github_creates_the_owner_when_none_exists(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    query = start(okit.client, "github", "#/domains/backend?node=api")
    response = approve(okit.client, state, "github", query)
    assert response.headers["location"] == f"{APP}/#/domains/backend?node=api"
    assert "lh_session=" in response.headers["set-cookie"]
    me = okit.client.get("/api/auth/me").json()
    # The verified primary email, lower-cased; verified because the provider says so.
    assert me["email"] == "owner@example.test"
    assert me["email_verified"] is True
    assert me["display_name"] == "Octo Owner"
    assert me["has_password"] is False and me["linked"] == ["github"]
    # The PKCE verifier went to the token endpoint (the fake checks it against the challenge).
    [token_request] = state.token_requests
    assert token_request["client_secret"] == "gh-secret-value"
    assert token_request["redirect_uri"] == f"{APP}/api/auth/oauth/github/callback"


# Scenario: Sign in with GitHub
def test_linked_github_identity_signs_in_and_lands_on_its_page(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    approve(okit.client, state, "github", start(okit.client, "github"))
    browser = okit.browser()
    response = approve(browser, state, "github", start(browser, "github", "#/notes"))
    assert response.headers["location"] == f"{APP}/#/notes"
    assert browser.get("/api/notes").status_code == 200
    assert count("SELECT count(*) FROM users") == 1
    assert count("SELECT count(*) FROM oauth_accounts") == 1


# Scenario: Unknown GitHub identity
def test_unknown_github_identity_is_refused_when_the_owner_differs(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    okit.signup(email="boss@example.test")
    okit.client.post(
        "/api/auth/verify", json={"token": okit.mailer.token("verify-email")}
    ).raise_for_status()
    sessions_before = count("SELECT count(*) FROM sessions")
    browser = okit.browser()
    response = approve(browser, state, "github", start(browser, "github"))
    assert error_of(response) == "owner_exists"
    assert "lh_session" not in response.headers.get("set-cookie", "")
    assert browser.get("/api/notes").status_code == 401
    assert count("SELECT count(*) FROM sessions") == sessions_before
    assert count("SELECT count(*) FROM oauth_accounts") == 0


def test_same_email_links_only_when_the_owner_email_is_verified(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    okit.signup(email="owner@example.test", password=PASSWORD)
    browser = okit.browser()
    refused = approve(browser, state, "google", start(browser, "google"))
    assert error_of(refused) == "owner_exists"
    okit.client.post(
        "/api/auth/verify", json={"token": okit.mailer.token("verify-email")}
    ).raise_for_status()
    linked = approve(browser, state, "google", start(browser, "google", "#/settings"))
    assert linked.headers["location"] == f"{APP}/#/settings"
    me = browser.get("/api/auth/me").json()
    assert me["email"] == "owner@example.test" and me["linked"] == ["google"]
    assert me["has_password"] is True
    assert count("SELECT count(*) FROM users") == 1


def test_google_needs_a_verified_email(okit: AuthKit, provider: tuple[str, ProviderState]) -> None:
    _, state = provider
    state.google_info["email_verified"] = False
    response = approve(okit.client, state, "google", start(okit.client, "google"))
    assert error_of(response) == "email_unverified"
    assert count("SELECT count(*) FROM users") == 0


def test_github_needs_a_verified_primary_email(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    state.github_emails = [{"email": EMAIL, "primary": True, "verified": False}]
    response = approve(okit.client, state, "github", start(okit.client, "github"))
    assert error_of(response) == "email_unverified"
    assert count("SELECT count(*) FROM users") == 0


# Scenario: Forged callback
def test_forged_state_is_refused(okit: AuthKit, provider: tuple[str, ProviderState]) -> None:
    _, state = provider
    query = start(okit.client, "github")
    query["state"] = "forged-state-value"
    response = approve(okit.client, state, "github", query)
    assert error_of(response) == "state_mismatch"
    assert okit.client.get("/api/auth/me").status_code == 401
    assert count("SELECT count(*) FROM sessions") == 0
    assert state.token_requests == []  # the code was never exchanged


def test_callback_from_another_browser_is_refused(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    # The attacker starts a sign-in and sends the victim the callback link.
    query = start(okit.client, "github")
    victim = okit.browser()
    response = approve(victim, state, "github", query)
    assert error_of(response) == "state_mismatch"
    assert count("SELECT count(*) FROM sessions") == 0


def test_a_callback_works_once(okit: AuthKit, provider: tuple[str, ProviderState]) -> None:
    _, state = provider
    query = start(okit.client, "github")
    assert error_of(approve(okit.client, state, "github", query)) is None
    # Replaying the same callback with the same browser cookie finds nothing to finish.
    key = query["_cookie"].split(";")[0].split("=", 1)[1]
    okit.client.cookies.set("lh_oauth", key, path="/api/auth/oauth")
    assert error_of(approve(okit.client, state, "github", query)) == "state_mismatch"


def test_state_from_another_provider_is_refused(
    okit: AuthKit, provider: tuple[str, ProviderState]
) -> None:
    _, state = provider
    query = start(okit.client, "github")
    assert error_of(approve(okit.client, state, "google", query)) == "state_mismatch"


def test_provider_denial_and_failure(
    okit: AuthKit, provider: tuple[str, ProviderState], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    _, state = provider
    query = start(okit.client, "github")
    denied = okit.client.get(
        "/api/auth/oauth/github/callback",
        params={"error": "access_denied", "state": query["state"]},
        follow_redirects=False,
    )
    assert error_of(denied) == "access_denied"
    state.fail_token = True
    failed = approve(okit.client, state, "github", start(okit.client, "github"))
    assert error_of(failed) == "provider_error"
    # Provider answers are never echoed or logged.
    assert "secret-provider-detail" not in failed.headers["location"]
    assert "secret-provider-detail" not in caplog.text
    assert "gh-secret-value" not in caplog.text
    assert count("SELECT count(*) FROM users") == 0


@pytest.mark.parametrize(
    "next_route",
    ["https://evil.example/#/x", "//evil.example", "/#/x", "#/a\\b", "#/a b", "#/" + "x" * 600],
)
def test_next_must_be_an_app_hash_route(
    okit: AuthKit, provider: tuple[str, ProviderState], next_route: str
) -> None:
    _, state = provider
    response = approve(okit.client, state, "github", start(okit.client, "github", next_route))
    assert response.headers["location"] == f"{APP}/#/"


def test_oauth_never_leaks_tokens(
    okit: AuthKit, provider: tuple[str, ProviderState], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    _, state = provider
    response = approve(okit.client, state, "github", start(okit.client, "github"))
    session = okit.client.cookies["lh_session"]
    for secret in (session, "fake-access-token-123", "gh-secret-value"):
        assert secret not in caplog.text
        assert secret not in response.headers["location"]
    assert "fake-access-token-123" not in okit.client.get("/api/auth/me").text
