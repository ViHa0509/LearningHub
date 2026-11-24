"""Spec: notifications - Retention; the notify helper (design 1, 3) and migration 0026."""

from datetime import timedelta
from typing import Any

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, inspect, select, text, update
from sqlalchemy.orm import Session

from app.db import Notification, User
from app.notifications import KEEP_COUNT, forget, notify
from tests.conftest import TEST_DATABASE_URL, alembic_config, user_id_of


def _db(client: TestClient) -> Session:
    session: Session = client.app.state.session_factory()  # type: ignore[attr-defined]
    return session


def _count(db: Session, user_id: Any) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(Notification).where(Notification.user_id == user_id)
        )
        or 0
    )


def test_0026_creates_notifications_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        assert "notifications" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class "
                    "WHERE relname = 'notifications' AND relrowsecurity"
                )
            ).all()
        assert locked == ["notifications"]
        columns = {c["name"] for c in inspector.get_columns("notifications")}
        assert columns == {
            "id",
            "user_id",
            "kind",
            "params",
            "link",
            "dedupe_key",
            "created_at",
            "read_at",
        }
        (key,) = inspector.get_foreign_keys("notifications")
        assert key["referred_table"] == "users"
        assert key["options"].get("ondelete") == "CASCADE"
        indexes = {i["name"]: i for i in inspector.get_indexes("notifications")}
        assert indexes["uq_notifications_user_dedupe"]["unique"]
        command.downgrade(config, "0025")
        assert "notifications" not in inspect(engine).get_table_names()
    finally:
        command.upgrade(config, "head")
        engine.dispose()


def test_notify_stores_the_row_in_the_callers_transaction(client: TestClient) -> None:
    admin = user_id_of(client.app)
    with _db(client) as db:
        notify(db, admin, "lesson_ready", {"topic": "backend/graphql"}, "#/lesson/backend/graphql")
        db.rollback()
        assert _count(db, admin) == 0
        notify(db, admin, "lesson_ready", {"topic": "backend/graphql"}, "#/lesson/backend/graphql")
        db.commit()
        row = db.scalars(select(Notification).where(Notification.user_id == admin)).one()
    assert row.kind == "lesson_ready"
    assert row.params == {"topic": "backend/graphql"}
    assert row.read_at is None


def test_a_dedupe_key_makes_it_once(client: TestClient) -> None:
    admin = user_id_of(client.app)
    with _db(client) as db:
        for _ in range(3):
            notify(db, admin, "kh_reconnect", {}, "#/settings/agents", dedupe_key="kh-reconnect")
            db.commit()
        assert _count(db, admin) == 1
        notify(db, admin, "lesson_ready", {"topic": "a/b"}, "#/lesson/a/b")
        db.commit()
        assert _count(db, admin) == 2
        forget(db, admin, "kh-reconnect")
        db.commit()
        notify(db, admin, "kh_reconnect", {}, "#/settings/agents", dedupe_key="kh-reconnect")
        db.commit()
        assert _count(db, admin) == 2


def test_only_in_app_links() -> None:
    with pytest.raises(ValueError):
        notify(None, None, "restored", {}, "https://evil.example/")  # type: ignore[arg-type]


def test_over_200_the_oldest_goes(client: TestClient) -> None:
    admin = user_id_of(client.app)
    with _db(client) as db:
        for n in range(KEEP_COUNT):
            notify(db, admin, "lesson_ready", {"n": n}, "#/")
            db.commit()
        oldest = db.scalars(
            select(Notification.id)
            .where(Notification.user_id == admin)
            .order_by(Notification.created_at)
            .limit(1)
        ).one()
        notify(db, admin, "lesson_ready", {"n": "new"}, "#/")
        db.commit()
        assert _count(db, admin) == KEEP_COUNT
        assert db.get(Notification, oldest) is None


def test_older_than_90_days_goes(client: TestClient) -> None:
    admin = user_id_of(client.app)
    with _db(client) as db:
        notify(db, admin, "lesson_ready", {"n": "old"}, "#/")
        db.commit()
        db.execute(update(Notification).values(created_at=func.now() - timedelta(days=91)))
        db.commit()
        notify(db, admin, "lesson_ready", {"n": "new"}, "#/")
        db.commit()
        rows = db.scalars(select(Notification.params).where(Notification.user_id == admin)).all()
    assert rows == [{"n": "new"}]


def test_a_failing_notify_does_not_fail_the_callers_commit(client: TestClient) -> None:
    admin = user_id_of(client.app)
    with _db(client) as db:
        user = db.get(User, admin)
        assert user is not None
        user.bio = "kept"
        # A user id that does not exist breaks the foreign key inside the savepoint.
        notify(db, admin.__class__(int=0), "restored", {}, "#/")
        db.commit()
        db.expire_all()
        assert db.get(User, admin).bio == "kept"  # type: ignore[union-attr]
