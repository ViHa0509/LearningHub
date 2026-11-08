"""GitHub and Google sign-in: authorization code flow with state and PKCE, server side.

The state, the PKCE verifier and the route to return to are kept in memory under a random
key; the browser holds only that key, in a short-lived HttpOnly cookie. Provider answers are
never logged or shown, only an error code.
"""

import base64
import hashlib
import json
import logging
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from app.config import Settings

log = logging.getLogger(__name__)

ProviderName = Literal["github", "google"]
PENDING_COOKIE = "lh_oauth"
PENDING_SECONDS = 600
MAX_PENDING = 1000
HTTP_TIMEOUT = 10
MAX_BODY = 1_000_000


class OAuthError(Exception):
    """A failed sign-in; ``code`` goes to the login page as ``?error=<code>``."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Identity:
    provider: ProviderName
    provider_user_id: str
    email: str  # verified, lower-case
    name: str | None


@dataclass(frozen=True)
class Provider:
    name: ProviderName
    client_id: str
    client_secret: str
    authorize_url: str
    token_url: str
    scope: str


def provider_config(settings: Settings, name: ProviderName) -> Provider | None:
    """The provider's configuration, or None when its client ID or secret is missing."""
    if name == "github":
        client_id, secret = settings.github_client_id, settings.github_client_secret
        authorize, token, scope = (
            settings.github_authorize_url,
            settings.github_token_url,
            "read:user user:email",
        )
    else:
        client_id, secret = settings.google_client_id, settings.google_client_secret
        authorize, token, scope = (
            settings.google_authorize_url,
            settings.google_token_url,
            "openid email profile",
        )
    if not client_id or not client_id.strip() or secret is None:
        return None
    secret_value = secret.get_secret_value().strip()
    if not secret_value:
        return None
    return Provider(name, client_id.strip(), secret_value, authorize, token, scope)


def redirect_uri(settings: Settings, name: ProviderName) -> str:
    return f"{settings.public_url.rstrip('/')}/api/auth/oauth/{name}/callback"


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@dataclass(frozen=True)
class Pending:
    provider: ProviderName
    state: str
    verifier: str
    next: str
    created: float


class PendingStore:
    """Started sign-ins, each usable once and for 10 minutes."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._items: dict[str, Pending] = {}
        self._lock = Lock()

    def start(self, provider: ProviderName, next_route: str) -> tuple[str, Pending]:
        with self._lock:
            now = self._clock()
            for key in [k for k, p in self._items.items() if now - p.created >= PENDING_SECONDS]:
                del self._items[key]
            while len(self._items) >= MAX_PENDING:
                del self._items[next(iter(self._items))]
            key = secrets.token_urlsafe(32)
            pending = Pending(
                provider=provider,
                state=secrets.token_urlsafe(32),
                verifier=secrets.token_urlsafe(48),
                next=next_route,
                created=now,
            )
            self._items[key] = pending
            return key, pending

    def take(self, key: str | None) -> Pending | None:
        """Remove and return the started sign-in, if it exists and is not too old."""
        if not key:
            return None
        with self._lock:
            pending = self._items.pop(key, None)
            if pending is None or self._clock() - pending.created >= PENDING_SECONDS:
                return None
            return pending


def authorize_url(settings: Settings, provider: Provider, pending: Pending) -> str:
    params = {
        "client_id": provider.client_id,
        "redirect_uri": redirect_uri(settings, provider.name),
        "response_type": "code",
        "scope": provider.scope,
        "state": pending.state,
        "code_challenge": pkce_challenge(pending.verifier),
        "code_challenge_method": "S256",
    }
    separator = "&" if "?" in provider.authorize_url else "?"
    return f"{provider.authorize_url}{separator}{urllib.parse.urlencode(params)}"


def _request_json(url: str, data: dict[str, str] | None = None, token: str | None = None) -> Any:
    headers = {"Accept": "application/json", "User-Agent": "learning-hub"}
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode("ascii")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if not url.lower().startswith(("https://", "http://")):
        raise OAuthError("provider_error")
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read(MAX_BODY))


def _exchange_code(settings: Settings, provider: Provider, code: str, verifier: str) -> str:
    answer = _request_json(
        provider.token_url,
        data={
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri(settings, provider.name),
        },
    )
    token = answer.get("access_token") if isinstance(answer, dict) else None
    if not isinstance(token, str) or not token:
        raise OAuthError("provider_error")
    return token


def _github_identity(settings: Settings, token: str) -> Identity:
    base = settings.github_api_base.rstrip("/")
    user = _request_json(f"{base}/user", token=token)
    emails = _request_json(f"{base}/user/emails", token=token)
    if not isinstance(user, dict) or user.get("id") is None or not isinstance(emails, list):
        raise OAuthError("provider_error")
    primary = next(
        (
            e
            for e in emails
            if isinstance(e, dict) and e.get("primary") is True and e.get("verified") is True
        ),
        None,
    )
    if primary is None or not isinstance(primary.get("email"), str):
        raise OAuthError("email_unverified")
    name = user.get("name") or user.get("login")
    return Identity(
        provider="github",
        provider_user_id=str(user["id"]),
        email=primary["email"].strip().lower(),
        name=name if isinstance(name, str) else None,
    )


def _google_identity(settings: Settings, token: str) -> Identity:
    info = _request_json(settings.google_userinfo_url, token=token)
    if not isinstance(info, dict) or not info.get("sub"):
        raise OAuthError("provider_error")
    email = info.get("email")
    if info.get("email_verified") is not True or not isinstance(email, str) or not email:
        raise OAuthError("email_unverified")
    name = info.get("name")
    return Identity(
        provider="google",
        provider_user_id=str(info["sub"]),
        email=email.strip().lower(),
        name=name if isinstance(name, str) else None,
    )


def fetch_identity(settings: Settings, provider: Provider, code: str, verifier: str) -> Identity:
    """Exchange the code (with the PKCE verifier) and read the verified identity."""
    try:
        token = _exchange_code(settings, provider, code, verifier)
        if provider.name == "github":
            return _github_identity(settings, token)
        return _google_identity(settings, token)
    except OAuthError:
        raise
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as error:
        # The class only: provider answers and URLs never reach the log.
        log.warning("%s sign-in failed (%s)", provider.name, type(error).__name__)
        raise OAuthError("provider_error") from None
