"""Migration 0029: the GitHub tokens table."""

from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import TEST_DATABASE_URL, alembic_config

USER = "00000000-0000-0000-0000-000000000003"


def test_0029_creates_github_tokens_and_its_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        assert "github_tokens" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class "
                    "WHERE relname = 'github_tokens' AND relrowsecurity"
                )
            ).all()
        assert locked == ["github_tokens"]
        assert inspector.get_pk_constraint("github_tokens")["constrained_columns"] == ["user_id"]
        keys = inspector.get_foreign_keys("github_tokens")
        assert {k["referred_table"] for k in keys} == {"users"}
        assert all(k["options"].get("ondelete") == "CASCADE" for k in keys)
        columns = {c["name"]: c for c in inspector.get_columns("github_tokens")}
        assert set(columns) == {"user_id", "token_enc", "token_hint", "updated_at"}
        assert not any(c["nullable"] for c in columns.values())
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO users (id, email, role) VALUES ('{USER}', 'g@x.test', 'admin')")
            )
            connection.execute(
                text(
                    "INSERT INTO github_tokens (user_id, token_enc, token_hint) "
                    f"VALUES ('{USER}', 'enc', '…abcd')"
                )
            )
        try:
            with engine.begin() as connection:
                connection.execute(text("UPDATE github_tokens SET token_enc = NULL"))
            raise AssertionError("a token row without a token must be refused")
        except IntegrityError:
            pass
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM users"))
            left = connection.execute(text("SELECT count(*) FROM github_tokens")).scalar()
            assert left == 0
        command.downgrade(config, "0028")
        assert "github_tokens" not in inspect(engine).get_table_names()
    finally:
        command.upgrade(config, "head")
        engine.dispose()
