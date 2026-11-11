"""Migrations upgrade and downgrade cleanly; 0004 moves saved provider settings; 0012 gives
existing data to the admin."""

import uuid
from typing import Any

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_downgrade_base_then_upgrade_head() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    tables = {
        "notes",
        "lessons",
        "ai_providers",
        "agent_providers",
        "node_resources",
        "news_items",
        "agent_settings",
        "users",
        "oauth_accounts",
        "sessions",
        "auth_tokens",
        "app_settings",
        "sync_keys",
        "invitations",
    }
    try:
        command.downgrade(config, "base")
        assert not tables & set(inspect(engine).get_table_names())
        command.upgrade(config, "head")
        assert tables <= set(inspect(engine).get_table_names())
        assert "provider_configs" not in inspect(engine).get_table_names()
        columns = {c["name"] for c in inspect(engine).get_columns("notes")}
        assert {"id", "title", "body_text", "content_sha256", "storage_key", "node_id"} <= columns
        assert "archived_at" in columns
        resources = {c["name"] for c in inspect(engine).get_columns("node_resources")}
        assert {
            "id",
            "node_id",
            "url",
            "title",
            "type",
            "source",
            "source_ref",
            "commit",
            "fetched_at",
        } == resources
        uniques = inspect(engine).get_unique_constraints("node_resources")
        assert [u["column_names"] for u in uniques] == [["node_id", "url"]]
        indexes = inspect(engine).get_indexes("node_resources")
        assert {"name": "ix_node_resources_node_id", "column_names": ["node_id"]}.items() <= next(
            i for i in indexes if i["name"] == "ix_node_resources_node_id"
        ).items()
        news = {c["name"] for c in inspect(engine).get_columns("news_items")}
        assert news == {"id", "source", "title", "url", "published_at", "summary", "fetched_at"}
        news_uniques = inspect(engine).get_unique_constraints("news_items")
        assert [u["column_names"] for u in news_uniques] == [["url"]]
        news_indexes = {
            i["name"]: i["column_names"] for i in inspect(engine).get_indexes("news_items")
        }
        assert news_indexes["ix_news_items_published_at"] == ["published_at"]
        settings = {c["name"]: c for c in inspect(engine).get_columns("agent_settings")}
        assert set(settings) == {"user_id", "agent_id", "web_search", "updated_at"}
        assert settings["web_search"]["nullable"] is False
        assert inspect(engine).get_pk_constraint("agent_settings")["constrained_columns"] == [
            "user_id",
            "agent_id",
        ]
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, role) "
                    "VALUES ('00000000-0000-0000-0000-000000000001', 'probe@x.test', 'admin')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO agent_settings (user_id, agent_id) "
                    "VALUES ('00000000-0000-0000-0000-000000000001', 'probe')"
                )
            )
            stored = connection.execute(
                text("SELECT web_search FROM agent_settings WHERE agent_id = 'probe'")
            ).scalar()
            connection.execute(text("DELETE FROM agent_settings"))
            connection.execute(text("DELETE FROM users"))
        assert stored is False
        users = {c["name"]: c for c in inspect(engine).get_columns("users")}
        assert set(users) == {
            "id",
            "email",
            "email_verified_at",
            "display_name",
            "bio",
            "avatar_key",
            "password_hash",
            "role",
            "disabled_at",
            "placeholder",
            "preferences",
            "created_at",
        }
        assert users["password_hash"]["nullable"] is True
        assert [u["column_names"] for u in inspect(engine).get_unique_constraints("users")] == [
            ["email"]
        ]
        sessions = {c["name"] for c in inspect(engine).get_columns("sessions")}
        assert sessions == {
            "id",
            "user_id",
            "token_hash",
            "created_at",
            "last_seen_at",
            "expires_at",
            "user_agent",
            "ip",
        }
        assert [u["column_names"] for u in inspect(engine).get_unique_constraints("sessions")] == [
            ["token_hash"]
        ]
        auth_tokens = {c["name"] for c in inspect(engine).get_columns("auth_tokens")}
        assert auth_tokens == {
            "id",
            "purpose",
            "token_hash",
            "user_id",
            "email",
            "expires_at",
            "used_at",
            "created_at",
        }
        assert [
            u["column_names"] for u in inspect(engine).get_unique_constraints("auth_tokens")
        ] == [["token_hash"]]
        assert [
            u["column_names"] for u in inspect(engine).get_unique_constraints("oauth_accounts")
        ] == [["provider", "provider_user_id"]]
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE users CASCADE"))
            connection.execute(
                text("INSERT INTO users (id, email) VALUES (gen_random_uuid(), 'a@x.test')")
            )
            role = connection.execute(text("SELECT role FROM users")).scalar()
            connection.execute(
                text(
                    "INSERT INTO users (id, email, role) "
                    "VALUES (gen_random_uuid(), 'admin@x.test', 'admin')"
                )
            )
        assert role == "member"
        # One admin at most, only the two roles, and emails only in lower case.
        for statement in (
            "INSERT INTO users (id, email, role) VALUES (gen_random_uuid(), 'b@x.test', 'admin')",
            "INSERT INTO users (id, email, role) VALUES (gen_random_uuid(), 'c@x.test', 'owner')",
            "INSERT INTO users (id, email, role) VALUES (gen_random_uuid(), 'C@x.test', 'member')",
        ):
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement))
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE users CASCADE"))
        command.downgrade(config, "0009")
        assert not {"users", "oauth_accounts", "sessions", "auth_tokens"} & set(
            inspect(engine).get_table_names()
        )
        assert "agent_settings" in inspect(engine).get_table_names()
        command.downgrade(config, "0008")
        assert "agent_settings" not in inspect(engine).get_table_names()
        assert "news_items" in inspect(engine).get_table_names()
        command.downgrade(config, "0007")
        assert "news_items" not in inspect(engine).get_table_names()
        assert "node_resources" in inspect(engine).get_table_names()
        command.downgrade(config, "0006")
        assert "node_resources" not in inspect(engine).get_table_names()
        assert "notes" in inspect(engine).get_table_names()
        command.downgrade(config, "0004")
        assert "archived_at" not in {c["name"] for c in inspect(engine).get_columns("notes")}
    finally:
        command.upgrade(config, "head")
        engine.dispose()


