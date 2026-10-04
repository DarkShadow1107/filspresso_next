from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent


async def record_audit_event(
    db: AsyncSession,
    *,
    action: str,
    resource_type: str,
    resource_id: str | None,
    organization_id: UUID | None,
    actor_id: UUID | None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditEvent(
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            organization_id=organization_id,
            actor_id=actor_id,
            details=details or {},
        )
    )
