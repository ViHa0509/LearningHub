"""Migrations upgrade and downgrade cleanly; 0004 moves saved provider settings."""

import uuid

from alembic import command
from sqlalchemy import create_engine, inspect, text

from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_downgrade_base_then_upgrade_head() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    tables = {"notes", "lessons", "ai_providers", "agent_providers", "node_resources"}
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
