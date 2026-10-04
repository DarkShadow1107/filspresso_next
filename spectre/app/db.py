from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.database_url, pool_pre_ping=True)

_USER_CONTEXT = "app.user_id"
_ORGANIZATION_CONTEXT = "app.organization_id"


@event.listens_for(engine.sync_engine, "checkout")
def clear_pooled_tenant_context(
    dbapi_connection: object, connection_record: object, connection_proxy: object
) -> None:
    """Ensure a checked-out connection never inherits another request's tenant scope."""
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute(
            "SELECT set_config('app.user_id', '', false), "
            "set_config('app.organization_id', '', false)"
        )
    finally:
        cursor.close()


@event.listens_for(AsyncSession.sync_session_class, "after_begin")
def apply_tenant_context(session: object, transaction: object, connection: object) -> None:
    """Reapply session context when a commit starts a new transaction."""
    if connection.dialect.name != "postgresql":  # type: ignore[attr-defined]
        return
    for name in (_USER_CONTEXT, _ORGANIZATION_CONTEXT):
        value = session.info.get(name)  # type: ignore[attr-defined]
        if value is not None:
            connection.execute(  # type: ignore[attr-defined]
                text("SELECT set_config(:name, :value, false)"), {"name": name, "value": value}
            )


@event.listens_for(AsyncSession.sync_session_class, "before_flush")
def apply_tenant_context_before_flush(
    session: object, flush_context: object, instances: object
) -> None:
    """Apply the scope on the exact connection that executes ORM inserts and updates."""
    if session.get_bind().dialect.name != "postgresql":  # type: ignore[attr-defined]
        return
    connection = session.connection()  # type: ignore[attr-defined]
    for name in (_USER_CONTEXT, _ORGANIZATION_CONTEXT):
        value = session.info.get(name)  # type: ignore[attr-defined]
        if value is not None:
            connection.execute(
                text("SELECT set_config(:name, :value, false)"), {"name": name, "value": value}
            )


async def _apply_tenant_context(session: AsyncSession) -> None:
    if session.get_bind().dialect.name != "postgresql":
        return
    connection = await session.connection()
    for name in (_USER_CONTEXT, _ORGANIZATION_CONTEXT):
        value = session.info.get(name)
        if value is not None:
            await connection.execute(
                text("SELECT set_config(:name, :value, false)"),
                {"name": name, "value": value},
            )


class TenantAsyncSession(AsyncSession):
    async def flush(self, objects: object | None = None) -> None:
        # ORM writes bypass execute(), so set the scope on their exact connection first.
        await _apply_tenant_context(self)
        await super().flush(objects=objects)


SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=TenantAsyncSession)


async def _set_rls_context(session: AsyncSession, name: str, value: UUID) -> None:
    session.info[name] = str(value)
    await _apply_tenant_context(session)


async def set_current_user_context(session: AsyncSession, user_id: UUID) -> None:
    await _set_rls_context(session, _USER_CONTEXT, user_id)


async def set_organization_context(session: AsyncSession, organization_id: UUID) -> None:
    await _set_rls_context(session, _ORGANIZATION_CONTEXT, organization_id)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def initialize_database() -> None:
    from app.models import Base

    if not settings.auto_create_schema:
        return
    async with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.run_sync(Base.metadata.create_all)


async def close_database() -> None:
    await engine.dispose()
