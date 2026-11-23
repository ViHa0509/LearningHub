"""Removing a member and all of their data; shared by the admin's Users page and self-delete."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import Note, User
from app.storage import FileStore, release_blob

OWN_DELETE = "You cannot delete your own account"
WRONG_CONFIRM = "Type the member's email to confirm"


def release_avatar(db: Session, store: FileStore, key: str | None) -> None:
    """Delete a stored avatar when no user points at it any more (keys are by content)."""
    if key and not db.scalar(select(func.count()).select_from(User).where(User.avatar_key == key)):
        store.delete(key)


def delete_user_data(db: Session, store: FileStore, user: User) -> None:
    """Delete the user (rows cascade), then the stored files no other note or image uses."""
    # Read before the cascade removes the rows.
    keys = set(db.scalars(select(Note.storage_key).where(Note.user_id == user.id)))
    avatar = user.avatar_key
    db.delete(user)
    db.commit()
    for key in keys:
        release_blob(db, store, key)
    release_avatar(db, store, avatar)
