"""users.timezone: the IANA time zone a user chose for the UI (null until chosen)

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("timezone", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "timezone")
