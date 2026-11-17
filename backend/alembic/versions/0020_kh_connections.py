"""kh_connections: each user's Knowledge Hub sign-in (pending device sign-in or connected)

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-17
"""

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One row per user. The device code, verifier and refresh token are Fernet-encrypted.
    # RLS is switched on by alembic/env.py.
    op.create_table(
        "kh_connections",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("device_code_enc", sa.Text(), nullable=True),
        sa.Column("verifier_enc", sa.Text(), nullable=True),
        sa.Column("user_code", sa.Text(), nullable=True),
        sa.Column("verification_uri", sa.Text(), nullable=True),
        sa.Column("verification_uri_complete", sa.Text(), nullable=True),
        sa.Column("interval", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_poll_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_token_enc", sa.Text(), nullable=True),
        sa.Column("kh_email", sa.Text(), nullable=True),
        sa.Column("personal_project", sa.Text(), nullable=True),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'connected')", name="ck_kh_connections_status"),
    )


def downgrade() -> None:
    op.drop_table("kh_connections")
