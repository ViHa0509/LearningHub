"""Migration 0019: the per-area agent settings table."""

from alembic import command
from sqlalchemy import create_engine, inspect, text

from tests.conftest import TEST_DATABASE_URL, alembic_config

USER = "00000000-0000-0000-0000-000000000001"


def test_0019_creates_area_agent_settings_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        assert "area_agent_settings" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class "
                    "WHERE relname = 'area_agent_settings' AND relrowsecurity"
                )
            ).all()
        assert locked == ["area_agent_settings"]
        pk = inspector.get_pk_constraint("area_agent_settings")
        assert set(pk["constrained_columns"]) == {"user_id", "domain_id"}
        keys = inspector.get_foreign_keys("area_agent_settings")
        assert {k["referred_table"] for k in keys} == {"users"}
        assert all(k["options"].get("ondelete") == "CASCADE" for k in keys)
        columns = {c["name"]: c for c in inspector.get_columns("area_agent_settings")}
        assert columns["tools"]["nullable"] is True
        assert columns["instructions"]["nullable"] is False
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO users (id, email, role) VALUES ('{USER}', 'p@x.test', 'admin')")
            )
            connection.execute(
                text(
                    "INSERT INTO area_agent_settings (user_id, domain_id) "
                    f"VALUES ('{USER}', 'backend')"
                )
            )
            row = connection.execute(
                text("SELECT instructions, tools, updated_at FROM area_agent_settings")
            ).one()
            assert row.instructions == "" and row.tools is None and row.updated_at is not None
            connection.execute(text("DELETE FROM users"))
            left = connection.execute(text("SELECT count(*) FROM area_agent_settings")).scalar()
            assert left == 0
        command.downgrade(config, "0018")
        assert "area_agent_settings" not in inspect(engine).get_table_names()
    finally:
        command.upgrade(config, "head")
        engine.dispose()
