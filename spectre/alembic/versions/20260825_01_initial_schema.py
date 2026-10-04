"""Initial Spectre schema.

Revision ID: 20260825_01
Revises:
Create Date: 2026-08-25
"""

from alembic import op
from app.models import Base

revision = "20260825_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
