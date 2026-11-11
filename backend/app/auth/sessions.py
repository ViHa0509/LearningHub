"""Server-side sessions: a random token in an HttpOnly cookie, only its hash in the database."""

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import User, UserSession

COOKIE = "lh_session"
LIFETIME = timedelta(days=30)
# Sliding expiry writes at most once per hour per session.
SLIDE_EVERY = timedelta(hours=1)
SIGN_IN_MESSAGE = "Sign in to continue"

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


def clock_of(request: Request) -> Clock:
    clock: Clock = getattr(request.app.state, "clock", utc_now)
    return clock


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def client_ip(request: Request) -> str | None:
    # The direct peer only: X-Forwarded-For is not trusted (anyone can send it).
    return request.client.host if request.client else None


def is_secure(request: Request, settings: Settings) -> bool:
    return request.url.scheme == "https" or settings.public_url.lower().startswith("https://")


@dataclass
class Signed:
    """The signed-in user and the session of this request."""

    user: User
    session: UserSession


def create_session(db: Session, user: User, request: Request) -> str:
    """Store a new session for ``user`` (not committed) and return the raw cookie token."""
    now = clock_of(request)()
    token = new_token()
    agent = request.headers.get("user-agent")
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            last_seen_at=now,
            expires_at=now + LIFETIME,
            user_agent=agent[:200] if agent else None,
            ip=client_ip(request),
        )
    )
    return token


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    settings: Settings = request.app.state.settings
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(LIFETIME.total_seconds()),
        path="/",
        httponly=True,
        samesite="lax",
        secure=is_secure(request, settings),
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    settings: Settings = request.app.state.settings
    response.delete_cookie(
        COOKIE, path="/", httponly=True, samesite="lax", secure=is_secure(request, settings)
    )


def find_session(db: Session, request: Request) -> Signed | None:
    """The valid session of the request's cookie, slid forward when due; None otherwise."""
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 200:
        return None
    now = clock_of(request)()
    row = db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == hash_token(token), UserSession.expires_at > now)
    ).first()
    if row is None:
        return None
    session, user = row
    if user.disabled_at is not None:
        return None  # a disabled account's sessions never work, even if one was left behind
    if now - session.last_seen_at >= SLIDE_EVERY:
        session.last_seen_at = now
        session.expires_at = now + LIFETIME
        db.commit()
        request.state.slid_token = token
    return Signed(user=user, session=session)


def require_signed(request: Request, response: Response, db: Session) -> Signed:
    signed = find_session(db, request)
    if signed is None:
        raise HTTPException(status_code=401, detail=SIGN_IN_MESSAGE)
    request.state.user_id = signed.user.id
    slid = getattr(request.state, "slid_token", None)
    if slid:
        # Keep the cookie as long-lived as the session it points to.
        set_session_cookie(response, request, slid)
    return signed


def require_session(request: Request, response: Response) -> None:
    """The gate on every data router: a valid session, when the login is switched on."""
    settings: Settings = request.app.state.settings
    if not settings.auth_required:
        return
    factory: sessionmaker[Session] = request.app.state.session_factory
    with factory() as db:
        require_signed(request, response, db)


def end_sessions(db: Session, user: User, keep: UserSession | None = None) -> int:
    """Delete the user's sessions except ``keep`` (not committed); return how many."""
    statement = delete(UserSession).where(UserSession.user_id == user.id)
    if keep is not None:
        statement = statement.where(UserSession.id != keep.id)
    result = db.execute(statement)
    return int(getattr(result, "rowcount", 0) or 0)
