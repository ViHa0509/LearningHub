"""Migration 0027: notes.category (change unsorted-categories)."""

from alembic import command
from sqlalchemy import create_engine, inspect

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_0027_adds_category_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        columns = {c["name"]: c for c in inspect(engine).get_columns("notes")}
        assert columns["category"]["nullable"] is True

        command.downgrade(config, "0026")
        assert "category" not in {c["name"] for c in inspect(engine).get_columns("notes")}
    finally:
        command.upgrade(config, "head")
        engine.dispose()
