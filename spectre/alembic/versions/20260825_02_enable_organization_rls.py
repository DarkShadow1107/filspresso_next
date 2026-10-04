"""Enable organization row-level security.

Revision ID: 20260825_02
Revises: 20260825_01
Create Date: 2026-08-25
"""

import sqlalchemy as sa

from alembic import op

revision = "20260825_02"
down_revision = "20260825_01"
branch_labels = None
depends_on = None


DIRECT_ORGANIZATION_TABLES = (
    "research_cases",
    "sources",
    "knowledge_entities",
    "repositories",
)


def _has_table(bind, table_name):
    return bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=:t)"),
        {"t": table_name},
    ).scalar()


def _create_policy_if_not_exists(table, policy_name, sql_body):
    bind = op.get_bind()
    exists = bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=:t AND policyname=:p)"),
        {"t": table, "p": policy_name},
    ).scalar()
    if not exists:
        op.execute(sql_body)


def upgrade() -> None:
    bind = op.get_bind()
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.spectre_current_user_id()
        RETURNS uuid
        LANGUAGE sql
        VOLATILE
        AS $$
            SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
        $$;

        CREATE OR REPLACE FUNCTION public.spectre_current_organization_id()
        RETURNS uuid
        LANGUAGE sql
        VOLATILE
        AS $$
            SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
        $$;

        CREATE INDEX IF NOT EXISTS ix_memberships_user_organization
            ON memberships (user_id, organization_id);
        """
    )

    for table in DIRECT_ORGANIZATION_TABLES:
        if _has_table(bind, table):
            _create_policy_if_not_exists(
                table,
                f"{table}_organization_scope",
                f"""
                CREATE POLICY {table}_organization_scope ON {table}
                FOR ALL
                USING (organization_id = public.spectre_current_organization_id())
                WITH CHECK (organization_id = public.spectre_current_organization_id());
                """,
            )

    if _has_table(bind, "organizations"):
        _create_policy_if_not_exists(
            "organizations",
            "organizations_membership_read",
            """
            CREATE POLICY organizations_membership_read ON organizations
            FOR SELECT
            USING (
                organizations.id = public.spectre_current_organization_id()
                OR EXISTS (
                        SELECT 1
                        FROM memberships
                        WHERE memberships.organization_id = organizations.id
                            AND memberships.user_id = public.spectre_current_user_id()
                )
            );
            """,
        )
        _create_policy_if_not_exists(
            "organizations",
            "organizations_create",
            """
            CREATE POLICY organizations_create ON organizations
            FOR INSERT
            WITH CHECK (public.spectre_current_user_id() IS NOT NULL);
            """,
        )

    if _has_table(bind, "memberships"):
        _create_policy_if_not_exists(
            "memberships",
            "memberships_tenant_read",
            """
            CREATE POLICY memberships_tenant_read ON memberships
            FOR SELECT
            USING (
                user_id = public.spectre_current_user_id()
                OR organization_id = public.spectre_current_organization_id()
            );
            """,
        )
        _create_policy_if_not_exists(
            "memberships",
            "memberships_tenant_write",
            """
            CREATE POLICY memberships_tenant_write ON memberships
            FOR ALL
            USING (organization_id = public.spectre_current_organization_id())
            WITH CHECK (organization_id = public.spectre_current_organization_id());
            """,
        )

    if _has_table(bind, "research_runs"):
        _create_policy_if_not_exists(
            "research_runs",
            "research_runs_organization_scope",
            """
            CREATE POLICY research_runs_organization_scope ON research_runs
            FOR ALL
            USING (organization_id = public.spectre_current_organization_id())
            WITH CHECK (
                organization_id = public.spectre_current_organization_id()
                AND EXISTS (
                    SELECT 1
                    FROM research_cases
                    WHERE research_cases.id = research_runs.case_id
                        AND research_cases.organization_id =
                            public.spectre_current_organization_id()
                )
            );
            """,
        )

    if _has_table(bind, "agent_tasks"):
        _create_policy_if_not_exists(
            "agent_tasks",
            "agent_tasks_organization_scope",
            """
            CREATE POLICY agent_tasks_organization_scope ON agent_tasks
            FOR ALL
            USING (
                EXISTS (
                    SELECT 1
                    FROM research_runs
                    WHERE research_runs.id = agent_tasks.run_id
                        AND research_runs.organization_id =
                            public.spectre_current_organization_id()
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM research_runs
                    WHERE research_runs.id = agent_tasks.run_id
                        AND research_runs.organization_id =
                            public.spectre_current_organization_id()
                )
            );
            """,
        )

    if _has_table(bind, "source_versions"):
        _create_policy_if_not_exists(
            "source_versions",
            "source_versions_organization_scope",
            """
            CREATE POLICY source_versions_organization_scope ON source_versions
            FOR ALL
            USING (
                EXISTS (
                    SELECT 1
                    FROM sources
                    WHERE sources.id = source_versions.source_id
                        AND sources.organization_id = public.spectre_current_organization_id()
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM sources
                    WHERE sources.id = source_versions.source_id
                        AND sources.organization_id = public.spectre_current_organization_id()
                )
            );
            """,
        )

    if _has_table(bind, "document_chunks"):
        _create_policy_if_not_exists(
            "document_chunks",
            "document_chunks_organization_scope",
            """
            CREATE POLICY document_chunks_organization_scope ON document_chunks
            FOR ALL
            USING (organization_id = public.spectre_current_organization_id())
            WITH CHECK (
                organization_id = public.spectre_current_organization_id()
                AND EXISTS (
                    SELECT 1
                    FROM source_versions
                    JOIN sources ON sources.id = source_versions.source_id
                    WHERE source_versions.id = document_chunks.source_version_id
                        AND sources.organization_id = public.spectre_current_organization_id()
                )
            );
            """,
        )

    if _has_table(bind, "artifacts"):
        _create_policy_if_not_exists(
            "artifacts",
            "artifacts_organization_scope",
            """
            CREATE POLICY artifacts_organization_scope ON artifacts
            FOR ALL
            USING (organization_id = public.spectre_current_organization_id())
            WITH CHECK (
                organization_id = public.spectre_current_organization_id()
                AND (
                    case_id IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM research_cases
                        WHERE research_cases.id = artifacts.case_id
                            AND research_cases.organization_id =
                                public.spectre_current_organization_id()
                    )
                )
            );
            """,
        )

    if _has_table(bind, "audit_events"):
        _create_policy_if_not_exists(
            "audit_events",
            "audit_events_organization_read",
            """
            CREATE POLICY audit_events_organization_read ON audit_events
            FOR SELECT
            USING (organization_id = public.spectre_current_organization_id());
            """,
        )
        _create_policy_if_not_exists(
            "audit_events",
            "audit_events_organization_insert",
            """
            CREATE POLICY audit_events_organization_insert ON audit_events
            FOR INSERT
            WITH CHECK (organization_id = public.spectre_current_organization_id());
            """,
        )

    for table in (
        "organizations",
        "memberships",
        "research_cases",
        "research_runs",
        "agent_tasks",
        "sources",
        "source_versions",
        "document_chunks",
        "knowledge_entities",
        "repositories",
        "artifacts",
        "audit_events",
    ):
        if _has_table(bind, table):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    bind = op.get_bind()
    policy_tables = (
        ("organizations_membership_read", "organizations"),
        ("organizations_create", "organizations"),
        ("memberships_tenant_read", "memberships"),
        ("memberships_tenant_write", "memberships"),
        ("research_runs_organization_scope", "research_runs"),
        ("agent_tasks_organization_scope", "agent_tasks"),
        ("source_versions_organization_scope", "source_versions"),
        ("document_chunks_organization_scope", "document_chunks"),
        ("artifacts_organization_scope", "artifacts"),
        ("audit_events_organization_read", "audit_events"),
        ("audit_events_organization_insert", "audit_events"),
        *[(f"{table}_organization_scope", table) for table in DIRECT_ORGANIZATION_TABLES],
    )
    for policy, table in policy_tables:
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
    for table in (
        "organizations",
        "memberships",
        "research_cases",
        "research_runs",
        "agent_tasks",
        "sources",
        "source_versions",
        "document_chunks",
        "knowledge_entities",
        "repositories",
        "artifacts",
        "audit_events",
    ):
        if _has_table(bind, table):
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP INDEX IF EXISTS ix_memberships_user_organization")
    op.execute("DROP FUNCTION IF EXISTS public.spectre_current_organization_id()")
    op.execute("DROP FUNCTION IF EXISTS public.spectre_current_user_id()")
