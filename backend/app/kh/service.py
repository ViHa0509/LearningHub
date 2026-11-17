"""The KH sign-in: device grant with PKCE, token refresh with rotation, revoke and ``me``.

The hosted backend keeps nothing between requests, so the state of a sign-in lives in
``kh_connections``. The device code, verifier and refresh token are encrypted; no access token
is stored. A log line holds the call's name, status and duration, never an address with
parameters, a token, a code, a query or an answer.
"""

import contextlib
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import delete, or_, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.agent.secrets import SecretBox, SecretUnreadable
from app.auth.oauth import pkce_challenge
from app.config import Settings
from app.db import KhConnection
from app.kh.http import HttpFn, HttpReply, HttpRequest, KhNetworkError, urllib_http

log = logging.getLogger(__name__)

SCOPE = "openid offline_access"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
DEFAULT_INTERVAL = 5
DEFAULT_EXPIRES_IN = 600
SLOW_DOWN_STEP = 5
MAX_REASON = 200
SIGN_IN_DID_NOT_ANSWER = "Knowledge Hub sign-in did not answer"


class KhConflict(Exception):
    """The user is already connected."""


class KhSignInUnavailable(Exception):
    """The identity service did not answer or refused to start a sign-in."""


class KhReconnect(Exception):
    """The stored sign-in is gone or no longer accepted; the user must connect again."""


class KhUnreachable(Exception):
    """Knowledge Hub or the identity service did not answer."""


