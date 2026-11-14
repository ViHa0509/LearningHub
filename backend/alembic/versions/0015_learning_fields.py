"""learning_fields, learning_areas, learning_topics: user-made fields with their topic maps

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-14
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_fields",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("published", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_learning_fields_user_id", "learning_fields", ["user_id"])
    op.create_table(
        "learning_areas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "field_id",
            sa.Uuid(),
            sa.ForeignKey("learning_fields.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_learning_areas_field_id", "learning_areas", ["field_id"])
    op.create_table(
        "learning_topics",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "area_id",
            sa.Uuid(),
            sa.ForeignKey("learning_areas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("parent_slug", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.UniqueConstraint("area_id", "slug", name="uq_learning_topics_area_slug"),
    )
    op.create_index("ix_learning_topics_area_id", "learning_topics", ["area_id"])


def downgrade() -> None:
    op.drop_index("ix_learning_topics_area_id", table_name="learning_topics")
    op.drop_table("learning_topics")
    op.drop_index("ix_learning_areas_field_id", table_name="learning_areas")
    op.drop_table("learning_areas")
    op.drop_index("ix_learning_fields_user_id", table_name="learning_fields")
    op.drop_table("learning_fields")
