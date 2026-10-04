"""Add opt-in private user memory.

Revision ID: 20260826_08
Revises: 20260825_07
Create Date: 2026-08-26
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260826_08"
down_revision = "20260825_07"
branch_labels = None
depends_on = None


def _has_table(bind, table_name):
    return bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=:t)"),
        {"t": table_name},
    ).scalar()


def _has_index(bind, index_name):
    return bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname=:i)"),
        {"i": index_name},
    ).scalar()


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_table(bind, "user_memory_preferences"):
        op.create_table(
            "user_memory_preferences",
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    if not _has_table(bind, "user_memory_records"):
        op.create_table(
            "user_memory_records",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("title", sa.String(length=500), nullable=True),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("source_url", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    if not _has_index(bind, "ix_user_memory_records_user_id"):
        op.create_index("ix_user_memory_records_user_id", "user_memory_records", ["user_id"])

    for table in ("user_memory_preferences", "user_memory_records"):
        if _has_table(bind, table):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"""
                DROP POLICY IF EXISTS {table}_owner_scope ON {table};
                CREATE POLICY {table}_owner_scope ON {table}
                FOR ALL
                USING (user_id = public.sentinelforge_current_user_id())
                WITH CHECK (user_id = public.sentinelforge_current_user_id());
                """
            )

    op.execute(
        """
        DROP POLICY IF EXISTS audit_events_private_memory_insert ON audit_events;
        CREATE POLICY audit_events_private_memory_insert ON audit_events
        FOR INSERT
        WITH CHECK (
            organization_id IS NULL
            AND actor_id = public.sentinelforge_current_user_id()
            AND action LIKE 'user_memory.%'
        );
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP POLICY IF EXISTS audit_events_private_memory_insert ON audit_events")
    for table in ("user_memory_records", "user_memory_preferences"):
        op.execute(f"DROP POLICY IF EXISTS {table}_owner_scope ON {table}")
        if _has_table(bind, table):
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    if _has_index(bind, "ix_user_memory_records_user_id"):
        op.drop_index("ix_user_memory_records_user_id", table_name="user_memory_records")
    if _has_table(bind, "user_memory_records"):
        op.drop_table("user_memory_records")
    if _has_table(bind, "user_memory_preferences"):
        op.drop_table("user_memory_preferences")
