"""Migration 0023: the a2ui_surfaces table (change a2ui-chat-agent)."""

from alembic import command
from sqlalchemy import create_engine, inspect, text

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_0023_creates_a2ui_surfaces_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        assert "a2ui_surfaces" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class "
                    "WHERE relname = 'a2ui_surfaces' AND relrowsecurity"
                )
            ).all()
        assert locked == ["a2ui_surfaces"]
        columns = {c["name"]: c for c in inspector.get_columns("a2ui_surfaces")}
        assert set(columns) == {
            "id",
            "user_id",
            "message_id",
            "kind",
            "title",
            "messages",
            "answer_key",
            "answers",
            "created_at",
        }
        assert columns["message_id"]["nullable"] is True
        assert columns["user_id"]["nullable"] is False
        keys = {k["referred_table"]: k for k in inspector.get_foreign_keys("a2ui_surfaces")}
        assert set(keys) == {"users", "chat_messages"}
        assert all(k["options"].get("ondelete") == "CASCADE" for k in keys.values())
        indexes = {i["name"] for i in inspector.get_indexes("a2ui_surfaces")}
        assert {"ix_a2ui_surfaces_user_id", "ix_a2ui_surfaces_message_id"} <= indexes

        command.downgrade(config, "0022")
        assert "a2ui_surfaces" not in inspect(engine).get_table_names()
    finally:
        command.upgrade(config, "head")
        engine.dispose()
