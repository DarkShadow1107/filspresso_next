"""Allow NULL organization audit events for personal user memory.

Revision ID: 20260826_09
Revises: 20260826_08
Create Date: 2026-08-26
"""

from alembic import op

revision = "20260826_09"
down_revision = "20260826_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS audit_events_organization_insert ON audit_events;
        CREATE POLICY audit_events_organization_insert ON audit_events
        FOR INSERT
        WITH CHECK (
            organization_id IS NULL
            OR organization_id = public.spectre_current_organization_id()
        );

        DROP POLICY IF EXISTS audit_events_organization_read ON audit_events;
        CREATE POLICY audit_events_organization_read ON audit_events
        FOR SELECT
        USING (
            organization_id IS NULL
            OR organization_id = public.spectre_current_organization_id()
        );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS audit_events_organization_insert ON audit_events;
        CREATE POLICY audit_events_organization_insert ON audit_events
        FOR INSERT
        WITH CHECK (organization_id = public.spectre_current_organization_id());

        DROP POLICY IF EXISTS audit_events_organization_read ON audit_events;
        CREATE POLICY audit_events_organization_read ON audit_events
        FOR SELECT
        USING (organization_id = public.spectre_current_organization_id());
        """
    )
