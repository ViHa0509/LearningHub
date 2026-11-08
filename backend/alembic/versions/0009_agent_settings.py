"""agent_settings: per-agent switches (Internet search)

One row per agent id that has a saved setting; agents without a row use the defaults
(web_search off).

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-08
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_settings",
        sa.Column("agent_id", sa.Text(), primary_key=True),
        sa.Column("web_search", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("agent_settings")
