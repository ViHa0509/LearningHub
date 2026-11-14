"""Migration 0015: the learning field tables."""

from alembic import command
from sqlalchemy import create_engine, inspect, text

from tests.conftest import TEST_DATABASE_URL, alembic_config

USER = "00000000-0000-0000-0000-000000000001"
FIELD = "00000000-0000-0000-0000-0000000000f1"
AREA = "00000000-0000-0000-0000-0000000000a1"
TOPIC = "00000000-0000-0000-0000-0000000000b1"


def test_0015_creates_the_learning_tables_and_its_downgrade_removes_them() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    tables = {"learning_fields", "learning_areas", "learning_topics"}
    try:
        command.upgrade(config, "head")
        assert tables <= set(inspect(engine).get_table_names())
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class WHERE relname IN ('learning_fields', "
                    "'learning_areas', 'learning_topics') AND relrowsecurity"
                )
            ).all()
        assert set(locked) == tables
        area_uniques = inspect(engine).get_unique_constraints("learning_areas")
        assert ["slug"] in [u["column_names"] for u in area_uniques]
        topic_uniques = inspect(engine).get_unique_constraints("learning_topics")
        assert ["area_id", "slug"] in [u["column_names"] for u in topic_uniques]
        for table, referred in (
            ("learning_fields", "users"),
            ("learning_areas", "learning_fields"),
            ("learning_topics", "learning_areas"),
        ):
            key = inspect(engine).get_foreign_keys(table)[0]
            assert key["referred_table"] == referred
            assert key["options"].get("ondelete") == "CASCADE"
        # Deleting the user removes their fields, areas and topics.
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO users (id, email, role) VALUES ('{USER}', 'p@x.test', 'admin')")
            )
            connection.execute(
                text(
                    "INSERT INTO learning_fields (id, user_id, title) "
                    f"VALUES ('{FIELD}', '{USER}', 'Cloud')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO learning_areas (id, field_id, slug, title) "
                    f"VALUES ('{AREA}', '{FIELD}', 'aws', 'AWS')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO learning_topics (id, area_id, slug, title) "
                    f"VALUES ('{TOPIC}', '{AREA}', 'iam', 'IAM')"
                )
            )
            connection.execute(text("DELETE FROM users"))
            left = [
                connection.execute(text(f"SELECT count(*) FROM {t}")).scalar()
                for t in sorted(tables)
            ]
        assert left == [0, 0, 0]
        command.downgrade(config, "0014")
        assert not tables & set(inspect(engine).get_table_names())
    finally:
        command.upgrade(config, "head")
        engine.dispose()
