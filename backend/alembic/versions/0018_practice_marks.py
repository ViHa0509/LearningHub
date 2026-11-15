"""question_answers.last_choice and question_bookmarks: the chosen option and the user's bookmarks

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The option the user chose last (1-based); null for rows written before this column
    # existed and for test questions left blank.
    op.add_column("question_answers", sa.Column("last_choice", sa.Integer(), nullable=True))
    op.create_table(
        "question_bookmarks",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "question_id",
            sa.Uuid(),
            sa.ForeignKey("questions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_question_bookmarks_question_id", "question_bookmarks", ["question_id"])


def downgrade() -> None:
    op.drop_table("question_bookmarks")
    op.drop_column("question_answers", "last_choice")
