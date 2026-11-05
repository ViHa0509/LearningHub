"""Task 3.1: the notes migration upgrades and downgrades cleanly."""

from alembic import command
from sqlalchemy import create_engine, inspect

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_downgrade_base_then_upgrade_head() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.downgrade(config, "base")
        assert "notes" not in inspect(engine).get_table_names()
        command.upgrade(config, "head")
        assert "notes" in inspect(engine).get_table_names()
        columns = {c["name"] for c in inspect(engine).get_columns("notes")}
        assert {"id", "title", "body_text", "content_sha256", "storage_key", "node_id"} <= columns
    finally:
        command.upgrade(config, "head")
        engine.dispose()
