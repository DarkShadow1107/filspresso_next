"""Evaluate RLS context on every statement execution.

Revision ID: 20260825_03
Revises: 20260825_02
Create Date: 2026-08-25
"""

from alembic import op

revision = "20260825_03"
down_revision = "20260825_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.spectre_current_user_id()
        RETURNS uuid
        LANGUAGE sql
        STABLE
        AS $$
            SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
        $$;

        CREATE OR REPLACE FUNCTION public.spectre_current_organization_id()
        RETURNS uuid
        LANGUAGE sql
        STABLE
        AS $$
            SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
        $$;
        """
    )
