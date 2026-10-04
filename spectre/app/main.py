import uuid as _uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.spectre import router as spectre_router
from app.api.router import router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db import SessionLocal, close_database, initialize_database

settings = get_settings()

DEFAULT_USER_EMAIL = "local@spectre.dev"
DEFAULT_USER_ID = _uuid.uuid5(_uuid.NAMESPACE_URL, "spectre:local-user")
DEFAULT_ORG_ID = _uuid.uuid5(_uuid.NAMESPACE_URL, "spectre:local-workspace")


async def _ensure_default_identity() -> None:
    async with SessionLocal() as session:
        connection = await session.connection()
        await connection.execute(
            text("SELECT set_config('app.user_id', :uid, true)"),
            {"uid": str(DEFAULT_USER_ID)},
        )
        await connection.execute(
            text("SELECT set_config('app.organization_id', :oid, true)"),
            {"oid": str(DEFAULT_ORG_ID)},
        )

        exists = await session.scalar(
            text("SELECT 1 FROM users WHERE id = :id"), {"id": DEFAULT_USER_ID}
        )
        if exists is None:
            await session.execute(
                text(
                    "INSERT INTO users (id, email, display_name, password_hash, is_active) "
                    "VALUES (:id, :email, :name, :pw, true)"
                ),
                {
                    "id": DEFAULT_USER_ID,
                    "email": DEFAULT_USER_EMAIL,
                    "name": "Local",
                    "pw": "no-auth-local",
                },
            )

        org_exists = await session.scalar(
            text("SELECT 1 FROM organizations WHERE id = :id"), {"id": DEFAULT_ORG_ID}
        )
        if org_exists is None:
            await session.execute(
                text("INSERT INTO organizations (id, name, slug) VALUES (:id, :name, :slug)"),
                {
                    "id": DEFAULT_ORG_ID,
                    "name": "Spectre Workspace",
                    "slug": "spectre-workspace",
                },
            )

        membership_exists = await session.scalar(
            text("SELECT 1 FROM memberships WHERE user_id = :uid AND organization_id = :oid"),
            {"uid": DEFAULT_USER_ID, "oid": DEFAULT_ORG_ID},
        )
        if membership_exists is None:
            await session.execute(
                text(
                    "INSERT INTO memberships (id, organization_id, user_id, role) "
                    "VALUES (gen_random_uuid(), :oid, :uid, 'ADMIN')"
                ),
                {"oid": DEFAULT_ORG_ID, "uid": DEFAULT_USER_ID},
            )

        await session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    if settings.environment.lower() == "production" and settings.auto_create_schema:
        raise RuntimeError(
            "AUTO_CREATE_SCHEMA must be disabled in production; run Alembic migrations"
        )
    await initialize_database()
    await _ensure_default_identity()
    yield
    await close_database()


app = FastAPI(
    title="Spectre API",
    version="0.1.0",
    description="Collaborative defensive security intelligence and evidence automation platform.",
    lifespan=lifespan,
    docs_url=None if settings.environment.lower() == "production" else "/docs",
    redoc_url=None if settings.environment.lower() == "production" else "/redoc",
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_host_list)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(router, prefix="/api/v1")
app.include_router(spectre_router, prefix="/api/v1")


@app.middleware("http")
async def apply_security_headers(request: Request, call_next: object) -> object:
    response = await call_next(request)  # type: ignore[operator]
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, private"
    return response


@app.get("/health")
@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "spectre-api", "environment": settings.environment}
