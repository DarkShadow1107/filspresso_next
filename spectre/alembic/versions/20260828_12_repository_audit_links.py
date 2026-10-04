"""Link research runs to repositories and chat conversations.

Revision ID: 20260828_12
Revises: 20260828_11
Create Date: 2026-08-28
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260828_12"
down_revision = "20260828_11"
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
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=:name)"),
            {"name": name},
        ).scalar()
    )


def _has_constraint(bind: sa.Connection, name: str) -> bool:
    return bool(
        bind.execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=:name)"),
            {"name": name},
        ).scalar()
    )


def upgrade() -> None:
    bind = op.get_bind()
    uuid_type = postgresql.UUID(as_uuid=True)
    if not _has_column(bind, "research_runs", "repository_id"):
        op.add_column(
            "research_runs",
            sa.Column(
                "repository_id",
                uuid_type,
                nullable=True,
            ),
        )
    if not _has_column(bind, "research_runs", "conversation_id"):
        op.add_column("research_runs", sa.Column("conversation_id", sa.String(200), nullable=True))
    if not _has_index(bind, "ix_research_runs_repository_id"):
        op.create_index("ix_research_runs_repository_id", "research_runs", ["repository_id"])
    if not _has_index(bind, "ix_research_runs_conversation_id"):
        op.create_index("ix_research_runs_conversation_id", "research_runs", ["conversation_id"])
    if not _has_constraint(bind, "fk_research_runs_repository_id_repositories"):
        op.create_foreign_key(
            "fk_research_runs_repository_id_repositories",
            "research_runs",
            "repositories",
            ["repository_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_index(bind, "ix_research_runs_conversation_id"):
        op.drop_index("ix_research_runs_conversation_id", table_name="research_runs")
    if _has_index(bind, "ix_research_runs_repository_id"):
        op.drop_index("ix_research_runs_repository_id", table_name="research_runs")
    if _has_constraint(bind, "fk_research_runs_repository_id_repositories"):
        op.drop_constraint(
            "fk_research_runs_repository_id_repositories", "research_runs", type_="foreignkey"
        )
    if _has_column(bind, "research_runs", "conversation_id"):
        op.drop_column("research_runs", "conversation_id")
    if _has_column(bind, "research_runs", "repository_id"):
        op.drop_column("research_runs", "repository_id")
