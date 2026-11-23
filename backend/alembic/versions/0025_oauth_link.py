"""oauth_link: a started GitHub or Google flow may link an identity to a signed-in user
(change settings-tabs)

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null for a sign-in; the user who started a link otherwise. The callback links only for
    # that same signed-in user.
    op.add_column(
        "oauth_pending",
        sa.Column(
            "link_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("oauth_pending", "link_user_id")
