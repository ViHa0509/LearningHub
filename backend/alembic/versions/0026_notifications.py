"""notifications: in-app notifications per user (change notifications)

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-24
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        # Structured values for the text the client builds; never markup.
        sa.Column("params", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("link", sa.Text(), nullable=False),
        sa.Column("dedupe_key", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_notifications_user_created", "notifications", ["user_id", sa.text("created_at DESC")]
    )
    op.create_index(
        "uq_notifications_user_dedupe",
        "notifications",
        ["user_id", "dedupe_key"],
        unique=True,
        postgresql_where=sa.text("dedupe_key IS NOT NULL"),
    )
    # Every public table has row level security (alembic/env.py turns it on after each run).


def downgrade() -> None:
    op.drop_index("uq_notifications_user_dedupe", table_name="notifications")
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_table("notifications")
