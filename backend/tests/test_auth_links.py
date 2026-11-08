"""Spec: auth - Magic link and email verification (and the outbox / SMTP mailers)."""

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.auth import mail as mail_module
from app.auth.mail import Mail, OutboxMailer, SmtpMailer, mailer_from_settings, send_quietly
from app.config import Settings
from app.main import create_app
from tests.auth_fakes import EMAIL, AuthKit

SAME_MAGIC = "If that email belongs to the owner, a sign-in link is on its way."


def verify_owner(kit: AuthKit) -> None:
    token = kit.mailer.token("verify-email")
    assert kit.browser().post("/api/auth/verify", json={"token": token}).status_code == 200


# Scenario: Verify email
def test_verify_email_from_the_signup_mail(kit: AuthKit) -> None:
    kit.signup()
    token = kit.mailer.token("verify-email")
    # The link can be opened in any browser, signed in or not.
    other = kit.browser()
    response = other.post("/api/auth/verify", json={"token": token})
    assert response.status_code == 200
    assert response.json() == {"email_verified": True}
    assert kit.client.get("/api/auth/me").json()["email_verified"] is True
    assert other.post("/api/auth/verify", json={"token": token}).status_code == 400


def test_resend_verify_link_replaces_the_old_one(kit: AuthKit) -> None:
    kit.signup()
    old = kit.mailer.token("verify-email")
    resent = kit.client.post("/api/auth/verify/resend")
    assert resent.status_code == 200
    assert resent.json() == {"message": "A verification link is on its way."}
    new = kit.mailer.token("verify-email")
    assert new != old
    assert kit.client.post("/api/auth/verify", json={"token": old}).status_code == 400
    assert kit.client.post("/api/auth/verify", json={"token": new}).status_code == 200
    again = kit.client.post("/api/auth/verify/resend")
    assert again.json() == {"message": "Your email is verified already."}


def test_resend_needs_a_session(kit: AuthKit) -> None:
    assert kit.client.post("/api/auth/verify/resend").status_code == 401


def test_bad_verify_token_is_refused(kit: AuthKit) -> None:
    kit.signup()
    assert kit.client.post("/api/auth/verify", json={"token": "made-up"}).status_code == 400
    assert kit.client.get("/api/auth/me").json()["email_verified"] is False


# Scenario: Magic link
def test_magic_link_signs_in_once(kit: AuthKit) -> None:
    kit.signup()
    verify_owner(kit)
    asked = kit.browser().post("/api/auth/magic", json={"email": "ME@example.test"})
    assert asked.json() == {"message": SAME_MAGIC}
    magic_mail = kit.mailer.sent[-1]
    assert magic_mail.purpose == "magic-link" and magic_mail.to == EMAIL
    token = kit.mailer.token("magic-link")
    assert f"http://localhost:5173/#/auth/magic?token={token}" in magic_mail.body
    kit.clock.advance(minutes=14)
    browser = kit.browser()
    opened = browser.post("/api/auth/magic/consume", json={"token": token})
    assert opened.status_code == 200
    assert opened.json()["email"] == EMAIL
    assert browser.get("/api/notes").status_code == 200
    second = kit.browser()
    refused = second.post("/api/auth/magic/consume", json={"token": token})
    assert refused.status_code == 400
    assert "lh_session" not in refused.cookies
    assert second.get("/api/notes").status_code == 401


def test_magic_link_expires_after_15_minutes(kit: AuthKit) -> None:
    kit.signup()
    verify_owner(kit)
    kit.client.post("/api/auth/magic", json={"email": EMAIL})
    token = kit.mailer.token("magic-link")
    kit.clock.advance(minutes=15, seconds=1)
    late = kit.browser().post("/api/auth/magic/consume", json={"token": token})
    assert late.status_code == 400


def test_magic_link_goes_only_to_the_verified_owner(kit: AuthKit) -> None:
    kit.signup()
    unverified = kit.client.post("/api/auth/magic", json={"email": EMAIL})
    unknown = kit.client.post("/api/auth/magic", json={"email": "nobody@example.test"})
    assert unverified.status_code == unknown.status_code == 200
    assert unverified.json() == unknown.json() == {"message": SAME_MAGIC}
    assert [m.purpose for m in kit.mailer.sent] == ["verify-email"]


