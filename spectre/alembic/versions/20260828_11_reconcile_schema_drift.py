"""Reconcile model nullability and index declarations.

Revision ID: 20260828_11
Revises: 20260827_10
Create Date: 2026-08-28
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260828_11"
down_revision = "20260827_10"
branch_labels = None
depends_on = None


def _has_column(bind: sa.Connection, table: str, column: str) -> bool:
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name=:table AND column_name=:column)"
            ),
            {"table": table, "column": column},
        ).scalar()
    )


def _has_index(bind: sa.Connection, name: str) -> bool:
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM pg_indexes "
                "WHERE schemaname='public' AND indexname=:name)"
            ),
            {"name": name},
        ).scalar()
    )


def _set_json_not_null(bind: sa.Connection, table: str, column: str) -> None:
    if not _has_column(bind, table, column):
        return
    op.execute(sa.text(f"UPDATE {table} SET {column} = '{{}}'::json WHERE {column} IS NULL"))
    op.alter_column(
        table,
        column,
        existing_type=postgresql.JSON(),
        nullable=False,
    )


def _create_index_if_missing(
    bind: sa.Connection, name: str, table: str, columns: list[str]
) -> None:
    if not _has_index(bind, name) and all(_has_column(bind, table, column) for column in columns):
        op.create_index(name, table, columns)


def _drop_index_if_present(bind: sa.Connection, name: str) -> None:
    if _has_index(bind, name):
        op.drop_index(name)


def upgrade() -> None:
    bind = op.get_bind()

    for table, column in (
        ("agent_events", "payload"),
        ("code_proposals", "input_json"),
        ("research_cases", "agent_settings"),
        ("research_runs", "settings"),
    ):
        _set_json_not_null(bind, table, column)

    for name in (
        "ix_spectre_scan_events_scan_run_sequence",
        "ix_memberships_user_organization",
    ):
        _drop_index_if_present(bind, name)

    for name, table, columns in (
        ("ix_agent_events_organization_id", "agent_events", ["organization_id"]),
        ("ix_spectre_scan_events_event_type", "spectre_scan_events", ["event_type"]),
        ("ix_spectre_scan_events_scan_run_id", "spectre_scan_events", ["scan_run_id"]),
        ("ix_spectre_scan_events_sequence", "spectre_scan_events", ["sequence"]),
        ("ix_repository_snapshots_content_hash", "repository_snapshots", ["content_hash"]),
    ):
        _create_index_if_missing(bind, name, table, columns)


def downgrade() -> None:
    bind = op.get_bind()

    for name in (
        "ix_agent_events_organization_id",
        "ix_spectre_scan_events_event_type",
        "ix_spectre_scan_events_scan_run_id",
        "ix_spectre_scan_events_sequence",
        "ix_repository_snapshots_content_hash",
    ):
        _drop_index_if_present(bind, name)

    _create_index_if_missing(
        bind,
        "ix_spectre_scan_events_scan_run_sequence",
        "spectre_scan_events",
        ["scan_run_id", "sequence"],
    )
    _create_index_if_missing(
        bind,
        "ix_memberships_user_organization",
        "memberships",
        ["user_id", "organization_id"],
    )

    for table, column in (
        ("agent_events", "payload"),
        ("code_proposals", "input_json"),
        ("research_cases", "agent_settings"),
        ("research_runs", "settings"),
    ):
        if _has_column(bind, table, column):
            op.alter_column(
                table,
                column,
                existing_type=postgresql.JSON(),
                nullable=True,
            )
