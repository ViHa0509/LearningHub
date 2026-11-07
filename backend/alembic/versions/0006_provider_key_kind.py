"""provider configurations record which kind of key they hold

Adds the nullable ``key_kind`` text to ``ai_providers``: ``api_key`` or ``setup_token``
(a Claude setup token). NULL on rows saved before this revision is read as ``api_key``.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-07
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_providers", sa.Column("key_kind", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_providers", "key_kind")
