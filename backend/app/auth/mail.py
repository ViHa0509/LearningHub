"""Outgoing email: SMTP when configured, else .eml files in the local outbox folder.

Nothing here logs a message body, a link or a token; the outbox logs only the file path.
"""

import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Literal, Protocol

from app.config import Settings

log = logging.getLogger(__name__)

MailMode = Literal["smtp", "outbox"]
DEFAULT_FROM = "Learning Hub <learning-hub@localhost>"
SMTP_TIMEOUT = 15


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    body: str
    purpose: str


class Mailer(Protocol):
    mode: MailMode

    def send(self, mail: Mail) -> None: ...


def build_message(mail: Mail, sender: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = mail.to
    message["Subject"] = mail.subject
    message.set_content(mail.body)
    return message


class SmtpMailer:
    mode: MailMode = "smtp"

    def __init__(self, settings: Settings) -> None:
        if not settings.smtp_host:
            raise ValueError("LH_SMTP_HOST is not set")
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.user = settings.smtp_user
        self.password = settings.smtp_password
        self.sender = settings.smtp_from or settings.smtp_user or DEFAULT_FROM

    def send(self, mail: Mail) -> None:
        message = build_message(mail, self.sender)
        context = ssl.create_default_context()
        smtp: smtplib.SMTP
        if self.port == 465:
            smtp = smtplib.SMTP_SSL(self.host, self.port, timeout=SMTP_TIMEOUT, context=context)
        else:
            smtp = smtplib.SMTP(self.host, self.port, timeout=SMTP_TIMEOUT)
        with smtp:
            if self.port != 465:
                smtp.starttls(context=context)
            if self.user and self.password:
                smtp.login(self.user, self.password.get_secret_value())
            smtp.send_message(message)


class OutboxMailer:
    """Local-only use: each message becomes ``<outbox>/<utc time>-<purpose>.eml``."""

    mode: MailMode = "outbox"

    def __init__(self, folder: Path, sender: str = DEFAULT_FROM) -> None:
        self.folder = folder
        self.sender = sender

    def send(self, mail: Mail) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        path = self.folder / f"{stamp}-{mail.purpose}.eml"
        path.write_bytes(bytes(build_message(mail, self.sender)))
        log.info("email written to the outbox: %s", path)


def mailer_from_settings(settings: Settings) -> Mailer:
    if settings.smtp_host:
        return SmtpMailer(settings)
    return OutboxMailer(settings.storage_dir / "outbox", settings.smtp_from or DEFAULT_FROM)


def send_quietly(mailer: Mailer, mail: Mail) -> None:
    """Send in the background; a failure is logged by purpose only (no address, no link)."""
    try:
        mailer.send(mail)
    except (OSError, smtplib.SMTPException) as error:
        log.warning("could not send the %s email (%s)", mail.purpose, type(error).__name__)
