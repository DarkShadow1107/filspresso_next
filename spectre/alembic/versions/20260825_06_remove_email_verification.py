"""Remove local email verification state.

Revision ID: 20260825_06
Revises: 20260825_05
Create Date: 2026-08-25
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260825_06"
down_revision = "20260825_05"
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
    if _has_table(bind, "email_verification_tokens"):
        op.drop_table("email_verification_tokens")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at")


def downgrade() -> None:
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
    if _has_table(bind, "email_verification_tokens"):
        op.execute("ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE email_verification_tokens FORCE ROW LEVEL SECURITY")
        op.execute(
            """
            DROP POLICY IF EXISTS email_verification_tokens_user_scope ON email_verification_tokens;
            CREATE POLICY email_verification_tokens_user_scope ON email_verification_tokens
            FOR ALL
            USING (user_id = public.sentinelforge_current_user_id())
            WITH CHECK (user_id = public.sentinelforge_current_user_id());
            """
        )
