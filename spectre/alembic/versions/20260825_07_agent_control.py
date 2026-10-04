"""Agent observability, approval gating, cancellation, and intelligence settings.

Revision ID: 20260825_07
Revises: 20260825_06
Create Date: 2026-08-25
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260825_07"
down_revision = "20260825_06"
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


def _has_constraint(bind, table_name, constraint_name):
    return bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints "
            "WHERE table_name=:t AND constraint_name=:c)"
        ),
        {"t": table_name, "c": constraint_name},
    ).scalar()


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("ALTER TYPE casestatus ADD VALUE IF NOT EXISTS 'CANCELLED'")

    if not _has_column(bind, "research_runs", "cancelled_at"):
        op.add_column(
            "research_runs",
            sa.Column(
                "cancelled_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )
    if not _has_column(bind, "research_runs", "settings"):
        op.add_column(
            "research_runs",
            sa.Column("settings", postgresql.JSON(), server_default=sa.text("'{}'::json")),
        )
    if not _has_column(bind, "research_cases", "agent_settings"):
        op.add_column(
            "research_cases",
            sa.Column(
                "agent_settings",
                postgresql.JSON(),
                server_default=sa.text("'{}'::json"),
            ),
        )
    if not _has_column(bind, "agent_tasks", "started_at"):
        op.add_column(
            "agent_tasks",
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        )

    for table, column in (
        ("research_cases", "owner_id"),
        ("research_runs", "requested_by_id"),
        ("artifacts", "created_by_id"),
    ):
        if _has_column(bind, table, column):
            is_nullable = bind.execute(
                sa.text(
                    "SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name=:c"
                ),
                {"t": table, "c": column},
            ).scalar()
            if is_nullable == "NO":
                op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL")
            constraint = f"{table}_{column}_fkey"
            if _has_constraint(bind, table, constraint):
                op.drop_constraint(constraint, table, type_="foreignkey")
                op.create_foreign_key(
                    constraint,
                    table,
                    "users",
                    [column],
                    ["id"],
                    ondelete="SET NULL",
                )

    if not _has_table(bind, "agent_events"):
        op.create_table(
            "agent_events",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "organization_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "run_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("research_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "task_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("agent_tasks.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("agent_name", sa.String(length=100), nullable=False),
            sa.Column("event_type", sa.String(length=32), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("payload", postgresql.JSON(), server_default=sa.text("'{}'::json")),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
    if not _has_index(bind, "ix_agent_events_run_id"):
        op.create_index("ix_agent_events_run_id", "agent_events", ["run_id"])
    if not _has_index(bind, "ix_agent_events_event_type"):
        op.create_index("ix_agent_events_event_type", "agent_events", ["event_type"])
    if not _has_index(bind, "ix_agent_events_created_at"):
        op.create_index("ix_agent_events_created_at", "agent_events", ["created_at"])

    if not _has_table(bind, "code_proposals"):
        op.create_table(
            "code_proposals",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "organization_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "case_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("research_cases.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "run_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("research_runs.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("title", sa.String(length=240), nullable=False),
            sa.Column("purpose", sa.Text(), nullable=False),
            sa.Column("code", sa.Text(), nullable=False),
            sa.Column("input_json", postgresql.JSON(), server_default=sa.text("'{}'::json")),
            sa.Column(
                "status",
                sa.Enum(
                    "PENDING",
                    "APPROVED",
                    "REJECTED",
                    "EXECUTED",
                    "FAILED",
                    name="proposalstatus",
                ),
                server_default="pending",
                nullable=False,
            ),
            sa.Column("result_payload", postgresql.JSON(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column(
                "proposed_by_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "reviewed_by_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
    if not _has_index(bind, "ix_code_proposals_organization_id"):
        op.create_index("ix_code_proposals_organization_id", "code_proposals", ["organization_id"])
    if not _has_index(bind, "ix_code_proposals_status"):
        op.create_index("ix_code_proposals_status", "code_proposals", ["status"])

    for table in ("agent_events", "code_proposals"):
        if _has_table(bind, table):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            column = "organization_id"
            op.execute(
                f"""
                DROP POLICY IF EXISTS {table}_organization_scope ON {table};
                CREATE POLICY {table}_organization_scope ON {table}
                FOR ALL
                USING ({column} = public.sentinelforge_current_organization_id())
                WITH CHECK ({column} = public.sentinelforge_current_organization_id());
                """
            )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP POLICY IF EXISTS code_proposals_organization_scope ON code_proposals")
    op.execute("DROP POLICY IF EXISTS agent_events_organization_scope ON agent_events")
    if _has_table(bind, "code_proposals"):
        op.execute("ALTER TABLE code_proposals DISABLE ROW LEVEL SECURITY")
    if _has_table(bind, "agent_events"):
        op.execute("ALTER TABLE agent_events DISABLE ROW LEVEL SECURITY")
    if _has_table(bind, "code_proposals"):
        op.drop_table("code_proposals")
    if _has_table(bind, "agent_events"):
        op.drop_table("agent_events")
    if _has_column(bind, "agent_tasks", "started_at"):
        op.drop_column("agent_tasks", "started_at")
    if _has_column(bind, "research_cases", "agent_settings"):
        op.drop_column("research_cases", "agent_settings")
    if _has_column(bind, "research_runs", "settings"):
        op.drop_column("research_runs", "settings")
    if _has_column(bind, "research_runs", "cancelled_at"):
        op.drop_column("research_runs", "cancelled_at")

    for table, column in (
        ("artifacts", "created_by_id"),
        ("research_runs", "requested_by_id"),
        ("research_cases", "owner_id"),
    ):
        if _has_table(bind, table) and _has_column(bind, table, column):
            op.execute(f"DELETE FROM {table} WHERE {column} IS NULL")
            is_nullable = bind.execute(
                sa.text(
                    "SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name=:c"
                ),
                {"t": table, "c": column},
            ).scalar()
            if is_nullable == "YES":
                op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET NOT NULL")

    constraint = "artifacts_created_by_id_fkey"
    if _has_constraint(bind, "artifacts", constraint):
        op.drop_constraint(constraint, "artifacts", type_="foreignkey")
        op.create_foreign_key(
            constraint, "artifacts", "users", ["created_by_id"], ["id"], ondelete="CASCADE"
        )
    constraint = "research_runs_requested_by_id_fkey"
    if _has_constraint(bind, "research_runs", constraint):
        op.drop_constraint(constraint, "research_runs", type_="foreignkey")
        op.create_foreign_key(
            constraint, "research_runs", "users", ["requested_by_id"], ["id"], ondelete="CASCADE"
        )
    constraint = "research_cases_owner_id_fkey"
    if _has_constraint(bind, "research_cases", constraint):
        op.drop_constraint(constraint, "research_cases", type_="foreignkey")
        op.create_foreign_key(
            constraint, "research_cases", "users", ["owner_id"], ["id"], ondelete="CASCADE"
        )
