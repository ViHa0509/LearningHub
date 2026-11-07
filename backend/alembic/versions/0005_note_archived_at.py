"""notes can be archived

Adds the nullable ``archived_at`` timestamp to ``notes``; NULL means active.

Downgrade drops the column, which un-archives every note.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-07
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("notes", "archived_at")
