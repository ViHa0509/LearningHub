"""named AI provider configurations and agent assignments

Creates ``ai_providers`` and ``agent_providers``, moves every saved ``provider_configs``
row with a key or a URL into a named configuration (the encrypted key is copied unchanged),
assigns the first of them as primary of both agents, and drops ``provider_configs``.

Downgrade recreates ``provider_configs`` EMPTY and drops the new tables: saved provider
settings are lost on downgrade and must be entered again.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-07
"""

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

AGENTS = ("assistant", "lesson-writer")

# Old vendor slot -> (name, type, default model, fixed base URL). Order decides the primary.
OLD_SLOTS = (
    ("anthropic", "Anthropic", "anthropic", "claude-sonnet-5-5", None),
    ("openai", "OpenAI", "openai", "gpt-5.5", None),
    ("deepseek", "DeepSeek", "custom", "deepseek-chat", "https://api.deepseek.com"),
    ("ollama", "Ollama", "local", "gemma3", None),
)


def _ollama_url(url: str) -> str:
    url = url.strip().rstrip("/")
    return url if url.endswith("/v1") else url + "/v1"


def upgrade() -> None:
    op.create_table(
        "ai_providers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False, unique=True),
        sa.Column("provider_type", sa.Text(), nullable=False),
        sa.Column("model_name", sa.Text(), nullable=False),
        sa.Column("api_key_enc", sa.Text(), nullable=True),
        sa.Column("key_hint", sa.Text(), nullable=True),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column(
            "config",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_test_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_test_status", sa.Text(), nullable=True),
        sa.Column("last_test_message", sa.Text(), nullable=True),
        sa.Column("last_test_latency_ms", sa.Integer(), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "agent_providers",
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column(
            "provider_id",
            sa.Uuid(),
            sa.ForeignKey("ai_providers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("agent_id", "role"),
        sa.CheckConstraint("role IN ('primary', 'fallback')", name="ck_agent_providers_role"),
    )

    bind = op.get_bind()
    rows = {
        row.provider_id: row
        for row in bind.execute(
            sa.text(
                "SELECT provider_id, api_key_enc, key_hint, base_url, model, enabled "
                "FROM provider_configs"
            )
        )
    }
    first: uuid.UUID | None = None
    for slot, name, provider_type, default_model, fixed_url in OLD_SLOTS:
        row = rows.get(slot)
        if row is None:
            continue
        if slot == "ollama":
            if not (row.base_url or "").strip():
                continue
            base_url: str | None = _ollama_url(row.base_url)
        else:
            if not row.api_key_enc:
                continue
            base_url = fixed_url
        new_id = uuid.uuid4()
        bind.execute(
            sa.text(
                "INSERT INTO ai_providers (id, name, provider_type, model_name, api_key_enc, "
                "key_hint, base_url, is_active) VALUES (:id, :name, :type, :model, :key, "
                ":hint, :url, :active)"
            ),
            {
                "id": new_id,
                "name": name,
                "type": provider_type,
                "model": row.model or default_model,
                "key": row.api_key_enc if slot != "ollama" else None,
                "hint": row.key_hint if slot != "ollama" else None,
                "url": base_url,
                "active": bool(row.enabled),
            },
        )
        if first is None:
            first = new_id
    if first is not None:
        for agent_id in AGENTS:
            bind.execute(
                sa.text(
                    "INSERT INTO agent_providers (agent_id, role, provider_id) "
                    "VALUES (:agent, 'primary', :id)"
                ),
                {"agent": agent_id, "id": first},
            )
    op.drop_table("provider_configs")


def downgrade() -> None:
    op.drop_table("agent_providers")
    op.drop_table("ai_providers")
    op.create_table(
        "provider_configs",
        sa.Column("provider_id", sa.Text(), primary_key=True),
        sa.Column("api_key_enc", sa.Text(), nullable=True),
        sa.Column("key_hint", sa.Text(), nullable=True),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