# Requirement: Existing settings are carried over (migration part)
def test_0004_moves_saved_providers_and_assigns_the_first() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE notes, lessons, agent_providers, ai_providers"))
        command.downgrade(config, "0003")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO provider_configs "
                    "(provider_id, api_key_enc, key_hint, base_url, model, enabled) VALUES "
                    "('anthropic', 'gAAAA-token', '…1234', NULL, 'claude-haiku-5-5', true), "
                    "('openai', NULL, NULL, NULL, 'gpt-5.5', true), "
                    "('deepseek', 'gAAAA-ds', '…9999', NULL, NULL, false), "
                    "('ollama', NULL, NULL, 'http://localhost:11434/', NULL, true)"
                )
            )
        command.upgrade(config, "0004")
        with engine.connect() as connection:
            rows = {
                r.name: r
                for r in connection.execute(
                    text(
                        "SELECT id, name, provider_type, model_name, api_key_enc, key_hint, "
                        "base_url, is_active, config FROM ai_providers"
                    )
                )
            }
            assigned = list(
                connection.execute(
                    text("SELECT agent_id, role, provider_id FROM agent_providers ORDER BY 1")
                )
            )
        # OpenAI had no key: not moved.
        assert set(rows) == {"Anthropic", "DeepSeek", "Ollama"}
        anthropic = rows["Anthropic"]
        assert (anthropic.provider_type, anthropic.model_name) == ("anthropic", "claude-haiku-5-5")
        assert (anthropic.api_key_enc, anthropic.key_hint) == ("gAAAA-token", "…1234")
        assert anthropic.is_active is True and anthropic.config == {}
        deepseek = rows["DeepSeek"]
        assert (deepseek.provider_type, deepseek.base_url, deepseek.model_name) == (
            "custom",
            "https://api.deepseek.com",
            "deepseek-chat",
        )
        assert deepseek.is_active is False
        ollama = rows["Ollama"]
        assert (ollama.provider_type, ollama.base_url, ollama.api_key_enc) == (
            "local",
            "http://localhost:11434/v1",
            None,
        )
        assert [(a.agent_id, a.role, a.provider_id) for a in assigned] == [
            ("assistant", "primary", anthropic.id),
            ("lesson-writer", "primary", anthropic.id),
        ]
        assert isinstance(anthropic.id, uuid.UUID)
        assert "provider_configs" not in inspect(engine).get_table_names()

        command.downgrade(config, "0003")
        names = set(inspect(engine).get_table_names())
        assert "provider_configs" in names
        assert not {"ai_providers", "agent_providers"} & names
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM provider_configs")).scalar() == 0
    finally:
        command.upgrade(config, "head")
        engine.dispose()


def test_every_table_has_row_level_security_after_upgrade() -> None:
    """A hosted Postgres (Supabase) exposes the public schema through its own API: every table
    is locked with RLS after an upgrade, which the app's owner role is not restricted by."""
    command.upgrade(alembic_config(), "head")
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        open_tables = connection.scalars(
            text(
                "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity"
            )
        ).all()
        notes = connection.scalar(text("SELECT count(*) FROM notes"))
    engine.dispose()
    assert open_tables == []
    assert notes is not None


