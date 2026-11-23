"""Migration 0025: oauth_pending.link_user_id (change settings-tabs)."""

from alembic import command
from sqlalchemy import create_engine, inspect

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_0025_adds_link_user_id_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        columns = {c["name"]: c for c in inspect(engine).get_columns("oauth_pending")}
        assert columns["link_user_id"]["nullable"] is True
        keys = inspect(engine).get_foreign_keys("oauth_pending")
        assert any(
            k["referred_table"] == "users"
            and k["constrained_columns"] == ["link_user_id"]
            and k["options"].get("ondelete") == "CASCADE"
            for k in keys
        )

        command.downgrade(config, "0024")
        names = {c["name"] for c in inspect(engine).get_columns("oauth_pending")}
        assert "link_user_id" not in names
    finally:
        command.upgrade(config, "head")
        engine.dispose()
