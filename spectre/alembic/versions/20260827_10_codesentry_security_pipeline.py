"""Add the Spectre repository security pipeline.

Revision ID: 20260827_10
Revises: 20260826_09
Create Date: 2026-08-27
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260827_10"
down_revision = "20260826_09"
branch_labels = None
depends_on = None


def _has_table(bind: sa.Connection, table_name: str) -> bool:
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name=:table_name)"
            ),
            {"table_name": table_name},
        ).scalar()
    )


def _has_index(bind: sa.Connection, index_name: str) -> bool:
    return bool(
        bind.execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname=:index_name)"),
            {"index_name": index_name},
        ).scalar()
    )


def _has_constraint(bind: sa.Connection, constraint_name: str) -> bool:
    return bool(
        bind.execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=:constraint_name)"),
            {"constraint_name": constraint_name},
        ).scalar()
    )


def _create_index_if_missing(
    bind: sa.Connection, name: str, table: str, columns: list[str]
) -> None:
    if not _has_index(bind, name):
        op.create_index(name, table, columns)


def _enable_scope(bind: sa.Connection, table: str) -> None:
    if not _has_table(bind, table):
        return
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_organization_scope ON {table}")
    op.execute(
        f"""
        CREATE POLICY {table}_organization_scope ON {table}
        FOR ALL
        USING (organization_id = public.sentinelforge_current_organization_id())
        WITH CHECK (organization_id = public.sentinelforge_current_organization_id())
        """
    )


def upgrade() -> None:
    bind = op.get_bind()
    uuid_type = postgresql.UUID(as_uuid=True)
    json_type = postgresql.JSON()
    now = sa.text("now()")
    empty_json = sa.text("'{}'::json")

    if not _has_table(bind, "repository_snapshots"):
        op.create_table(
            "repository_snapshots",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "repository_id",
                uuid_type,
                sa.ForeignKey("repositories.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("commit_sha", sa.String(64), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("source", sa.String(40), server_default="git", nullable=False),
            sa.Column("storage_key", sa.Text(), nullable=True),
            sa.Column("manifest", json_type, server_default=empty_json, nullable=False),
            sa.Column("file_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("total_bytes", sa.Integer(), server_default="0", nullable=False),
            sa.Column(
                "captured_at", sa.DateTime(timezone=True), server_default=now, nullable=False
            ),
        )

    if not _has_table(bind, "repository_files"):
        op.create_table(
            "repository_files",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "snapshot_id",
                uuid_type,
                sa.ForeignKey("repository_snapshots.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("path", sa.Text(), nullable=False),
            sa.Column("language", sa.String(40), server_default="text", nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            sa.Column("line_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("content_storage_key", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
            sa.UniqueConstraint("snapshot_id", "path", name="uq_repository_file_snapshot_path"),
        )

    if not _has_table(bind, "codesentry_scan_runs"):
        op.create_table(
            "codesentry_scan_runs",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "repository_id",
                uuid_type,
                sa.ForeignKey("repositories.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "snapshot_id",
                uuid_type,
                sa.ForeignKey("repository_snapshots.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "requested_by_id",
                uuid_type,
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("status", sa.String(32), server_default="queued", nullable=False),
            sa.Column("current_stage", sa.String(80), server_default="queued", nullable=False),
            sa.Column("settings", json_type, server_default=empty_json, nullable=False),
            sa.Column("summary", json_type, server_default=empty_json, nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        )

    if not _has_table(bind, "codesentry_findings"):
        op.create_table(
            "codesentry_findings",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "scan_run_id",
                uuid_type,
                sa.ForeignKey("codesentry_scan_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "snapshot_id",
                uuid_type,
                sa.ForeignKey("repository_snapshots.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "repository_file_id",
                uuid_type,
                sa.ForeignKey("repository_files.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source", sa.String(40), nullable=False),
            sa.Column("rule_id", sa.String(160), nullable=False),
            sa.Column("cwe", sa.String(32), nullable=True),
            sa.Column("severity", sa.String(16), nullable=False),
            sa.Column("title", sa.String(500), nullable=False),
            sa.Column("description", sa.Text(), server_default="", nullable=False),
            sa.Column("evidence", sa.Text(), server_default="", nullable=False),
            sa.Column("line_start", sa.Integer(), nullable=True),
            sa.Column("line_end", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(32), server_default="open", nullable=False),
            sa.Column("llm_verdict", sa.String(32), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=True),
            sa.Column("fingerprint", sa.String(64), nullable=False),
            sa.Column("raw_payload", json_type, server_default=empty_json, nullable=False),
            sa.Column(
                "poc_artifact_id",
                uuid_type,
                sa.ForeignKey("artifacts.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
            sa.UniqueConstraint(
                "scan_run_id", "fingerprint", name="uq_codesentry_finding_scan_fingerprint"
            ),
        )

    if not _has_table(bind, "codesentry_scan_events"):
        op.create_table(
            "codesentry_scan_events",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "scan_run_id",
                uuid_type,
                sa.ForeignKey("codesentry_scan_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("level", sa.String(16), server_default="info", nullable=False),
            sa.Column("event_type", sa.String(40), nullable=False),
            sa.Column("stage", sa.String(80), server_default="", nullable=False),
            sa.Column("message", sa.Text(), server_default="", nullable=False),
            sa.Column("payload", json_type, server_default=empty_json, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        )

    if not _has_table(bind, "codesentry_llm_usage"):
        op.create_table(
            "codesentry_llm_usage",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "scan_run_id",
                uuid_type,
                sa.ForeignKey("codesentry_scan_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("operation", sa.String(80), nullable=False),
            sa.Column("model", sa.String(80), server_default="granite-4.2", nullable=False),
            sa.Column("tier", sa.String(16), server_default="T1", nullable=False),
            sa.Column("prompt_tokens", sa.Integer(), server_default="0", nullable=False),
            sa.Column("completion_tokens", sa.Integer(), server_default="0", nullable=False),
            sa.Column("total_tokens", sa.Integer(), server_default="0", nullable=False),
            sa.Column("context_size", sa.Integer(), server_default="32768", nullable=False),
            sa.Column("latency_ms", sa.Integer(), server_default="0", nullable=False),
            sa.Column("success", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        )

    if not _has_table(bind, "codesentry_pocs"):
        op.create_table(
            "codesentry_pocs",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "scan_run_id",
                uuid_type,
                sa.ForeignKey("codesentry_scan_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "finding_id",
                uuid_type,
                sa.ForeignKey("codesentry_findings.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("title", sa.String(240), nullable=False),
            sa.Column("purpose", sa.Text(), nullable=False),
            sa.Column("code", sa.Text(), nullable=False),
            sa.Column("input_json", json_type, server_default=empty_json, nullable=False),
            sa.Column("status", sa.String(24), server_default="pending", nullable=False),
            sa.Column(
                "reviewed_by_id",
                uuid_type,
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("exit_code", sa.Integer(), nullable=True),
            sa.Column("result_json", json_type, nullable=True),
            sa.Column("stdout_storage_key", sa.Text(), nullable=True),
            sa.Column("stderr_storage_key", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        )

    if not _has_table(bind, "codesentry_reports"):
        op.create_table(
            "codesentry_reports",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column(
                "organization_id",
                uuid_type,
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "scan_run_id",
                uuid_type,
                sa.ForeignKey("codesentry_scan_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("format", sa.String(16), nullable=False),
            sa.Column("status", sa.String(24), server_default="ready", nullable=False),
            sa.Column("schema_version", sa.String(32), server_default="1.0", nullable=False),
            sa.Column("content_type", sa.String(160), nullable=False),
            sa.Column("storage_key", sa.Text(), nullable=False),
            sa.Column("byte_size", sa.Integer(), server_default="0", nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            sa.Column("finding_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("metadata_json", json_type, server_default=empty_json, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        )

    if _has_table(bind, "codesentry_scan_events") and not _has_constraint(
        bind, "uq_codesentry_scan_event_sequence"
    ):
        op.create_unique_constraint(
            "uq_codesentry_scan_event_sequence",
            "codesentry_scan_events",
            ["scan_run_id", "sequence"],
        )

    indexes = (
        ("ix_repository_snapshots_organization_id", "repository_snapshots", ["organization_id"]),
        ("ix_repository_snapshots_repository_id", "repository_snapshots", ["repository_id"]),
        ("ix_repository_snapshots_commit_sha", "repository_snapshots", ["commit_sha"]),
        ("ix_repository_files_organization_id", "repository_files", ["organization_id"]),
        ("ix_repository_files_snapshot_id", "repository_files", ["snapshot_id"]),
        ("ix_repository_files_sha256", "repository_files", ["sha256"]),
        ("ix_codesentry_scan_runs_organization_id", "codesentry_scan_runs", ["organization_id"]),
        ("ix_codesentry_scan_runs_repository_id", "codesentry_scan_runs", ["repository_id"]),
        ("ix_codesentry_scan_runs_status", "codesentry_scan_runs", ["status"]),
        ("ix_codesentry_scan_runs_snapshot_id", "codesentry_scan_runs", ["snapshot_id"]),
        ("ix_codesentry_findings_organization_id", "codesentry_findings", ["organization_id"]),
        ("ix_codesentry_findings_scan_run_id", "codesentry_findings", ["scan_run_id"]),
        ("ix_codesentry_findings_snapshot_id", "codesentry_findings", ["snapshot_id"]),
        (
            "ix_codesentry_findings_repository_file_id",
            "codesentry_findings",
            ["repository_file_id"],
        ),
        ("ix_codesentry_findings_source", "codesentry_findings", ["source"]),
        ("ix_codesentry_findings_rule_id", "codesentry_findings", ["rule_id"]),
        ("ix_codesentry_findings_cwe", "codesentry_findings", ["cwe"]),
        ("ix_codesentry_findings_severity", "codesentry_findings", ["severity"]),
        ("ix_codesentry_findings_status", "codesentry_findings", ["status"]),
        ("ix_codesentry_findings_fingerprint", "codesentry_findings", ["fingerprint"]),
        (
            "ix_codesentry_scan_events_organization_id",
            "codesentry_scan_events",
            ["organization_id"],
        ),
        (
            "ix_codesentry_scan_events_scan_run_sequence",
            "codesentry_scan_events",
            ["scan_run_id", "sequence"],
        ),
        ("ix_codesentry_scan_events_created_at", "codesentry_scan_events", ["created_at"]),
        ("ix_codesentry_llm_usage_organization_id", "codesentry_llm_usage", ["organization_id"]),
        ("ix_codesentry_llm_usage_scan_run_id", "codesentry_llm_usage", ["scan_run_id"]),
        ("ix_codesentry_llm_usage_operation", "codesentry_llm_usage", ["operation"]),
        ("ix_codesentry_pocs_organization_id", "codesentry_pocs", ["organization_id"]),
        ("ix_codesentry_pocs_scan_run_id", "codesentry_pocs", ["scan_run_id"]),
        ("ix_codesentry_pocs_finding_id", "codesentry_pocs", ["finding_id"]),
        ("ix_codesentry_pocs_status", "codesentry_pocs", ["status"]),
        ("ix_codesentry_reports_organization_id", "codesentry_reports", ["organization_id"]),
        ("ix_codesentry_reports_scan_run_id", "codesentry_reports", ["scan_run_id"]),
        ("ix_codesentry_reports_format", "codesentry_reports", ["format"]),
    )
    for name, table, columns in indexes:
        _create_index_if_missing(bind, name, table, columns)

    for table in (
        "repository_snapshots",
        "repository_files",
        "codesentry_scan_runs",
        "codesentry_findings",
        "codesentry_scan_events",
        "codesentry_llm_usage",
        "codesentry_pocs",
        "codesentry_reports",
    ):
        _enable_scope(bind, table)


def downgrade() -> None:
    bind = op.get_bind()
    tables = (
        "codesentry_reports",
        "codesentry_pocs",
        "codesentry_llm_usage",
        "codesentry_scan_events",
        "codesentry_findings",
        "codesentry_scan_runs",
        "repository_files",
        "repository_snapshots",
    )
    for table in tables:
        if _has_table(bind, table):
            op.execute(f"DROP POLICY IF EXISTS {table}_organization_scope ON {table}")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
            op.drop_table(table)
