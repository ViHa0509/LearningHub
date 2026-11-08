"""Migrations upgrade and downgrade cleanly; 0004 moves saved provider settings."""

import uuid

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
        assert set(settings) == {"agent_id", "web_search", "updated_at"}
        assert settings["web_search"]["nullable"] is False
        assert inspect(engine).get_pk_constraint("agent_settings")["constrained_columns"] == [
            "agent_id"
        ]
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO agent_settings (agent_id) VALUES ('probe')"))
            stored = connection.execute(
                text("SELECT web_search FROM agent_settings WHERE agent_id = 'probe'")
            ).scalar()
            connection.execute(text("DELETE FROM agent_settings"))
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
        assert role == "owner"
        # One owner at most, and emails only in lower case.
        for statement in (
            "INSERT INTO users (id, email) VALUES (gen_random_uuid(), 'b@x.test')",
            "INSERT INTO users (id, email, role) VALUES (gen_random_uuid(), 'C@x.test', 'x')",
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
