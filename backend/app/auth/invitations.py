"""Invitations: a single-use link for one email, valid 7 days. Only the token's hash is stored.

Shared by the invitation routes and the GitHub/Google callback. Nothing here commits.
"""

from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, and_, select
from sqlalchemy.orm import Session

from app.auth.sessions import hash_token, new_token
from app.db import Invitation, User

LIFETIME = timedelta(days=7)


def _valid(now: datetime) -> ColumnElement[bool]:
    return and_(
        Invitation.accepted_at.is_(None),
        Invitation.revoked_at.is_(None),
        Invitation.expires_at > now,
    )


def issue(
    db: Session, email: str, invited_by: User | None, now: datetime
) -> tuple[Invitation, str]:
    """A new pending invitation for ``email`` (lower-case); older pending ones are revoked.

    Returns the row and the raw token (shown once, in the emailed link).
    """
    for old in db.scalars(select(Invitation).where(Invitation.email == email, _valid(now))):
        old.revoked_at = now
    token = new_token()
    invitation = Invitation(
        email=email,
        token_hash=hash_token(token),
        invited_by=invited_by.id if invited_by is not None else None,
        created_at=now,
        expires_at=now + LIFETIME,
    )
    db.add(invitation)
    db.flush()
    return invitation, token


def find_pending_by_email(db: Session, email: str, now: datetime) -> Invitation | None:
    """The newest valid (not used, revoked or expired) invitation for this email."""
    return db.scalars(
        select(Invitation)
        .where(Invitation.email == email, _valid(now))
        .order_by(Invitation.created_at.desc())
        .limit(1)
    ).first()


def find_pending_by_token(db: Session, token: str, now: datetime) -> Invitation | None:
    """The valid invitation of a raw token, or None."""
    if not token or len(token) > 200:
        return None
    return db.scalar(
        select(Invitation).where(Invitation.token_hash == hash_token(token), _valid(now))
    )


def accept(
    db: Session,
    invitation: Invitation,
    now: datetime,
    *,
    password_hash: str | None = None,
    display_name: str | None = None,
) -> User:
    """Create the member for the invitation (email verified) and mark it used (not committed).

    The caller flushes; an existing account with that email raises IntegrityError there.
    """
    user = User(
        email=invitation.email,
        email_verified_at=now,
        display_name=display_name,
        password_hash=password_hash,
        role="member",
        preferences={},
    )
    db.add(user)
    invitation.accepted_at = now
    return user
