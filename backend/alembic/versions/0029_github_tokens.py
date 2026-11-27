"""github_tokens: each user's optional GitHub token for the roadmap.sh explorer

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One row per user; the token is Fernet-encrypted. RLS is switched on by alembic/env.py.
    op.create_table(
        "github_tokens",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("token_enc", sa.Text(), nullable=False),
        sa.Column("token_hint", sa.Text(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("github_tokens")
