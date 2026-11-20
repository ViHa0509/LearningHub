"""shared providers: ai_providers.shared and the per-user daily count of shared requests

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A configuration is private unless the admin shares it.
    op.add_column(
        "ai_providers",
        sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # One row per user and UTC day: agent requests run on shared configurations.
    # RLS is switched on by alembic/env.py.
    op.create_table(
        "shared_usage",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("runs", sa.Integer(), nullable=False),
        sa.CheckConstraint("runs >= 0", name="ck_shared_usage_runs"),
    )


def downgrade() -> None:
    op.drop_table("shared_usage")
    op.drop_column("ai_providers", "shared")
