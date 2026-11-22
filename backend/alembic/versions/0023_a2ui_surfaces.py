"""a2ui_surfaces: interactive A2UI surfaces of chat answers, with their answer keys

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-22
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "a2ui_surfaces",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            sa.Uuid(),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("messages", postgresql.JSONB(), nullable=False),
        sa.Column("answer_key", postgresql.JSONB(), nullable=False),
        sa.Column("answers", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_a2ui_surfaces_user_id", "a2ui_surfaces", ["user_id"])
    op.create_index("ix_a2ui_surfaces_message_id", "a2ui_surfaces", ["message_id"])
    # Every public table has row level security (alembic/env.py turns it on after each run).


def downgrade() -> None:
    op.drop_index("ix_a2ui_surfaces_message_id", table_name="a2ui_surfaces")
    op.drop_index("ix_a2ui_surfaces_user_id", table_name="a2ui_surfaces")
    op.drop_table("a2ui_surfaces")
