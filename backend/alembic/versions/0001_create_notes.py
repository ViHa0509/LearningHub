"""create notes table

Revision ID: 0001
Revises:
Create Date: 2026-11-06
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("original_name", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False, unique=True),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_notes_node_id", "notes", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_notes_node_id", table_name="notes")
    op.drop_table("notes")