class KhSearchError(Exception):
    """KH refused or failed the search; ``message`` is for the model (KH's own words)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class KhAnswer:
    project: str
    text: str


KhSearchFn = Callable[[str, str | None], KhAnswer]


class PendingView(BaseModel):
    verification_uri: str
    verification_uri_complete: str | None
    user_code: str
    interval: int
    expires_at: datetime


class StatusView(BaseModel):
    available: bool
    status: Literal["disconnected", "pending", "connected"]
    email: str | None
    pending: PendingView | None


class PollView(BaseModel):
    status: Literal["pending", "connected", "expired", "denied"]
    interval: int | None
    email: str | None
    reason: str | None


def _reason(body: Any, fallback: str) -> str:
    """A short sentence from an error answer (``detail``, ``error_description``)."""
    if isinstance(body, dict):
        for key in ("detail", "error_description", "message"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:MAX_REASON]
    return fallback


def _kh_message(body: Any, fallback: str) -> str:
    if isinstance(body, dict):
        for key in ("detail", "message", "error", "text"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:MAX_REASON]
    return fallback


def _error_code(reply: HttpReply) -> str:
    if isinstance(reply.body, dict) and isinstance(reply.body.get("error"), str):
        return str(reply.body["error"])
    return ""


def _is_web_address(value: str) -> bool:
    return value.lower().startswith(("http://", "https://"))


def _positive(value: Any, default: int) -> int:
    return (
        value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else default
    )


class KhService:
    def __init__(
        self,
        settings: Settings,
        box: SecretBox,
        sessions: sessionmaker[Session],
        clock: Callable[[], datetime],
        http: HttpFn = urllib_http,
    ) -> None:
        self._settings = settings
        self._box = box
        self._sessions = sessions
        self._clock = clock
        self.http = http  # tests replace this

    @property
    def available(self) -> bool:
        s = self._settings
        return all((v or "").strip() for v in (s.kh_url, s.kh_issuer, s.kh_client_id))

    # -- addresses and calls ---------------------------------------------------------------

    @property
    def _client_id(self) -> str:
        return (self._settings.kh_client_id or "").strip()

    def _idp(self, path: str) -> str:
        issuer = (self._settings.kh_issuer or "").strip().rstrip("/")
        return f"{issuer}/protocol/openid-connect/{path}"

    def _api(self, path: str) -> str:
        return f"{(self._settings.kh_url or '').strip().rstrip('/')}{path}"

    def _send(self, name: str, request: HttpRequest) -> HttpReply:
        """One call; the log line has the name, status and duration only."""
        started = time.monotonic()
        try:
            reply = self.http(request)
        except KhNetworkError as error:
            log.warning("kh %s failed (%s)", name, error)
            raise
        log.info("kh %s -> %s in %d ms", name, reply.status, (time.monotonic() - started) * 1000)
        return reply

    # -- status ----------------------------------------------------------------------------

    def status(self, user_id: UUID) -> StatusView:
        if not self.available:
            return StatusView(available=False, status="disconnected", email=None, pending=None)
        gone = StatusView(available=True, status="disconnected", email=None, pending=None)
        with self._sessions() as db:
            row = db.get(KhConnection, user_id)
            if row is None:
                return gone
            if row.status == "connected":
                return StatusView(
                    available=True, status="connected", email=row.kh_email, pending=None
                )
            if (
                row.expires_at is None
                or row.expires_at <= self._clock()
                or row.user_code is None
                or row.verification_uri is None
            ):
                return gone
            pending = PendingView(
                verification_uri=row.verification_uri,
                verification_uri_complete=row.verification_uri_complete,
                user_code=row.user_code,
                interval=row.interval or DEFAULT_INTERVAL,
                expires_at=row.expires_at,
            )
            return StatusView(available=True, status="pending", email=None, pending=pending)

    # -- connect ---------------------------------------------------------------------------

    def connect(self, user_id: UUID) -> PendingView:
        with self._sessions() as db:
            existing = db.get(KhConnection, user_id)
            if existing is not None and existing.status == "connected":
                raise KhConflict()
        verifier = secrets.token_urlsafe(48)
        try:
            reply = self._send(
                "device",
                HttpRequest(
                    "POST",
                    self._idp("auth/device"),
                    form={
                        "client_id": self._client_id,
                        "scope": SCOPE,
                        "code_challenge": pkce_challenge(verifier),
                        "code_challenge_method": "S256",
                    },
                ),
            )
        except KhNetworkError:
            raise KhSignInUnavailable() from None
        body = reply.body
        if (
            reply.status != 200
            or not isinstance(body, dict)
            or not isinstance(body.get("device_code"), str)
            or not isinstance(body.get("user_code"), str)
            or not isinstance(body.get("verification_uri"), str)
        ):
            raise KhSignInUnavailable()
        interval = _positive(body.get("interval"), DEFAULT_INTERVAL)
        expires_in = _positive(body.get("expires_in"), DEFAULT_EXPIRES_IN)
        complete = body.get("verification_uri_complete")
        if not _is_web_address(body["verification_uri"]) or (
            complete is not None and not (isinstance(complete, str) and _is_web_address(complete))
        ):
            raise KhSignInUnavailable()
        complete = complete if isinstance(complete, str) else None
        expires_at = self._clock() + timedelta(seconds=expires_in)
        values: dict[str, Any] = {
            "status": "pending",
            "device_code_enc": self._box.encrypt(body["device_code"]),
            "verifier_enc": self._box.encrypt(verifier),
            "user_code": body["user_code"],
            "verification_uri": body["verification_uri"],
            "verification_uri_complete": complete,
            "interval": interval,
            "expires_at": expires_at,
            "last_poll_at": None,
            "refresh_token_enc": None,
            "kh_email": None,
            "personal_project": None,
            "connected_at": None,
        }
        with self._sessions() as db:
            try:
                row = db.get(KhConnection, user_id)
                if row is None:
                    db.add(KhConnection(user_id=user_id, **values))
                elif row.status == "connected":
                    raise KhConflict()
                else:
                    for key, value in values.items():
                        setattr(row, key, value)
                db.commit()
            except IntegrityError:
                db.rollback()
                raise KhConflict() from None
        return PendingView(
            verification_uri=body["verification_uri"],
            verification_uri_complete=complete,
            user_code=body["user_code"],
            interval=interval,
            expires_at=expires_at,
        )

    # -- poll ------------------------------------------------------------------------------

    def poll(self, user_id: UUID) -> PollView | None:
        """One check of a pending sign-in; None when the user has no row."""
        now = self._clock()
        with self._sessions() as db:
            row = db.get(KhConnection, user_id)
            if row is None:
                return None
            if row.status == "connected":
                return PollView(status="connected", interval=None, email=row.kh_email, reason=None)
            interval = row.interval or DEFAULT_INTERVAL
            if row.expires_at is None or row.expires_at <= now:
                self._drop_pending(db, user_id)
                return self._expired()
            # Claim this check in one statement, so two polls never both call the service.
            claim = db.execute(
                update(KhConnection)
                .where(
                    KhConnection.user_id == user_id,
                    KhConnection.status == "pending",
                    or_(
                        KhConnection.last_poll_at.is_(None),
                        KhConnection.last_poll_at <= now - timedelta(seconds=interval),
                    ),
                )
                .values(last_poll_at=now)
                .returning(KhConnection.device_code_enc, KhConnection.verifier_enc)
            ).first()
            db.commit()
        if claim is None:
            return PollView(status="pending", interval=interval, email=None, reason=None)
        try:
            device_code = self._box.decrypt(claim.device_code_enc or "")
            verifier = self._box.decrypt(claim.verifier_enc or "")
        except SecretUnreadable:
            self._drop_pending_for(user_id)
            return self._denied("The sign-in could not be read; connect again.")
        try:
            reply = self._send(
                "token",
                HttpRequest(
                    "POST",
                    self._idp("token"),
                    form={
                        "grant_type": DEVICE_GRANT,
                        "device_code": device_code,
                        "client_id": self._client_id,
                        "code_verifier": verifier,
                    },
                ),
            )
        except KhNetworkError:
            return PollView(status="pending", interval=interval, email=None, reason=None)
        body = reply.body
        if reply.status == 200 and isinstance(body, dict):
            return self._finish(user_id, body)
        code = _error_code(reply)
        if code == "authorization_pending" or reply.status >= 500:
            return PollView(status="pending", interval=interval, email=None, reason=None)
        if code == "slow_down":
            interval += SLOW_DOWN_STEP
            with self._sessions() as db:
                db.execute(
                    update(KhConnection)
                    .where(KhConnection.user_id == user_id, KhConnection.status == "pending")
                    .values(interval=interval)
                )
                db.commit()
            return PollView(status="pending", interval=interval, email=None, reason=None)
        self._drop_pending_for(user_id)
        if code == "expired_token":
            return self._expired()
        if code == "access_denied":
            return self._denied("The sign-in was refused.")
        return self._denied(_reason(body, "The identity service refused the sign-in."))

    def _expired(self) -> PollView:
        return PollView(
            status="expired",
            interval=None,
            email=None,
            reason="The sign-in code expired. Connect again.",
        )

    def _denied(self, reason: str) -> PollView:
        return PollView(status="denied", interval=None, email=None, reason=reason)

    def _drop_pending(self, db: Session, user_id: UUID) -> None:
        db.execute(
            delete(KhConnection).where(
                KhConnection.user_id == user_id, KhConnection.status == "pending"
            )
        )
        db.commit()

    def _drop_pending_for(self, user_id: UUID) -> None:
        with self._sessions() as db:
            self._drop_pending(db, user_id)

    def _finish(self, user_id: UUID, tokens: dict[str, Any]) -> PollView:
        """The user signed in: read who they are in KH, then keep only the refresh token."""
        access = tokens.get("access_token")
        refresh = tokens.get("refresh_token")
        if not isinstance(refresh, str) or not refresh or not isinstance(access, str):
            self._drop_pending_for(user_id)
            return self._denied("The identity service issued no lasting sign-in.")
        try:
            reply = self._send("me", HttpRequest("GET", self._api("/auth/me"), bearer=access))
        except KhNetworkError:
            self._drop_pending_for(user_id)
            self.revoke(refresh)
            return self._denied("Knowledge Hub did not answer.")
        body = reply.body
        if (
            reply.status != 200
            or not isinstance(body, dict)
            or not isinstance(body.get("email"), str)
        ):
            self._drop_pending_for(user_id)
            self.revoke(refresh)
            return self._denied(_reason(body, "Knowledge Hub does not know this account."))
        project = body.get("personal_project")
        email = str(body["email"])
        with self._sessions() as db:
            result = db.execute(
                update(KhConnection)
                .where(KhConnection.user_id == user_id, KhConnection.status == "pending")
                .values(
                    status="connected",
                    refresh_token_enc=self._box.encrypt(refresh),
                    kh_email=email,
                    personal_project=project if isinstance(project, str) else None,
                    connected_at=self._clock(),
                    device_code_enc=None,
                    verifier_enc=None,
                    user_code=None,
                    verification_uri=None,
                    verification_uri_complete=None,
                    interval=None,
                    expires_at=None,
                    last_poll_at=None,
                )
            )
            changed = result.rowcount if isinstance(result, CursorResult) else 0
            db.commit()
        if not changed:  # cancelled meanwhile: do not keep the sign-in
            self.revoke(refresh)
            return self._denied("The sign-in was cancelled.")
        return PollView(status="connected", interval=None, email=email, reason=None)

    # -- tokens ----------------------------------------------------------------------------

    def revoke(self, refresh_token: str) -> None:
        """Best effort: a failure is ignored."""
        try:
            self._send(
                "revoke",
                HttpRequest(
                    "POST",
                    self._idp("revoke"),
                    form={
                        "client_id": self._client_id,
                        "token": refresh_token,
                        "token_type_hint": "refresh_token",
                    },
                ),
            )
        except Exception:  # never let a revoke fail its caller
            log.warning("kh revoke failed")

    def _stored_refresh(self, user_id: UUID) -> str | None:
        with self._sessions() as db:
            row = db.get(KhConnection, user_id)
            if row is None or row.status != "connected":
                return None
            return row.refresh_token_enc

    def _delete_if_token(self, user_id: UUID, enc: str) -> None:
        """Delete the connection only while it still holds the refused token."""
        with self._sessions() as db:
            db.execute(
                delete(KhConnection).where(
                    KhConnection.user_id == user_id, KhConnection.refresh_token_enc == enc
                )
            )
            db.commit()

    def access_token(self, user_id: UUID) -> str:
        """A short-lived access token for the user (refresh token exchanged; rotation saved).

        The rotated refresh token is saved only if the stored one is still the one that was
        sent. A refused token whose row changed meanwhile is retried once with the new one;
        the row is deleted only while it still holds the refused token.

        Raises KhReconnect when there is no connection or the identity service no longer
        accepts it, KhUnreachable when it does not answer.
        """
        enc = self._stored_refresh(user_id)
        if enc is None:
            raise KhReconnect()
        for attempt in (1, 2):
            try:
                refresh = self._box.decrypt(enc)
            except SecretUnreadable:
                # The key changed (or this process has another one): the sign-in may still be
                # valid, so the row stays; Disconnect clears it.
                raise KhReconnect() from None
            try:
                reply = self._send(
                    "refresh",
                    HttpRequest(
                        "POST",
                        self._idp("token"),
                        form={
                            "grant_type": "refresh_token",
                            "refresh_token": refresh,
                            "client_id": self._client_id,
                        },
                    ),
                )
            except KhNetworkError:
                raise KhUnreachable() from None
            body = reply.body
            if reply.status == 200 and isinstance(body, dict):
                access = body.get("access_token")
                if not isinstance(access, str) or not access:
                    raise KhUnreachable()
                rotated = body.get("refresh_token")
                if isinstance(rotated, str) and rotated and rotated != refresh:
                    with self._sessions() as db:
                        db.execute(
                            update(KhConnection)
                            .where(
                                KhConnection.user_id == user_id,
                                KhConnection.status == "connected",
                                KhConnection.refresh_token_enc == enc,
                            )
                            .values(refresh_token_enc=self._box.encrypt(rotated))
                        )
                        db.commit()
                return access
            if _error_code(reply) != "invalid_grant":
                raise KhUnreachable()
            current = self._stored_refresh(user_id)
            if current is None:
                raise KhReconnect()
            if current != enc and attempt == 1:
                enc = current  # another call rotated it meanwhile: try the new one once
                continue
            self._delete_if_token(user_id, enc)
            raise KhReconnect()
        raise KhReconnect()  # unreachable; keeps the type checker content

    # -- search ----------------------------------------------------------------------------

    def search_for(self, user_id: UUID) -> KhSearchFn | None:
        """The user's search function, or None unless the connector is available and the
        user is connected."""
        if not self.available:
            return None
        with self._sessions() as db:
            row = db.get(KhConnection, user_id)
            if row is None or row.status != "connected":
                return None
        return lambda query, project: self.search(user_id, query, project)

    def search(self, user_id: UUID, query: str, project: str | None) -> KhAnswer:
        """Ask KH what the user may read about ``query`` (read-only), as the user.

        Raises KhReconnect (sign-in gone), KhUnreachable (no answer) or KhSearchError.
        """
        if project is None:
            with self._sessions() as db:
                row = db.get(KhConnection, user_id)
                project = row.personal_project if row is not None else None
            if not project:
                raise KhSearchError("no personal Knowledge Hub project; give a project id")
        access = self.access_token(user_id)
        try:
            reply = self._send(
                "search",
                HttpRequest(
                    "POST",
                    self._api("/flows/task.full-retrieve/run"),
                    json_body={"input": {"text": query, "space": project}},
                    bearer=access,
                ),
            )
        except KhNetworkError:
            raise KhUnreachable() from None
        body = reply.body
        if 400 <= reply.status < 500:
            fallback = f"Knowledge Hub refused the search ({reply.status})"
            raise KhSearchError(_kh_message(body, fallback))
        if reply.status != 200 or not isinstance(body, dict):
            raise KhUnreachable()
        if body.get("status") == "failed":
            raise KhSearchError(_kh_message(body, "Knowledge Hub could not run the search"))
        text = body.get("text")
        if not isinstance(text, str):
            raise KhSearchError("Knowledge Hub answered without text")
        return KhAnswer(project=project, text=text)

    # -- disconnect ------------------------------------------------------------------------

    def _delete(self, user_id: UUID) -> None:
        with self._sessions() as db:
            db.execute(delete(KhConnection).where(KhConnection.user_id == user_id))
            db.commit()

    def disconnect(self, user_id: UUID) -> None:
        """Revoke (best effort) and delete the row; a pending row is cancelled; no row is fine."""
        with self._sessions() as db:
            row = db.get(KhConnection, user_id)
            enc = row.refresh_token_enc if row is not None and row.status == "connected" else None
        if enc is not None:
            with contextlib.suppress(SecretUnreadable):
                self.revoke(self._box.decrypt(enc))
        self._delete(user_id)
