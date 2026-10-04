"""Add verified account and browser session state.

Revision ID: 20260825_05
Revises: 20260825_04
Create Date: 2026-08-25
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260825_05"
down_revision = "20260825_04"
branch_labels = None
depends_on = None


def _has_table(bind, table_name):
    return bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=:t)"),
        {"t": table_name},
    ).scalar()


def _has_column(bind, table_name, column_name):
    return bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name=:t AND column_name=:c)"
        ),
        {"t": table_name, "c": column_name},
    ).scalar()


def _has_index(bind, index_name):
    return bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname=:i)"),
        {"i": index_name},
    ).scalar()


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_column(bind, "users", "email_verified_at"):
        op.add_column(
            "users",
            sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        )
    op.execute("UPDATE users SET email_verified_at = now() WHERE is_active")

    if not _has_table(bind, "email_verification_tokens"):
        op.create_table(
            "email_verification_tokens",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
    if not _has_index(bind, "ix_email_verification_tokens_user_id"):
        op.create_index(
            "ix_email_verification_tokens_user_id", "email_verification_tokens", ["user_id"]
        )
    if not _has_index(bind, "ix_email_verification_tokens_expires_at"):
        op.create_index(
            "ix_email_verification_tokens_expires_at",
            "email_verification_tokens",
            ["expires_at"],
        )

    if not _has_table(bind, "auth_sessions"):
        op.create_table(
            "auth_sessions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("refresh_token_hash", sa.String(length=64), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "last_used_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
    if not _has_index(bind, "ix_auth_sessions_user_id"):
        op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    if not _has_index(bind, "ix_auth_sessions_expires_at"):
        op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])

    for table in ("email_verification_tokens", "auth_sessions"):
        if _has_table(bind, table):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"""
                DROP POLICY IF EXISTS {table}_user_scope ON {table};
                CREATE POLICY {table}_user_scope ON {table}
                FOR ALL
                USING (user_id = public.sentinelforge_current_user_id())
                WITH CHECK (user_id = public.sentinelforge_current_user_id());
                """
            )


def downgrade() -> None:
    bind = op.get_bind()
    for table in ("auth_sessions", "email_verification_tokens"):
        op.execute(f"DROP POLICY IF EXISTS {table}_user_scope ON {table}")
        if _has_table(bind, table):
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    if _has_table(bind, "auth_sessions"):
        op.drop_table("auth_sessions")
    if _has_table(bind, "email_verification_tokens"):
        op.drop_table("email_verification_tokens")
    if _has_column(bind, "users", "email_verified_at"):
        op.drop_column("users", "email_verified_at")
