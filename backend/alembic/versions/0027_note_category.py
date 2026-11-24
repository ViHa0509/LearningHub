"""note_category: a name grouping a note while it is unsorted (change unsorted-categories)

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("category", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("notes", "category")
