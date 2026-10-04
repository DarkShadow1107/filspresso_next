from collections.abc import Callable
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, set_current_user_context, set_organization_context
from app.models import Membership, MembershipRole, Organization, User

DEFAULT_USER_EMAIL = "local@spectre.dev"
DEFAULT_ORG_SLUG = "codesentry-workspace"


async def local_default_user(db: AsyncSession = Depends(get_db)) -> User:
    user = await db.scalar(select(User).where(User.email == DEFAULT_USER_EMAIL))
    if user is None:
        raise HTTPException(status_code=503, detail="Default user not provisioned yet")
    await set_current_user_context(db, user.id)
    org = await db.scalar(select(Organization).where(Organization.slug == DEFAULT_ORG_SLUG))
    if org is not None:
        await set_organization_context(db, org.id)
    return user


def organization_access(*allowed_roles: MembershipRole) -> Callable[..., object]:
    async def dependency(
        organization_id: UUID,
        user: User = Depends(local_default_user),
        db: AsyncSession = Depends(get_db),
    ) -> Membership:
        membership = await db.scalar(
            select(Membership).where(
                Membership.organization_id == organization_id,
                Membership.user_id == user.id,
            )
        )
        if membership is None or membership.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient organization role")
        await set_organization_context(db, organization_id)
        return membership

    return dependency