# --- mailers


def test_outbox_writes_eml_and_logs_only_the_path(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    mailer = OutboxMailer(tmp_path / "outbox")
    secret_link = "http://localhost:5173/#/auth/magic?token=sekrit-token-value"
    mailer.send(Mail(to=EMAIL, subject="Sign in", body=secret_link, purpose="magic-link"))
    [path] = list((tmp_path / "outbox").iterdir())
    assert path.name.endswith("-magic-link.eml")
    content = path.read_text(encoding="utf-8")
    assert "To: me@example.test" in content and "sekrit-token-value" in content
    assert str(path) in caplog.text
    assert "sekrit-token-value" not in caplog.text


def test_signup_mail_lands_in_the_outbox_by_default(
    settings_factory: Callable[..., Settings], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    settings = settings_factory()
    app = create_app(settings)
    with TestClient(app, headers={"X-LearningHub": "1"}) as client:
        assert client.get("/api/auth/status").json()["mail"] == {"mode": "outbox"}
        client.post("/api/auth/signup", json={"email": EMAIL, "password": "correct horse 1"})
    app.state.engine.dispose()
    [path] = list((settings.storage_dir / "outbox").glob("*-verify-email.eml"))
    token = path.read_text(encoding="utf-8").split("token=")[1].split()[0]
    assert token not in caplog.text


class FakeSMTP:
    instances: list["FakeSMTP"] = []  # noqa: RUF012

    def __init__(self, host: str, port: int, timeout: float = 0, **kwargs: Any) -> None:
        self.host, self.port, self.timeout = host, port, timeout
        self.calls: list[str] = []
        FakeSMTP.instances.append(self)

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *args: Any) -> None:
        self.calls.append("quit")

    def starttls(self, context: Any = None) -> None:
        self.calls.append("starttls")

    def login(self, user: str, password: str) -> None:
        self.calls.append(f"login:{user}:{password}")

    def send_message(self, message: Any) -> None:
        self.calls.append(f"send:{message['To']}")


@pytest.mark.parametrize(("port", "first"), [(587, "starttls"), (465, "login:u:p")])
def test_smtp_mailer_uses_tls(
    settings_factory: Callable[..., Settings],
    monkeypatch: pytest.MonkeyPatch,
    port: int,
    first: str,
) -> None:
    FakeSMTP.instances = []
    monkeypatch.setattr(mail_module.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(mail_module.smtplib, "SMTP_SSL", FakeSMTP)
    settings = settings_factory(
        smtp_host="mail.example.test",
        smtp_port=port,
        smtp_user="u",
        smtp_password=SecretStr("p"),
        smtp_from="hub@example.test",
    )
    mailer = mailer_from_settings(settings)
    assert isinstance(mailer, SmtpMailer) and mailer.mode == "smtp"
    mailer.send(Mail(to=EMAIL, subject="s", body="b", purpose="verify-email"))
    [smtp] = FakeSMTP.instances
    assert (smtp.host, smtp.port, smtp.timeout) == ("mail.example.test", port, 15)
    assert smtp.calls[0] == first
    assert smtp.calls[-2:] == [f"send:{EMAIL}", "quit"]


def test_status_reports_smtp_mode(settings_factory: Callable[..., Settings]) -> None:
    app = create_app(settings_factory(smtp_host="mail.example.test"))
    with TestClient(app) as client:
        assert client.get("/api/auth/status").json()["mail"] == {"mode": "smtp"}
    app.state.engine.dispose()


def test_a_failed_send_is_logged_without_details(caplog: pytest.LogCaptureFixture) -> None:
    class Broken:
        mode = "smtp"

        def send(self, mail: Mail) -> None:
            raise ConnectionRefusedError("token=sekrit in some message")

    send_quietly(Broken(), Mail(to=EMAIL, subject="s", body="token=sekrit", purpose="magic-link"))
    assert "could not send the magic-link email (ConnectionRefusedError)" in caplog.text
    assert "sekrit" not in caplog.text and EMAIL not in caplog.text
