"""agent_disabled_tools: the tools a user removed from an agent (change agent-tools-tab)

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null or empty: every tool of the agent is attached (a tool added later is attached too).
    op.add_column("agent_settings", sa.Column("disabled_tools", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_settings", "disabled_tools")