def test_upgrade_with_a_url_encoded_password(monkeypatch: pytest.MonkeyPatch) -> None:
    """A '%' in LH_DATABASE_URL (URL-encoded password) must not break Alembic's config."""
    from alembic.config import Config

    from app.config import get_settings

    # '%6C' is 'l': the same password, written URL-encoded.
    encoded = TEST_DATABASE_URL.replace(":learninghub@", ":%6Cearninghub@")
    monkeypatch.setenv("LH_DATABASE_URL", encoded)
    get_settings.cache_clear()
    try:
        config = Config(alembic_config().config_file_name)
        config.set_main_option(
            "script_location", alembic_config().get_main_option("script_location") or ""
        )
        command.upgrade(config, "head")
    finally:
        get_settings.cache_clear()


# --- 0012: existing data goes to the admin -------------------------------------------------------

OWNER_ID = "00000000-0000-0000-0000-0000000000a1"
PERSONAL_TABLES = (
    "notes",
    "lessons",
    "ai_providers",
    "agent_providers",
    "agent_settings",
    "sync_keys",
)


def seed_0011(connection: Any) -> None:
    """One row in every personal table, written against the schema of revision 0011."""
    sha = "a" * 64
    connection.execute(
        text(
            "INSERT INTO notes (id, title, body_text, original_name, size_bytes, content_sha256, "
            "storage_key) VALUES (gen_random_uuid(), 'Old', 'text', 'old.html', 4, "
            f"'{sha}', 'blobs/old')"
        )
    )
    connection.execute(
        text("INSERT INTO lessons (node_id, body, source) VALUES ('devops/docker', '# L', 'user')")
    )
    connection.execute(
        text(
            "INSERT INTO ai_providers (id, name, provider_type, model_name) VALUES "
            "('00000000-0000-0000-0000-0000000000b1', 'Claude', 'anthropic', 'claude-x')"
        )
    )
    connection.execute(
        text(
            "INSERT INTO agent_providers (agent_id, role, provider_id) VALUES "
            "('assistant', 'primary', '00000000-0000-0000-0000-0000000000b1')"
        )
    )
    connection.execute(text("INSERT INTO agent_settings (agent_id) VALUES ('assistant')"))
    connection.execute(
        text(
            "INSERT INTO sync_keys (id, token_hash, expires_at) "
            "VALUES (gen_random_uuid(), 'h', now() + interval '1 day')"
        )
    )


# Scenario: Existing data kept
def test_0012_gives_existing_data_to_the_owner_who_becomes_admin() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.downgrade(config, "0011")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, email_verified_at) "
                    f"VALUES ('{OWNER_ID}', 'owner@x.test', now())"
                )
            )
            assert connection.execute(text("SELECT role FROM users")).scalar() == "owner"
            seed_0011(connection)
        command.upgrade(config, "0012")
        with engine.connect() as connection:
            [user] = connection.execute(text("SELECT id, role, placeholder FROM users")).all()
            assert (str(user.id), user.role, user.placeholder) == (OWNER_ID, "admin", False)
            for table in PERSONAL_TABLES:
                owners = connection.execute(text(f"SELECT DISTINCT user_id FROM {table}")).all()
                assert [str(o.user_id) for o in owners] == [OWNER_ID], table
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE users CASCADE"))
        command.upgrade(config, "head")
        engine.dispose()


# Scenario: Existing data kept (a server that ran with the login off has no user yet)
def test_0012_inserts_a_placeholder_admin_when_data_exists_but_no_user() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.downgrade(config, "0011")
        with engine.begin() as connection:
            seed_0011(connection)
        command.upgrade(config, "0012")
        with engine.connect() as connection:
            [user] = connection.execute(
                text("SELECT id, email, role, placeholder, password_hash FROM users")
            ).all()
            assert (user.email, user.role, user.placeholder) == (
                "admin@localhost.invalid",
                "admin",
                True,
            )
            assert user.password_hash is None
            for table in PERSONAL_TABLES:
                owned = connection.execute(
                    text(f"SELECT count(*) FROM {table} WHERE user_id = :id"), {"id": user.id}
                ).scalar()
                orphans = connection.execute(
                    text(f"SELECT count(*) FROM {table} WHERE user_id IS NULL")
                ).scalar()
                assert (owned, orphans) == (1, 0), table
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE users CASCADE"))
        command.upgrade(config, "head")
        engine.dispose()


def test_0012_creates_no_user_on_an_empty_database() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.downgrade(config, "0011")
        command.upgrade(config, "0012")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM users")).scalar() == 0
    finally:
        command.upgrade(config, "head")
        engine.dispose()


def test_0012_downgrade_is_refused_with_more_than_one_user() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, role) VALUES "
                    "(gen_random_uuid(), 'a@x.test', 'admin'), "
                    "(gen_random_uuid(), 'm@x.test', 'member')"
                )
            )
        with pytest.raises(RuntimeError, match="more than one user"):
            command.downgrade(config, "0011")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM users")).scalar() == 2
        assert "invitations" in inspect(engine).get_table_names()
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE users CASCADE"))
        command.upgrade(config, "head")
        engine.dispose()
