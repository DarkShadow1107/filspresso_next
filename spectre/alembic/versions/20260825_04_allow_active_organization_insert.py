"""Allow a scoped organization row to be returned during workspace creation.

Revision ID: 20260825_04
Revises: 20260825_03
Create Date: 2026-08-25
"""

from alembic import op

revision = "20260825_04"
down_revision = "20260825_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP POLICY IF EXISTS organizations_membership_read ON organizations")
    op.execute(
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
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS organizations_membership_read ON organizations")
    op.execute(
        """
        CREATE POLICY organizations_membership_read ON organizations
        FOR SELECT
        USING (
            EXISTS (
                SELECT 1
                FROM memberships
                WHERE memberships.organization_id = organizations.id
                    AND memberships.user_id = public.spectre_current_user_id()
            )
        )
        """
    )
