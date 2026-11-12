"""The final status of a job, saved in the database (``app_settings``).

In serverless mode a job runs inside the request that starts it and a later status read can
reach another instance, so the status cannot live in memory only.
"""

from typing import Any

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session, sessionmaker

from app.db import AppSetting


def save_status[T](sessions: sessionmaker[Session], key: str, kind: type[T], status: T) -> None:
    value: dict[str, Any] = TypeAdapter(kind).dump_python(status, mode="json")
    with sessions() as session:
        session.merge(AppSetting(key=key, value=value))
        session.commit()


def load_status[T](session: Session, key: str, kind: type[T]) -> T | None:
    """The saved status, or None when there is none (or it no longer fits the type)."""
    row = session.get(AppSetting, key)
    if row is None:
        return None
    try:
        return TypeAdapter(kind).validate_python(row.value)
    except ValidationError:
        return None
