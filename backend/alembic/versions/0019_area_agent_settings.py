"""area_agent_settings: the user's extra instructions and allowed tools per area

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-16
"""

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No row = defaults (no instructions, every tool). RLS is switched on by alembic/env.py.
    op.create_table(
        "area_agent_settings",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("domain_id", sa.Text(), primary_key=True),
        sa.Column("instructions", sa.Text(), server_default="", nullable=False),
        sa.Column("tools", sa.JSON(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("area_agent_settings")
