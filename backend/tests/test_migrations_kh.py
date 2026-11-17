"""Migration 0020: the Knowledge Hub connections table."""

from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import TEST_DATABASE_URL, alembic_config

USER = "00000000-0000-0000-0000-000000000002"


def test_0020_creates_kh_connections_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        assert "kh_connections" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class "
                    "WHERE relname = 'kh_connections' AND relrowsecurity"
                )
            ).all()
        assert locked == ["kh_connections"]
        assert inspector.get_pk_constraint("kh_connections")["constrained_columns"] == ["user_id"]
        keys = inspector.get_foreign_keys("kh_connections")
        assert {k["referred_table"] for k in keys} == {"users"}
        assert all(k["options"].get("ondelete") == "CASCADE" for k in keys)
        columns = {c["name"]: c for c in inspector.get_columns("kh_connections")}
        assert set(columns) == {
            "user_id",
            "status",
            "device_code_enc",
            "verifier_enc",
            "user_code",
            "verification_uri",
            "verification_uri_complete",
            "interval",
            "expires_at",
            "last_poll_at",
            "refresh_token_enc",
            "kh_email",
            "personal_project",
            "connected_at",
        }
        assert columns["status"]["nullable"] is False
        assert columns["refresh_token_enc"]["nullable"] is True
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO users (id, email, role) VALUES ('{USER}', 'k@x.test', 'admin')")
            )
            connection.execute(
                text(f"INSERT INTO kh_connections (user_id, status) VALUES ('{USER}', 'pending')")
            )
        try:
            with engine.begin() as connection:
                connection.execute(text("UPDATE kh_connections SET status = 'bogus'"))
            raise AssertionError("an unknown status must be refused")
        except IntegrityError:
            pass
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM users"))
            left = connection.execute(text("SELECT count(*) FROM kh_connections")).scalar()
            assert left == 0
        command.downgrade(config, "0019")
        assert "kh_connections" not in inspect(engine).get_table_names()
    finally:
        command.upgrade(config, "head")
        engine.dispose()
