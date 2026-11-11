"""multi-user: admin and members, invitations, personal data per user

Users: ``owner`` becomes ``admin`` (one at most), plus ``disabled_at`` and ``placeholder``.
New table ``invitations``. ``user_id`` on notes, lessons, ai_providers, agent_providers,
agent_settings and sync_keys is filled with the admin's id (a placeholder admin
``admin@localhost.invalid`` is inserted first when data exists but no user does, which is a
server that ran with the login off); unique keys and primary keys become per user.

Downgrade is refused when more than one user exists (their data cannot be merged back).
Take a backup before upgrading.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-10
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

PLACEHOLDER_EMAIL = "admin@localhost.invalid"
DATA_TABLES = ("notes", "lessons", "ai_providers", "agent_providers", "agent_settings", "sync_keys")


def _fk_name(table: str) -> str:
    return f"fk_{table}_user_id_users"


def upgrade() -> None:
    bind = op.get_bind()

    # --- users
    op.add_column("users", sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column("placeholder", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.drop_index("uq_users_single_owner", table_name="users")
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'owner'")
    op.alter_column("users", "role", server_default="member")
    op.create_check_constraint("ck_users_role", "users", "role IN ('admin', 'member')")
    op.create_index(
        "uq_users_single_admin",
        "users",
        ["role"],
        unique=True,
        postgresql_where=sa.text("role = 'admin'"),
    )

    op.create_table(
        "invitations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "invited_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_invitations_token_hash"),
        sa.CheckConstraint("email = lower(email)", name="ck_invitations_email_lower"),
    )
    op.create_index("ix_invitations_email", "invitations", ["email"])

    # --- user_id on the personal tables, filled with the admin
    for table in DATA_TABLES:
        op.add_column(table, sa.Column("user_id", sa.Uuid(), nullable=True))

    has_rows = any(
        bind.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table})")).scalar()
        for table in DATA_TABLES
    )
    admin_id = bind.execute(sa.text("SELECT id FROM users WHERE role = 'admin'")).scalar()
    if admin_id is None and has_rows:
        admin_id = uuid.uuid4()
        bind.execute(
            sa.text(
                "INSERT INTO users (id, email, role, placeholder, preferences) "
                "VALUES (:id, :email, 'admin', true, '{}'::jsonb)"
            ),
            {"id": admin_id, "email": PLACEHOLDER_EMAIL},
        )
    for table in DATA_TABLES:
        if admin_id is not None:
            bind.execute(sa.text(f"UPDATE {table} SET user_id = :id"), {"id": admin_id})
        op.alter_column(table, "user_id", nullable=False)
        op.create_foreign_key(
            _fk_name(table), table, "users", ["user_id"], ["id"], ondelete="CASCADE"
        )
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])

    # --- keys per user
    op.drop_constraint("notes_content_sha256_key", "notes", type_="unique")
    op.create_unique_constraint("uq_notes_user_sha", "notes", ["user_id", "content_sha256"])
    op.drop_constraint("lessons_pkey", "lessons", type_="primary")
    op.create_primary_key("lessons_pkey", "lessons", ["user_id", "node_id"])
    op.drop_constraint("ai_providers_name_key", "ai_providers", type_="unique")
    op.create_unique_constraint("uq_ai_providers_user_name", "ai_providers", ["user_id", "name"])
    op.drop_constraint("agent_providers_pkey", "agent_providers", type_="primary")
    op.create_primary_key(
        "agent_providers_pkey", "agent_providers", ["user_id", "agent_id", "role"]
    )
    op.drop_constraint("agent_settings_pkey", "agent_settings", type_="primary")
    op.create_primary_key("agent_settings_pkey", "agent_settings", ["user_id", "agent_id"])


def downgrade() -> None:
    bind = op.get_bind()
    count = bind.execute(sa.text("SELECT count(*) FROM users")).scalar() or 0
    if count > 1:
        raise RuntimeError(
            "Cannot downgrade: more than one user exists and their data cannot be merged. "
            "Restore a backup taken before the upgrade instead."
        )

    op.drop_constraint("agent_settings_pkey", "agent_settings", type_="primary")
    op.create_primary_key("agent_settings_pkey", "agent_settings", ["agent_id"])
    op.drop_constraint("agent_providers_pkey", "agent_providers", type_="primary")
    op.create_primary_key("agent_providers_pkey", "agent_providers", ["agent_id", "role"])
    op.drop_constraint("uq_ai_providers_user_name", "ai_providers", type_="unique")
    op.create_unique_constraint("ai_providers_name_key", "ai_providers", ["name"])
    op.drop_constraint("lessons_pkey", "lessons", type_="primary")
    op.create_primary_key("lessons_pkey", "lessons", ["node_id"])
    op.drop_constraint("uq_notes_user_sha", "notes", type_="unique")
    op.create_unique_constraint("notes_content_sha256_key", "notes", ["content_sha256"])

    for table in DATA_TABLES:
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        op.drop_constraint(_fk_name(table), table, type_="foreignkey")
        op.drop_column(table, "user_id")

    op.drop_index("ix_invitations_email", table_name="invitations")
    op.drop_table("invitations")

    op.drop_index("uq_users_single_admin", table_name="users")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.execute("UPDATE users SET role = 'owner'")
    op.alter_column("users", "role", server_default="owner")
    op.create_index(
        "uq_users_single_owner",
        "users",
        ["role"],
        unique=True,
        postgresql_where=sa.text("role = 'owner'"),
    )
    op.drop_column("users", "placeholder")
    op.drop_column("users", "disabled_at")
