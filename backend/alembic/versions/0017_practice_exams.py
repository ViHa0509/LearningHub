"""question_banks, questions, question_answers, exam_attempts: practice and mock tests

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "question_banks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "area_id",
            sa.Uuid(),
            sa.ForeignKey("learning_areas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("rules", JSONB(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_question_banks_area_id", "question_banks", ["area_id"])
    op.create_table(
        "questions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "bank_id",
            sa.Uuid(),
            sa.ForeignKey("question_banks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("topic_slug", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("options", JSONB(), nullable=False),
        sa.Column("answer", sa.Integer(), nullable=False),
        sa.Column("critical", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("image_name", sa.Text(), nullable=True),
        sa.Column("image_key", sa.Text(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.UniqueConstraint("bank_id", "number", name="uq_questions_bank_number"),
    )
    op.create_index("ix_questions_bank_id", "questions", ["bank_id"])
    op.create_index("ix_questions_image_key", "questions", ["image_key"])
    op.create_table(
        "question_answers",
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
        sa.Column("last_correct", sa.Boolean(), nullable=False),
        sa.Column("times_wrong", sa.Integer(), server_default="0", nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "exam_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bank_id",
            sa.Uuid(),
            sa.ForeignKey("question_banks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("question_ids", JSONB(), nullable=False),
        sa.Column("answers", JSONB(), server_default="{}", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("failed_on_critical", JSONB(), server_default="[]", nullable=False),
    )
    op.create_index("ix_exam_attempts_bank_id", "exam_attempts", ["bank_id"])
    op.create_index("ix_exam_attempts_user_bank", "exam_attempts", ["user_id", "bank_id"])


def downgrade() -> None:
    op.drop_table("exam_attempts")
    op.drop_table("question_answers")
    op.drop_table("questions")
    op.drop_table("question_banks")
