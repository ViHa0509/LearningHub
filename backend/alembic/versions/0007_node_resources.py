"""node_resources: reference links per roadmap node, synced from roadmap.sh

One row per node and URL (title, type, source file at a pinned commit). Only links are stored,
never the descriptions of the source.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-08
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "node_resources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_ref", sa.Text(), nullable=False),
        sa.Column("commit", sa.Text(), nullable=False),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("node_id", "url", name="uq_node_resources_node_url"),
    )
    op.create_index("ix_node_resources_node_id", "node_resources", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_node_resources_node_id", table_name="node_resources")
    op.drop_table("node_resources")
