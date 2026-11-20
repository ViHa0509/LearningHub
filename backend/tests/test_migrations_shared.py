"""Migrations 0021 (shared providers) and 0022 (user time zone)."""

from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import TEST_DATABASE_URL, alembic_config

USER = "00000000-0000-0000-0000-000000000003"
PROVIDER = "00000000-0000-0000-0000-0000000000a3"


def test_0021_adds_shared_and_the_usage_table_and_its_downgrade_removes_them() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        shared = {c["name"]: c for c in inspector.get_columns("ai_providers")}["shared"]
        assert shared["nullable"] is False
        assert "shared_usage" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class WHERE relname = 'shared_usage' AND relrowsecurity"
                )
            ).all()
        assert locked == ["shared_usage"]
        assert inspector.get_pk_constraint("shared_usage")["constrained_columns"] == [
            "user_id",
            "day",
        ]
        keys = inspector.get_foreign_keys("shared_usage")
        assert {k["referred_table"] for k in keys} == {"users"}
        assert all(k["options"].get("ondelete") == "CASCADE" for k in keys)
        assert {c["name"] for c in inspector.get_columns("shared_usage")} == {
            "user_id",
            "day",
            "runs",
        }
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO users (id, email, role) VALUES ('{USER}', 's@x.test', 'admin')")
            )
            connection.execute(
                text(
                    "INSERT INTO ai_providers (id, user_id, name, provider_type, model_name, "
                    f"config, is_active) VALUES ('{PROVIDER}', '{USER}', 'P', 'local', 'm', "
                    "'{}', true)"
                )
            )
            # An existing or new configuration is private unless shared.
            private = connection.execute(text("SELECT shared FROM ai_providers")).scalar()
            assert private is False
            connection.execute(
                text(
                    "INSERT INTO shared_usage (user_id, day, runs) "
                    f"VALUES ('{USER}', '2026-11-19', 1)"
                )
            )
        try:
            with engine.begin() as connection:
                connection.execute(text("UPDATE shared_usage SET runs = -1"))
            raise AssertionError("a negative count must be refused")
        except IntegrityError:
            pass
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM users"))
            left = connection.execute(text("SELECT count(*) FROM shared_usage")).scalar()
            assert left == 0
        command.downgrade(config, "0020")
        inspector = inspect(engine)
        assert "shared_usage" not in inspector.get_table_names()
        assert "shared" not in {c["name"] for c in inspector.get_columns("ai_providers")}
    finally:
        command.upgrade(config, "head")
        engine.dispose()


def test_0022_adds_the_user_time_zone_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        column = {c["name"]: c for c in inspect(engine).get_columns("users")}["timezone"]
        assert column["nullable"] is True
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO users (id, email, role) VALUES ('{USER}', 't@x.test', 'member')")
            )
            zone = connection.execute(text("SELECT timezone FROM users")).scalar()
            assert zone is None
            connection.execute(text("DELETE FROM users"))
        command.downgrade(config, "0021")
        assert "timezone" not in {c["name"] for c in inspect(engine).get_columns("users")}
    finally:
        command.upgrade(config, "head")
        engine.dispose()
