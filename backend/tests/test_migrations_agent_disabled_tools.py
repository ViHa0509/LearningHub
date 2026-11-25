"""Migration 0028: agent_settings.disabled_tools (change agent-tools-tab)."""

from alembic import command
from sqlalchemy import create_engine, inspect

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_0028_adds_disabled_tools_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        columns = {c["name"]: c for c in inspect(engine).get_columns("agent_settings")}
        assert columns["disabled_tools"]["nullable"] is True

        command.downgrade(config, "0027")
        names = {c["name"] for c in inspect(engine).get_columns("agent_settings")}
        assert "disabled_tools" not in names
    finally:
        command.upgrade(config, "head")
        engine.dispose()
