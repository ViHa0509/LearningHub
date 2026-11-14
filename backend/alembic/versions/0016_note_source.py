"""notes.source: where a note came from (import or agent)

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-14
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notes",
        sa.Column("source", sa.Text(), nullable=False, server_default="import"),
    )


def downgrade() -> None:
    op.drop_column("notes", "source")
