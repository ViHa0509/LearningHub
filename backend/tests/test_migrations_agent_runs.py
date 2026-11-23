"""Migration 0024: the agent_runs table (change agent-stop)."""

from alembic import command
from sqlalchemy import create_engine, inspect, text

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_0024_creates_agent_runs_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        assert "agent_runs" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text("SELECT relname FROM pg_class WHERE relname = 'agent_runs' AND relrowsecurity")
            ).all()
        assert locked == ["agent_runs"]
        columns = {c["name"]: c for c in inspector.get_columns("agent_runs")}
        assert set(columns) == {"id", "user_id", "started_at", "stop_requested_at"}
        assert columns["user_id"]["nullable"] is False
        assert columns["stop_requested_at"]["nullable"] is True
        (key,) = inspector.get_foreign_keys("agent_runs")
        assert key["referred_table"] == "users"
        assert key["options"].get("ondelete") == "CASCADE"

        command.downgrade(config, "0023")
        assert "agent_runs" not in inspect(engine).get_table_names()
    finally:
        command.upgrade(config, "head")
        engine.dispose()
