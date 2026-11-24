"""In-app notifications (change notifications).

Every trigger calls ``notify`` inside its own transaction. A notification never breaks the
event that made it: the insert runs in a savepoint and a failure is logged by kind and user
id only. Params are plain values (names, titles, counts); the client builds the text and
shows them as text. Never put a key, token, password, prompt or answer text in params.
"""

import logging
import uuid
from datetime import timedelta
from typing import Any, Literal

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import Notification, User

LOG = logging.getLogger(__name__)

Kind = Literal[
    "new_member",
    "lesson_ready",
    "shared_limit",
    "provider_problem",
    "kh_reconnect",
    "field_published",
    "new_sign_in",
    "restored",
]

KEEP_DAYS = 90
KEEP_COUNT = 200


def notify(
    db: Session,
    user_id: uuid.UUID,
    kind: Kind,
    params: dict[str, Any],
    link: str,
    dedupe_key: str | None = None,
) -> None:
    """Add a notification in the caller's transaction (the caller commits). With a
    ``dedupe_key``, a second one with the same key for the same user is skipped."""
    if not link.startswith("#/"):
        raise ValueError("a notification links only to a page inside the app")
    try:
        with db.begin_nested():
            statement = insert(Notification).values(
                id=uuid.uuid4(),
                user_id=user_id,
                kind=kind,
                params=params,
                link=link,
                dedupe_key=dedupe_key,
            )
            if dedupe_key is not None:
                statement = statement.on_conflict_do_nothing(
                    index_elements=["user_id", "dedupe_key"],
                    index_where=Notification.dedupe_key.is_not(None),
                )
            db.execute(statement)
            _trim(db, user_id)
    except SQLAlchemyError:
        LOG.warning("notification not stored", extra={"kind": kind, "user_id": str(user_id)})


def forget(db: Session, user_id: uuid.UUID, dedupe_key: str) -> None:
    """Remove a deduplicated notification so the next event can make it again (for example
    after the user reconnected Knowledge Hub)."""
    db.execute(
        delete(Notification).where(
            Notification.user_id == user_id, Notification.dedupe_key == dedupe_key
        )
    )


def _trim(db: Session, user_id: uuid.UUID) -> None:
    """Keep the newest KEEP_COUNT notifications of the user, none older than KEEP_DAYS."""
    newest = (
        select(Notification.id)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(KEEP_COUNT)
    )
    db.execute(
        delete(Notification).where(
            Notification.user_id == user_id,
            (Notification.created_at < func.now() - timedelta(days=KEEP_DAYS))
            | Notification.id.not_in(newest),
        )
    )


def notify_new_member(db: Session, member: User) -> None:
    """Tell the admin that a member joined (sign-up, invitation); never for the admin."""
    from app.auth.current import find_admin  # local: app.auth.current imports the session code

    admin = find_admin(db)
    if admin is None or admin.id == member.id or member.role == "admin":
        return
    name = member.display_name or member.email
    notify(db, admin.id, "new_member", {"name": name, "email": member.email}, "#/settings/users")
