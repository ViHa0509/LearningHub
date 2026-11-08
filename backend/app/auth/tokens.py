"""Single-use emailed tokens (verify email, reset password, magic link), stored hashed."""

from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.sessions import hash_token, new_token
from app.db import AuthToken, User

Purpose = Literal["verify_email", "reset_password", "magic_link"]

LIFETIMES: dict[Purpose, timedelta] = {
    "verify_email": timedelta(days=2),
    "reset_password": timedelta(minutes=30),
    "magic_link": timedelta(minutes=15),
}


def issue(db: Session, purpose: Purpose, user: User, now: datetime) -> str:
    """Store a new token (not committed) and return it raw. Older unused tokens of the
    same purpose stop working, so only the latest emailed link is valid."""
    db.execute(
        update(AuthToken)
        .where(
            AuthToken.user_id == user.id,
            AuthToken.purpose == purpose,
            AuthToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    token = new_token()
    db.add(
        AuthToken(
            purpose=purpose,
            token_hash=hash_token(token),
            user_id=user.id,
            email=user.email,
            expires_at=now + LIFETIMES[purpose],
            created_at=now,
        )
    )
    return token


def consume(db: Session, purpose: Purpose, token: str, now: datetime) -> AuthToken | None:
    """Mark the token used and return it, once; None when unknown, used or expired.

    One UPDATE ... RETURNING, so two requests with the same token cannot both succeed."""
    if not token or len(token) > 200:
        return None
    row = db.execute(
        update(AuthToken)
        .where(
            AuthToken.token_hash == hash_token(token),
            AuthToken.purpose == purpose,
            AuthToken.used_at.is_(None),
            AuthToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(AuthToken.id)
    ).first()
    if row is None:
        return None
    return db.execute(select(AuthToken).where(AuthToken.id == row[0])).scalar_one()
