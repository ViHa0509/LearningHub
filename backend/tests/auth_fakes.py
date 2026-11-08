"""Fakes for the auth tests: a capturing mailer, a settable clock and a fake OAuth provider."""

import json
import re
import threading
import urllib.parse
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from app.auth.mail import Mail, MailMode
from app.auth.oauth import pkce_challenge


class CapturingMailer:
    mode: MailMode = "outbox"

    def __init__(self) -> None:
        self.sent: list[Mail] = []

    def send(self, mail: Mail) -> None:
        self.sent.append(mail)

    def token(self, purpose: str) -> str:
        """The token of the latest mail of this purpose."""
        mail = next(m for m in reversed(self.sent) if m.purpose == purpose)
        found = re.search(r"\?token=([A-Za-z0-9_-]+)", mail.body)
        assert found, "no link in the mail"
        return found.group(1)


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime.now(UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@dataclass
class ProviderState:
    """What the fake provider answers, and what it received."""

    github_user: dict[str, Any] = field(
        default_factory=lambda: {"id": 4242, "login": "octo", "name": "Octo Owner"}
    )
    github_emails: list[dict[str, Any]] = field(
        default_factory=lambda: [
            {"email": "Owner@Example.test", "primary": True, "verified": True},
            {"email": "other@example.test", "primary": False, "verified": True},
        ]
    )
    google_info: dict[str, Any] = field(
        default_factory=lambda: {
            "sub": "g-77",
            "email": "owner@example.test",
            "email_verified": True,
            "name": "Goo Owner",
        }
    )
    # code -> the PKCE challenge sent to the authorize URL
    challenges: dict[str, str] = field(default_factory=dict)
    token_requests: list[dict[str, str]] = field(default_factory=list)
    fail_token: bool = False


ACCESS_TOKEN = "fake-access-token-123"


def _handler(state: ProviderState) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:  # quiet
            pass

        def _json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            form = dict(urllib.parse.parse_qsl(self.rfile.read(length).decode()))
            state.token_requests.append(form)
            if state.fail_token:
                self._json(500, {"error": "boom secret-provider-detail"})
                return
            challenge = state.challenges.get(form.get("code", ""))
            if challenge is None or pkce_challenge(form.get("code_verifier", "")) != challenge:
                self._json(400, {"error": "invalid_grant"})
                return
            self._json(200, {"access_token": ACCESS_TOKEN, "token_type": "bearer"})

        def do_GET(self) -> None:
            if self.headers.get("Authorization") != f"Bearer {ACCESS_TOKEN}":
                self._json(401, {"message": "Bad credentials"})
                return
            path = urllib.parse.urlparse(self.path).path
            if path == "/api/user":
                self._json(200, state.github_user)
            elif path == "/api/user/emails":
                self._json(200, state.github_emails)
            elif path == "/userinfo":
                self._json(200, state.google_info)
            else:
                self._json(404, {})

    return Handler


@contextmanager
def fake_provider() -> Iterator[tuple[str, ProviderState]]:
    """A local GitHub-and-Google stand-in on 127.0.0.1; yields its base URL and state."""
    state = ProviderState()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", state
    finally:
        server.shutdown()
        server.server_close()


def provider_settings(base: str) -> dict[str, Any]:
    from pydantic import SecretStr

    return {
        "github_client_id": "gh-client",
        "github_client_secret": SecretStr("gh-secret-value"),
        "google_client_id": "goo-client",
        "google_client_secret": SecretStr("goo-secret-value"),
        "github_authorize_url": f"{base}/login/oauth/authorize",
        "github_token_url": f"{base}/login/oauth/access_token",
        "github_api_base": f"{base}/api",
        "google_authorize_url": f"{base}/o/oauth2/auth",
        "google_token_url": f"{base}/token",
        "google_userinfo_url": f"{base}/userinfo",
    }


H = {"X-LearningHub": "1"}
EMAIL = "me@example.test"
PASSWORD = "correct horse 1"


@dataclass
class AuthKit:
    app: Any
    client: Any
    mailer: CapturingMailer
    clock: FakeClock

    def browser(self) -> Any:
        """Another browser: the same app, its own cookie jar."""
        from fastapi.testclient import TestClient

        return TestClient(self.app, headers=H)

    def signup(self, client: Any = None, email: str = EMAIL, password: str = PASSWORD) -> Any:
        return (client or self.client).post(
            "/api/auth/signup", json={"email": email, "password": password}
        )

    def login(self, client: Any = None, email: str = EMAIL, password: str = PASSWORD) -> Any:
        return (client or self.client).post(
            "/api/auth/login", json={"email": email, "password": password}
        )


@contextmanager
def auth_kit(settings: Any) -> Iterator[AuthKit]:
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app(settings)
    mailer = CapturingMailer()
    clock = FakeClock()
    app.state.mailer = mailer
    app.state.clock = clock
    with TestClient(app, headers=H) as client:
        yield AuthKit(app=app, client=client, mailer=mailer, clock=clock)
    app.state.engine.dispose()
