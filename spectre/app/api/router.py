import asyncio
import json
import shutil
import uuid
import zipfile
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db import SessionLocal, get_db, set_organization_context
from app.dependencies import local_default_user
from app.models import (
    AgentEvent,
    AgentTask,
    Artifact,
    CaseStatus,
    CodeProposal,
    CodeSentryScanRun,
    DocumentChunk,
    Membership,
    MembershipRole,
    Organization,
    ProposalStatus,
    Repository,
    ResearchCase,
    ResearchRun,
    ScanStatus,
    Source,
    SourceVersion,
    TaskStatus,
    User,
    UserMemoryPreference,
    UserMemoryRecord,
)
from app.schemas import (
    AgentEventRead,
    AgentTaskRead,
    ArtifactCreate,
    ArtifactRead,
    CalculatorRequest,
    CalculatorResult,
    CodeProposalCreate,
    CodeProposalRead,
    MembershipCreate,
    Message,
    OrganizationCreate,
    OrganizationRead,
    RepositoryAuditCreate,
    RepositoryCreate,
    RepositoryRead,
    ResearchCaseCreate,
    ResearchCaseRead,
    ResearchRunRead,
    SandboxResult,
    SourceRecordRead,
    UserMemoryPreferenceRead,
    UserMemoryPreferenceUpdate,
    UserMemoryRecordCreate,
    UserMemoryRecordRead,
    UserMemoryUrlCaptureCreate,
)
from app.services.artifacts import create_artifact, read_artifact_bytes
from app.services.audit import record_audit_event
from app.services.codesentry import emit_scan_event
from app.services.documents import (
    UnsupportedDocumentError,
    delete_document_originals,
    persist_user_document,
)
from app.services.ingestion import UnsafeUrlError
from app.services.rag import embed_chunks_for_version, hybrid_retrieve
from app.services.rate_limit import enforce_rate_limit
from app.services.repository import RepositorySafetyError, validate_github_url
from app.services.tools import calculate
from app.services.user_memory import (
    MemoryDisabledError,
    MemoryRecordLimitError,
    capture_public_memory_url,
    ensure_memory_capacity,
    ensure_memory_content_size,
    memory_safe_source_url,
    require_writable_memory,
)
from app.services.workflow import create_run_tasks

router = APIRouter()
settings = get_settings()


async def get_membership(
    organization_id: UUID,
    user: User,
    db: AsyncSession,
    *roles: MembershipRole,
) -> Membership:
    membership = await db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == user.id,
        )
    )
    if membership is None or (roles and membership.role not in roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient organization role"
        )
    await set_organization_context(db, organization_id)
    return membership


async def _limit_expensive_action(request: Request, user: User, organization_id: UUID) -> None:
    await enforce_rate_limit(
        request,
        scope="expensive",
        limit=settings.expensive_rate_limit_per_hour,
        window_seconds=3600,
        subject=f"{user.id}:{organization_id}",
    )


@router.get("/me/memory/preferences", response_model=UserMemoryPreferenceRead)
async def get_user_memory_preferences(
    user: User = Depends(local_default_user), db: AsyncSession = Depends(get_db)
) -> UserMemoryPreferenceRead:
    preference = await db.get(UserMemoryPreference, user.id)
    return UserMemoryPreferenceRead(enabled=preference.enabled if preference is not None else False)


@router.put("/me/memory/preferences", response_model=UserMemoryPreferenceRead)
async def update_user_memory_preferences(
    payload: UserMemoryPreferenceUpdate,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> UserMemoryPreferenceRead:
    preference = await db.get(UserMemoryPreference, user.id)
    if preference is None:
        preference = UserMemoryPreference(user_id=user.id, enabled=payload.enabled)
        db.add(preference)
    else:
        preference.enabled = payload.enabled
    await record_audit_event(
        db,
        action="user_memory.preference_updated",
        resource_type="user_memory_preference",
        resource_id=str(user.id),
        organization_id=None,
        actor_id=user.id,
        details={"enabled": payload.enabled},
    )
    await db.commit()
    return UserMemoryPreferenceRead(enabled=preference.enabled)


@router.get("/me/memory/records", response_model=list[UserMemoryRecordRead])
async def list_user_memory_records(
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[UserMemoryRecord]:
    records = await db.scalars(
        select(UserMemoryRecord)
        .where(UserMemoryRecord.user_id == user.id)
        .order_by(UserMemoryRecord.created_at.desc(), UserMemoryRecord.id.desc())
        .limit(limit)
    )
    return list(records)


@router.post(
    "/me/memory/records",
    response_model=UserMemoryRecordRead,
    status_code=status.HTTP_201_CREATED,
)
async def append_user_memory_record(
    payload: UserMemoryRecordCreate,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> UserMemoryRecord:
    content = payload.content.strip()
    try:
        ensure_memory_content_size(content)
        await require_writable_memory(db, user.id, lock=True)
        await ensure_memory_capacity(db, user.id)
    except MemoryDisabledError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Personal memory is disabled. Enable it before adding records.",
        ) from None
    except MemoryRecordLimitError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Personal memory record limit reached.",
        ) from None
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from None
    record = UserMemoryRecord(
        user_id=user.id,
        kind="client",
        title=payload.title.strip() if payload.title and payload.title.strip() else None,
        content=content,
    )
    db.add(record)
    await db.flush()
    await record_audit_event(
        db,
        action="user_memory.record_appended",
        resource_type="user_memory_record",
        resource_id=str(record.id),
        organization_id=None,
        actor_id=user.id,
        details={"kind": record.kind, "content_bytes": len(content.encode("utf-8"))},
    )
    await db.commit()
    await db.refresh(record)
    return record


@router.post(
    "/me/memory/captures",
    response_model=UserMemoryRecordRead,
    status_code=status.HTTP_201_CREATED,
)
async def capture_user_memory_url(
    payload: UserMemoryUrlCaptureCreate,
    request: Request,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> UserMemoryRecord:
    try:
        await require_writable_memory(db, user.id)
    except MemoryDisabledError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Personal memory is disabled. Enable it before capturing URLs.",
        ) from None
    await enforce_rate_limit(
        request,
        scope="user_memory_capture",
        limit=settings.expensive_rate_limit_per_hour,
        window_seconds=3600,
        subject=str(user.id),
    )
    try:
        document = await capture_public_memory_url(payload.url)
        source_url = memory_safe_source_url(document.canonical_url)
    except UnsafeUrlError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only publicly routable HTTP(S) URLs can be captured.",
        ) from None
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="URL capture failed.",
        ) from None
    try:
        await require_writable_memory(db, user.id, lock=True)
        await ensure_memory_capacity(db, user.id)
    except MemoryDisabledError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Personal memory was disabled while the URL was being captured.",
        ) from None
    except MemoryRecordLimitError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Personal memory record limit reached.",
        ) from None
    record = UserMemoryRecord(
        user_id=user.id,
        kind="url_capture",
        title=document.title,
        content=document.text,
        source_url=source_url,
    )
    db.add(record)
    await db.flush()
    await record_audit_event(
        db,
        action="user_memory.url_captured",
        resource_type="user_memory_record",
        resource_id=str(record.id),
        organization_id=None,
        actor_id=user.id,
        details={"kind": record.kind, "content_bytes": len(record.content.encode("utf-8"))},
    )
    await db.commit()
    await db.refresh(record)
    return record


@router.get("/me/memory/export")
async def export_user_memory(
    user: User = Depends(local_default_user), db: AsyncSession = Depends(get_db)
) -> Response:
    preference = await db.get(UserMemoryPreference, user.id)
    records = list(
        await db.scalars(
            select(UserMemoryRecord)
            .where(UserMemoryRecord.user_id == user.id)
            .order_by(UserMemoryRecord.created_at, UserMemoryRecord.id)
        )
    )
    payload = {
        "exported_at": datetime.now(UTC).isoformat(),
        "preferences": {"enabled": preference.enabled if preference is not None else False},
        "records": [
            {
                "id": str(record.id),
                "kind": record.kind,
                "title": record.title,
                "content": record.content,
                "source_url": record.source_url,
                "created_at": record.created_at.isoformat(),
            }
            for record in records
        ],
    }
    await record_audit_event(
        db,
        action="user_memory.exported",
        resource_type="user_memory",
        resource_id=str(user.id),
        organization_id=None,
        actor_id=user.id,
        details={"record_count": len(records)},
    )
    await db.commit()
    return Response(
        content=json.dumps(payload, separators=(",", ":")),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="user-memory.json"',
            "Cache-Control": "no-store, private",
            "Pragma": "no-cache",
        },
    )


@router.delete("/me/memory", response_model=Message)
async def delete_user_memory(
    user: User = Depends(local_default_user), db: AsyncSession = Depends(get_db)
) -> Message:
    record_count = await db.scalar(
        select(func.count())
        .select_from(UserMemoryRecord)
        .where(UserMemoryRecord.user_id == user.id)
    )
    await db.execute(delete(UserMemoryRecord).where(UserMemoryRecord.user_id == user.id))
    await db.execute(delete(UserMemoryPreference).where(UserMemoryPreference.user_id == user.id))
    await record_audit_event(
        db,
        action="user_memory.deleted",
        resource_type="user_memory",
        resource_id=str(user.id),
        organization_id=None,
        actor_id=user.id,
        details={"record_count": record_count or 0},
    )
    await db.commit()
    return Message(detail="Personal memory deleted.")


@router.get("/organizations", response_model=list[OrganizationRead])
async def list_organizations(
    user: User = Depends(local_default_user), db: AsyncSession = Depends(get_db)
) -> list[Organization]:
    result = await db.scalars(
        select(Organization)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.name)
    )
    return list(result)


@router.post("/organizations", response_model=OrganizationRead, status_code=status.HTTP_201_CREATED)
async def create_organization(
    payload: OrganizationCreate,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Organization:
    organization = Organization(id=uuid.uuid4(), name=payload.name, slug=payload.slug)
    await set_organization_context(db, organization.id)
    db.add(organization)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization slug is already in use"
        ) from None
    db.add(Membership(organization_id=organization.id, user_id=user.id, role=MembershipRole.ADMIN))
    await record_audit_event(
        db,
        action="organization.created",
        resource_type="organization",
        resource_id=str(organization.id),
        organization_id=organization.id,
        actor_id=user.id,
    )
    await db.commit()
    await db.refresh(organization)
    return organization


@router.post("/organizations/{organization_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def add_member(
    organization_id: UUID,
    payload: MembershipCreate,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await get_membership(organization_id, user, db, MembershipRole.ADMIN)
    invited = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if invited is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invitee must register first"
        )
    exists = await db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id, Membership.user_id == invited.id
        )
    )
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User already belongs to this organization"
        )
    db.add(Membership(organization_id=organization_id, user_id=invited.id, role=payload.role))
    await record_audit_event(
        db,
        action="membership.created",
        resource_type="membership",
        resource_id=None,
        organization_id=organization_id,
        actor_id=user.id,
        details={"invited_user_id": str(invited.id), "role": payload.role.value},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/organizations/{organization_id}/cases", response_model=list[ResearchCaseRead])
async def list_cases(
    organization_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[ResearchCase]:
    await get_membership(organization_id, user, db)
    result = await db.scalars(
        select(ResearchCase)
        .where(ResearchCase.organization_id == organization_id)
        .order_by(ResearchCase.updated_at.desc())
    )
    return list(result)


@router.post(
    "/organizations/{organization_id}/cases",
    response_model=ResearchCaseRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_case(
    organization_id: UUID,
    payload: ResearchCaseCreate,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> ResearchCase:
    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    settings_obj = payload.agent_settings
    case = ResearchCase(
        organization_id=organization_id,
        owner_id=user.id,
        title=payload.title,
        question=payload.question,
        asset_profile=payload.asset_profile,
        agent_settings=(
            {"profile": settings_obj.profile, **settings_obj.resolved()} if settings_obj else {}
        ),
    )
    db.add(case)
    await record_audit_event(
        db,
        action="case.created",
        resource_type="research_case",
        resource_id=str(case.id),
        organization_id=organization_id,
        actor_id=user.id,
    )
    await db.commit()
    await db.refresh(case)
    return case


@router.get("/organizations/{organization_id}/cases/{case_id}", response_model=ResearchCaseRead)
async def get_case(
    organization_id: UUID,
    case_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> ResearchCase:
    await get_membership(organization_id, user, db)
    case = await db.get(ResearchCase, case_id)
    if case is None or case.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research case not found")
    return case


@router.post(
    "/organizations/{organization_id}/cases/{case_id}/runs", response_model=ResearchRunRead
)
async def start_research_run(
    organization_id: UUID,
    case_id: UUID,
    request: Request,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> ResearchRun:
    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    await _limit_expensive_action(request, user, organization_id)
    case = await db.get(ResearchCase, case_id)
    if case is None or case.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research case not found")
    if case.status in {CaseStatus.RUNNING, CaseStatus.QUEUED}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A research run is already active"
        )
    from app.schemas import AgentSettings

    resolved = AgentSettings(**(case.agent_settings or {})).resolved()
    run = ResearchRun(
        organization_id=organization_id,
        case_id=case.id,
        requested_by_id=user.id,
        settings={"profile": (case.agent_settings or {}).get("profile", "balanced"), **resolved},
        budget={
            "max_sources": resolved["max_sources"],
            "max_fetches": resolved["fetch_top"],
            "max_wall_seconds": resolved["wall_seconds"],
        },
    )
    db.add(run)
    await db.flush()
    await create_run_tasks(db, run)
    case.status = CaseStatus.QUEUED
    await record_audit_event(
        db,
        action="research_run.queued",
        resource_type="research_run",
        resource_id=str(run.id),
        organization_id=organization_id,
        actor_id=user.id,
    )
    await db.commit()
    try:
        from app.worker import execute_research_run_task

        execute_research_run_task.delay(str(run.id), str(organization_id))
    except Exception:
        # The durable queued record remains visible and can be retried after Redis recovers.
        pass
    await db.refresh(run)
    return run


@router.post(
    "/organizations/{organization_id}/repositories/{repository_id}/audits",
    response_model=ResearchRunRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_repository_audit(
    organization_id: UUID,
    repository_id: UUID,
    payload: RepositoryAuditCreate,
    request: Request,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> ResearchRun:
    """Start one durable research run and its linked CodeSentry repository scan."""

    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    await _limit_expensive_action(request, user, organization_id)
    repository = await db.get(Repository, repository_id)
    if repository is None or repository.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repository not found")

    active_run = await db.scalar(
        select(ResearchRun)
        .where(
            ResearchRun.organization_id == organization_id,
            ResearchRun.repository_id == repository_id,
            ResearchRun.status.in_([CaseStatus.QUEUED, CaseStatus.RUNNING]),
        )
        .limit(1)
    )
    if active_run is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Repository audit is already active"
        )

    active_scan = await db.scalar(
        select(CodeSentryScanRun)
        .where(
            CodeSentryScanRun.organization_id == organization_id,
            CodeSentryScanRun.repository_id == repository_id,
            CodeSentryScanRun.status.in_(
                [
                    ScanStatus.QUEUED.value,
                    ScanStatus.RUNNING.value,
                    ScanStatus.AWAITING_APPROVAL.value,
                ]
            ),
        )
        .limit(1)
    )
    if active_scan is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Repository already has an active CodeSentry scan",
        )

    from app.schemas import AgentSettings

    settings_obj = payload.agent_settings or AgentSettings()
    resolved = settings_obj.resolved()
    case = ResearchCase(
        organization_id=organization_id,
        owner_id=user.id,
        title=payload.title or f"Security audit: {repository.name}",
        question=payload.question,
        asset_profile={"repository_id": str(repository.id), "kind": "repository_audit"},
        agent_settings={"profile": settings_obj.profile, **resolved},
        status=CaseStatus.QUEUED,
    )
    db.add(case)
    await db.flush()

    scan = CodeSentryScanRun(
        organization_id=organization_id,
        repository_id=repository.id,
        requested_by_id=user.id,
        status=ScanStatus.QUEUED.value,
        current_stage="queued",
        settings={
            "tier": payload.scan_tier,
            "max_findings": 500,
            "run_static_scanners": payload.run_static_scanners,
            "run_repository_tests": payload.run_repository_tests,
            "request_poc_proposals": payload.request_poc_proposals,
        },
        summary={
            "product": "CodeSentry",
            "generation_model": "granite-4.2",
            "embedding_model": "minilm",
            "audit_kind": "repository_audit",
        },
    )
    db.add(scan)
    await db.flush()

    run = ResearchRun(
        organization_id=organization_id,
        case_id=case.id,
        repository_id=repository.id,
        conversation_id=payload.conversation_id,
        requested_by_id=user.id,
        status=CaseStatus.QUEUED,
        current_stage="queued",
        blackboard={
            "repository_id": str(repository.id),
            "repository_name": repository.name,
            "repository_url": repository.remote_url,
            "codesentry_scan_id": str(scan.id),
            "conversation_id": payload.conversation_id,
            "plan": [
                "capture repository snapshot and run bounded static analysis",
                "search public advisories and recent security discussions",
                "correlate web evidence with declared dependencies and source findings",
                "run the fixed repository test profile in the isolated sandbox",
                "preserve a cited defensive report and reviewer queue",
            ],
        },
        settings={"profile": settings_obj.profile, **resolved},
        budget={
            "max_sources": resolved["max_sources"],
            "max_fetches": resolved["fetch_top"],
            "max_wall_seconds": resolved["wall_seconds"],
        },
    )
    db.add(run)
    await db.flush()
    db.add(
        AgentTask(
            run_id=run.id,
            agent_name="repository_security_scanner",
            task_type="repository_scan",
            input_payload={"instruction": "Capture and scan the linked repository snapshot."},
        )
    )
    await create_run_tasks(db, run)
    db.add(
        AgentEvent(
            organization_id=organization_id,
            run_id=run.id,
            agent_name="orchestrator",
            event_type="status",
            content="Repository audit queued with a linked CodeSentry scan.",
            payload={
                "stage": "queued",
                "repository_id": str(repository.id),
                "scan_id": str(scan.id),
            },
        )
    )
    await record_audit_event(
        db,
        action="repository_audit.queued",
        resource_type="research_run",
        resource_id=str(run.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"repository_id": str(repository.id), "scan_id": str(scan.id)},
    )
    await db.commit()
    await emit_scan_event(
        db,
        scan,
        event_type="scan_queued",
        stage="queued",
        message="Repository audit queued its linked CodeSentry scan.",
        payload={"scan_id": str(scan.id), "research_run_id": str(run.id)},
    )
    try:
        from app.worker import execute_research_run_task

        execute_research_run_task.delay(str(run.id), str(organization_id))
    except Exception:
        # The queued run and its trace remain available for a worker retry.
        pass
    await db.refresh(run)
    return run


@router.get("/organizations/{organization_id}/runs/{run_id}", response_model=ResearchRunRead)
async def get_run(
    organization_id: UUID,
    run_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> ResearchRun:
    await get_membership(organization_id, user, db)
    run = await db.get(ResearchRun, run_id)
    if run is None or run.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research run not found")
    return run


@router.get("/organizations/{organization_id}/runs", response_model=list[ResearchRunRead])
async def list_runs(
    organization_id: UUID,
    conversation_id: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=25, ge=1, le=100),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[ResearchRun]:
    await get_membership(organization_id, user, db)
    query = select(ResearchRun).where(ResearchRun.organization_id == organization_id)
    if conversation_id is not None:
        query = query.where(ResearchRun.conversation_id == conversation_id)
    result = await db.scalars(
        query.order_by(ResearchRun.created_at.desc(), ResearchRun.id.desc()).limit(limit)
    )
    return list(result)


@router.get(
    "/organizations/{organization_id}/runs/{run_id}/tasks", response_model=list[AgentTaskRead]
)
async def list_run_tasks(
    organization_id: UUID,
    run_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[AgentTask]:
    await get_membership(organization_id, user, db)
    run = await db.get(ResearchRun, run_id)
    if run is None or run.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research run not found")
    result = await db.scalars(
        select(AgentTask).where(AgentTask.run_id == run_id).order_by(AgentTask.created_at)
    )
    return list(result)


@router.get(
    "/organizations/{organization_id}/cases/{case_id}/runs", response_model=list[ResearchRunRead]
)
async def list_case_runs(
    organization_id: UUID,
    case_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[ResearchRun]:
    await get_membership(organization_id, user, db)
    case = await db.get(ResearchCase, case_id)
    if case is None or case.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research case not found")
    result = await db.scalars(
        select(ResearchRun)
        .where(ResearchRun.case_id == case_id)
        .order_by(ResearchRun.created_at.desc())
        .limit(25)
    )
    return list(result)


@router.post(
    "/organizations/{organization_id}/runs/{run_id}/cancel", response_model=ResearchRunRead
)
async def cancel_research_run(
    organization_id: UUID,
    run_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> ResearchRun:
    membership = await get_membership(organization_id, user, db)
    if membership.role not in {MembershipRole.ADMIN, MembershipRole.ANALYST}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
    run = await db.get(ResearchRun, run_id)
    if run is None or run.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research run not found")
    if run.status in {CaseStatus.COMPLETED, CaseStatus.FAILED, CaseStatus.CANCELLED}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Run already finished")
    now = datetime.now(UTC)
    run.cancelled_at = now
    linked_scan: CodeSentryScanRun | None = None
    linked_scan_cancelled = False
    linked_scan_id = (run.blackboard or {}).get("codesentry_scan_id")
    if isinstance(linked_scan_id, str):
        try:
            linked_scan = await db.get(CodeSentryScanRun, UUID(linked_scan_id))
        except ValueError:
            linked_scan = None
        if linked_scan is not None and linked_scan.organization_id == organization_id:
            if linked_scan.status not in {
                ScanStatus.COMPLETED.value,
                ScanStatus.INCOMPLETE.value,
                ScanStatus.FAILED.value,
                ScanStatus.CANCELLED.value,
            }:
                linked_scan.status = ScanStatus.CANCELLED.value
                linked_scan.current_stage = "cancelled_by_user"
                linked_scan.cancelled_at = now
                linked_scan.completed_at = now
                linked_scan_cancelled = True
    if run.status == CaseStatus.QUEUED:
        run.status = CaseStatus.CANCELLED
        run.current_stage = "cancelled_before_start"
        run.completed_at = now
        for task in (await db.scalars(select(AgentTask).where(AgentTask.run_id == run.id))).all():
            task.status = TaskStatus.SKIPPED
        case = await db.get(ResearchCase, run.case_id)
        if case is not None:
            case.status = CaseStatus.CANCELLED
    run_status = run.status.value if isinstance(run.status, CaseStatus) else str(run.status)
    db.add(
        AgentEvent(
            organization_id=organization_id,
            run_id=run.id,
            agent_name="orchestrator",
            event_type="status",
            content=(
                "Run cancelled before worker start."
                if run.status == CaseStatus.CANCELLED
                else "Run cancellation requested; the worker will stop at its next checkpoint."
            ),
            payload={
                "stage": run.current_stage,
                "status": run_status,
                "cancellation_requested": True,
            },
        )
    )
    await record_audit_event(
        db,
        action="research_run.cancel_requested",
        resource_type="research_run",
        resource_id=str(run.id),
        organization_id=organization_id,
        actor_id=user.id,
    )
    await db.commit()
    if linked_scan is not None and linked_scan_cancelled:
        await emit_scan_event(
            db,
            linked_scan,
            event_type="scan_cancelled",
            stage="cancelled_by_user",
            message="Linked repository scan cancelled with the research run.",
            payload={"research_run_id": str(run.id)},
        )
    await db.refresh(run)
    return run


@router.get(
    "/organizations/{organization_id}/runs/{run_id}/events",
    response_model=list[AgentEventRead],
)
async def list_run_events(
    organization_id: UUID,
    run_id: UUID,
    after: UUID | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[AgentEvent]:
    await get_membership(organization_id, user, db)
    run = await db.get(ResearchRun, run_id)
    if run is None or run.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research run not found")
    query = select(AgentEvent).where(AgentEvent.run_id == run_id)
    if after is not None:
        anchor = await db.get(AgentEvent, after)
        if anchor is not None and anchor.run_id == run_id:
            query = query.where(
                or_(
                    AgentEvent.created_at > anchor.created_at,
                    and_(AgentEvent.created_at == anchor.created_at, AgentEvent.id > anchor.id),
                )
            )
    result = await db.scalars(query.order_by(AgentEvent.created_at, AgentEvent.id).limit(limit))
    return list(result)


async def _run_event_stream(
    organization_id: UUID, run_id: UUID, after: UUID | None
) -> AsyncIterator[str]:
    cursor = after
    idle_ticks = 0
    terminal_statuses = {CaseStatus.COMPLETED, CaseStatus.FAILED, CaseStatus.CANCELLED}
    while True:
        rows: list[AgentEvent] = []
        terminal = False
        async with SessionLocal() as session:
            await set_organization_context(session, organization_id)
            run = await session.get(ResearchRun, run_id)
            if run is None or run.organization_id != organization_id:
                return
            query = select(AgentEvent).where(
                AgentEvent.organization_id == organization_id,
                AgentEvent.run_id == run_id,
            )
            if cursor is not None:
                anchor = await session.get(AgentEvent, cursor)
                if anchor is not None and anchor.run_id == run_id:
                    query = query.where(
                        or_(
                            AgentEvent.created_at > anchor.created_at,
                            and_(
                                AgentEvent.created_at == anchor.created_at,
                                AgentEvent.id > anchor.id,
                            ),
                        )
                    )
            rows = list(
                await session.scalars(
                    query.order_by(AgentEvent.created_at, AgentEvent.id).limit(200)
                )
            )
            terminal = run.status in terminal_statuses
        for row in rows:
            cursor = row.id
            payload = AgentEventRead.model_validate(row).model_dump(mode="json")
            yield f"id: {row.id}\nevent: {row.event_type}\ndata: {json.dumps(payload)}\n\n"
        if rows:
            idle_ticks = 0
        else:
            idle_ticks += 1
            if idle_ticks % 15 == 0:
                yield ": keep-alive\n\n"
        if terminal and not rows:
            return
        await asyncio.sleep(0.5)


@router.get("/organizations/{organization_id}/runs/{run_id}/events/stream")
async def stream_run_events(
    organization_id: UUID,
    run_id: UUID,
    after: UUID | None = Query(default=None),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    await get_membership(organization_id, user, db)
    run = await db.get(ResearchRun, run_id)
    if run is None or run.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research run not found")
    if after is None and last_event_id:
        try:
            after = UUID(last_event_id)
        except ValueError:
            after = None
    return StreamingResponse(
        _run_event_stream(organization_id, run_id, after),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/organizations/{organization_id}/sources", response_model=list[SourceRecordRead])
async def list_sources(
    organization_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    await get_membership(organization_id, user, db)
    result = await db.execute(
        select(Source, SourceVersion)
        .join(SourceVersion, SourceVersion.source_id == Source.id)
        .where(Source.organization_id == organization_id)
        .order_by(SourceVersion.fetched_at.desc())
        .limit(200)
    )
    rows = result.all()
    version_ids = [version.id for _, version in rows]
    chunk_counts: dict[UUID, tuple[int, int]] = {}
    if version_ids:
        stats = await db.execute(
            select(
                DocumentChunk.source_version_id,
                func.count(),
                func.count(DocumentChunk.embedding),
            )
            .where(DocumentChunk.source_version_id.in_(version_ids))
            .group_by(DocumentChunk.source_version_id)
        )
        chunk_counts = {vid: (total, embedded) for vid, total, embedded in stats.all()}
    return [
        {
            "id": str(source.id),
            "title": source.title,
            "url": source.canonical_url,
            "tier": source.source_tier,
            "version_id": str(version.id),
            "content_hash": version.content_hash,
            "fetched_at": version.fetched_at,
            "chunks": chunk_counts.get(version.id, (0, 0))[0],
            "embedded": chunk_counts.get(version.id, (0, 0))[1],
        }
        for source, version in rows
    ]


@router.get("/organizations/{organization_id}/sources/export")
async def export_sources(
    organization_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Export curated source text and chunks without exposing embeddings."""
    await get_membership(organization_id, user, db)
    result = await db.execute(
        select(Source, SourceVersion, DocumentChunk)
        .join(SourceVersion, SourceVersion.source_id == Source.id)
        .outerjoin(DocumentChunk, DocumentChunk.source_version_id == SourceVersion.id)
        .where(Source.organization_id == organization_id)
        .order_by(SourceVersion.fetched_at.desc(), DocumentChunk.ordinal)
    )
    grouped: dict[UUID, dict[str, object]] = {}
    for source, version, chunk in result.all():
        record = grouped.setdefault(
            version.id,
            {
                "source_id": str(source.id),
                "version_id": str(version.id),
                "url": source.canonical_url,
                "title": source.title,
                "tier": source.source_tier,
                "content_hash": version.content_hash,
                "fetched_at": version.fetched_at,
                "extracted_text": version.extracted_text,
                "chunks": [],
            },
        )
        if chunk is not None:
            chunks = record["chunks"]
            if isinstance(chunks, list):
                chunks.append(
                    {
                        "id": str(chunk.id),
                        "ordinal": chunk.ordinal,
                        "content": chunk.content,
                        "metadata": chunk.metadata_json,
                    }
                )
    payload = {
        "organization_id": str(organization_id),
        "exported_at": datetime.now(UTC).isoformat(),
        "sources": list(grouped.values()),
    }
    return Response(
        content=json.dumps(payload, default=str),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="codesentry-memory.json"'},
    )


@router.get("/organizations/{organization_id}/retrieve")
async def retrieve_evidence(
    organization_id: UUID,
    query: str = Query(min_length=3, max_length=2_000),
    limit: int = Query(default=8, ge=1, le=20),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await get_membership(organization_id, user, db)
    hits = await hybrid_retrieve(db, organization_id=organization_id, query=query, limit=limit)
    version_ids = [hit.source_version_id for hit in hits]
    tiers: dict[UUID, str] = {}
    if version_ids:
        tier_rows = await db.execute(
            select(SourceVersion.id, Source.source_tier)
            .join(Source, Source.id == SourceVersion.source_id)
            .where(SourceVersion.id.in_(version_ids))
        )
        tiers = {vid: tier for vid, tier in tier_rows.all()}
    return {
        "query": query,
        "similarity_explanation": (
            "Semantic score is cosine similarity, not a probability or proof. "
            "Fusion score uses reciprocal-rank "
            "fusion across dense MiniLM and PostgreSQL lexical retrieval."
        ),
        "hits": [
            {
                "chunk_id": str(hit.chunk_id),
                "source_version_id": str(hit.source_version_id),
                "source_url": hit.source_url,
                "source_title": hit.source_title,
                "source_tier": tiers.get(hit.source_version_id),
                "content": hit.content,
                "semantic_score": hit.semantic_score,
                "lexical_rank": hit.lexical_rank,
                "fusion_score": hit.fusion_score,
            }
            for hit in hits
        ],
    }


@router.post(
    "/organizations/{organization_id}/tools/calculator",
    response_model=CalculatorResult,
)
async def calculate_expression(
    organization_id: UUID,
    payload: CalculatorRequest,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Run a deterministic calculator without exposing general code execution."""
    await get_membership(organization_id, user, db)
    result = calculate(payload.expression)
    await record_audit_event(
        db,
        action="tool.calculator_used",
        resource_type="calculator",
        resource_id=None,
        organization_id=organization_id,
        actor_id=user.id,
        details={"successful": result["error"] is None},
    )
    await db.commit()
    return result


async def _execute_in_sandbox(organization_id: UUID, code: str, input_json: dict) -> SandboxResult:
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.post(
                f"{settings.sandbox_url}/v1/execute",
                json={"code": code, "input_json": input_json},
                headers={"X-Sandbox-Token": settings.sandbox_service_token or ""},
            )
            response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Sandbox service is unavailable") from None
    return SandboxResult.model_validate(response.json())


@router.post(
    "/organizations/{organization_id}/sandbox/proposals",
    response_model=CodeProposalRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_code_proposal(
    organization_id: UUID,
    payload: CodeProposalCreate,
    request: Request,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> CodeProposal:
    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    await _limit_expensive_action(request, user, organization_id)
    try:
        from app.sandbox import validate_code

        validate_code(payload.code)
    except HTTPException as exc:
        raise HTTPException(status_code=422, detail=str(exc.detail)) from None
    except Exception:
        raise HTTPException(
            status_code=422, detail="Code failed static sandbox validation"
        ) from None
    proposal = CodeProposal(
        organization_id=organization_id,
        case_id=payload.case_id,
        run_id=None,
        title=payload.title,
        purpose=payload.purpose,
        code=payload.code,
        input_json=payload.input_json,
        proposed_by_id=user.id,
    )
    db.add(proposal)
    await record_audit_event(
        db,
        action="sandbox.proposed",
        resource_type="code_proposal",
        resource_id=str(proposal.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"code_characters": len(payload.code)},
    )
    await db.commit()
    await db.refresh(proposal)
    return proposal


@router.get(
    "/organizations/{organization_id}/sandbox/proposals", response_model=list[CodeProposalRead]
)
async def list_code_proposals(
    organization_id: UUID,
    proposal_status: ProposalStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[CodeProposal]:
    await get_membership(organization_id, user, db)
    query = select(CodeProposal).where(CodeProposal.organization_id == organization_id)
    if proposal_status is not None:
        query = query.where(CodeProposal.status == proposal_status)
    result = await db.scalars(query.order_by(CodeProposal.created_at.desc()).limit(limit))
    return list(result)


@router.get(
    "/organizations/{organization_id}/sandbox/proposals/{proposal_id}",
    response_model=CodeProposalRead,
)
async def get_code_proposal(
    organization_id: UUID,
    proposal_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> CodeProposal:
    await get_membership(organization_id, user, db)
    proposal = await db.get(CodeProposal, proposal_id)
    if proposal is None or proposal.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    return proposal


@router.post(
    "/organizations/{organization_id}/sandbox/proposals/{proposal_id}/approve",
    response_model=CodeProposalRead,
)
async def approve_code_proposal(
    organization_id: UUID,
    proposal_id: UUID,
    request: Request,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> CodeProposal:
    membership = await get_membership(
        organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST
    )
    await _limit_expensive_action(request, user, organization_id)
    proposal = await db.get(CodeProposal, proposal_id)
    if proposal is None or proposal.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    if proposal.status != ProposalStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Proposal already decided")

    now = datetime.now(UTC)
    proposal.status = ProposalStatus.APPROVED
    proposal.reviewed_by_id = user.id
    proposal.reviewed_at = now
    await record_audit_event(
        db,
        action="sandbox.approved",
        resource_type="code_proposal",
        resource_id=str(proposal.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"role": membership.role.value},
    )
    try:
        result = await _execute_in_sandbox(
            organization_id, proposal.code, proposal.input_json or {}
        )
        proposal.result_payload = result.model_dump()
        proposal.status = (
            ProposalStatus.EXECUTED if result.exit_code == 0 else ProposalStatus.FAILED
        )
        proposal.executed_at = datetime.now(UTC)
        if proposal.status == ProposalStatus.FAILED:
            proposal.error = (result.stderr or f"Exit code {result.exit_code}")[:2_000]
    except HTTPException as exc:
        proposal.status = ProposalStatus.FAILED
        proposal.error = exc.detail if isinstance(exc.detail, str) else "Sandbox unavailable"
        proposal.executed_at = datetime.now(UTC)
    await record_audit_event(
        db,
        action="sandbox.executed",
        resource_type="code_proposal",
        resource_id=str(proposal.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"status": proposal.status.value},
    )
    await db.commit()

    if proposal.run_id is not None:
        run = await db.get(ResearchRun, proposal.run_id)
        if (
            run is not None
            and run.current_stage == "awaiting_code_approval"
            and run.status == CaseStatus.RUNNING
        ):
            from app.worker import execute_research_run_task

            execute_research_run_task.delay(str(run.id), str(organization_id))
    await db.refresh(proposal)
    return proposal


@router.post(
    "/organizations/{organization_id}/sandbox/proposals/{proposal_id}/reject",
    response_model=CodeProposalRead,
)
async def reject_code_proposal(
    organization_id: UUID,
    proposal_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> CodeProposal:
    membership = await get_membership(
        organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST
    )
    proposal = await db.get(CodeProposal, proposal_id)
    if proposal is None or proposal.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    if proposal.status != ProposalStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Proposal already decided")
    proposal.status = ProposalStatus.REJECTED
    proposal.error = "Rejected by reviewer"
    proposal.reviewed_by_id = user.id
    proposal.reviewed_at = datetime.now(UTC)
    await record_audit_event(
        db,
        action="sandbox.rejected",
        resource_type="code_proposal",
        resource_id=str(proposal.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"role": membership.role.value},
    )
    await db.commit()
    if proposal.run_id is not None:
        run = await db.get(ResearchRun, proposal.run_id)
        if (
            run is not None
            and run.current_stage == "awaiting_code_approval"
            and run.status == CaseStatus.RUNNING
        ):
            from app.worker import execute_research_run_task

            execute_research_run_task.delay(str(run.id), str(organization_id))
    await db.refresh(proposal)
    return proposal


@router.post("/organizations/{organization_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    organization_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    await _limit_expensive_action(request, user, organization_id)
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File exceeds the upload limit")
    filename = file.filename or "upload.bin"
    try:
        source, version = await persist_user_document(
            db, organization_id=organization_id, filename=filename, data=data
        )
    except UnsupportedDocumentError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    embedded = 0
    if (version.extracted_text or "").strip():
        embedded = await embed_chunks_for_version(db, version.id)
    await record_audit_event(
        db,
        action="document.uploaded",
        resource_type="source",
        resource_id=str(source.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"filename": filename, "kind": version.metadata_json.get("kind")},
    )
    await db.commit()
    kind = version.metadata_json.get("kind", "document")
    detail = (
        "Image stored; the agent can propose sandbox code to analyze it."
        if kind == "image"
        else f"Extracted and embedded {embedded} chunks into memory."
    )
    return {
        "detail": f"Document ingested. {detail}",
        "source_id": str(source.id),
        "version_id": str(version.id),
        "kind": kind,
        "chunks_embedded": embedded,
    }


@router.delete("/organizations/{organization_id}/sources/{source_id}", response_model=Message)
async def delete_source(
    organization_id: UUID,
    source_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Message:
    membership = await get_membership(
        organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST
    )
    source = await db.get(Source, source_id)
    if source is None or source.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    versions = list(
        await db.scalars(select(SourceVersion).where(SourceVersion.source_id == source.id))
    )
    storage_keys = [
        version.metadata_json["storage_key"]
        for version in versions
        if isinstance(version.metadata_json, dict)
        and isinstance(version.metadata_json.get("storage_key"), str)
    ]
    await db.delete(source)
    await record_audit_event(
        db,
        action="memory.source_deleted",
        resource_type="source",
        resource_id=str(source.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"role": membership.role.value},
    )
    await db.commit()
    await delete_document_originals(storage_keys)
    return Message(detail="Source and its chunks were removed from memory.")


@router.post("/organizations/{organization_id}/sources/{source_id}/reembed", response_model=Message)
async def reembed_source(
    organization_id: UUID,
    source_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Message:
    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    source = await db.get(Source, source_id)
    if source is None or source.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    version = await db.scalar(
        select(SourceVersion)
        .where(SourceVersion.source_id == source.id)
        .order_by(SourceVersion.fetched_at.desc())
        .limit(1)
    )
    if version is None:
        raise HTTPException(status_code=404, detail="Source has no versions")
    embedded = await embed_chunks_for_version(db, version.id)
    await db.commit()
    return Message(detail=f"Embedded {embedded} chunks for the latest version.")


@router.post(
    "/organizations/{organization_id}/repositories", response_model=RepositoryRead, status_code=201
)
async def add_repository(
    organization_id: UUID,
    payload: RepositoryCreate,
    request: Request,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Repository:
    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    await _limit_expensive_action(request, user, organization_id)
    remote_url: str | None = None
    if payload.remote_url is not None:
        try:
            remote_url = validate_github_url(str(payload.remote_url))
        except RepositorySafetyError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    repository = Repository(
        organization_id=organization_id, name=payload.name, remote_url=remote_url
    )
    db.add(repository)
    await db.flush()
    await record_audit_event(
        db,
        action="repository.queued",
        resource_type="repository",
        resource_id=str(repository.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"remote_url": remote_url},
    )
    await db.commit()
    if remote_url:
        try:
            from app.worker import analyze_repository_task

            analyze_repository_task.delay(str(repository.id), str(organization_id))
        except Exception:
            pass
    await db.refresh(repository)
    return repository


@router.get("/organizations/{organization_id}/repositories", response_model=list[RepositoryRead])
async def list_repositories(
    organization_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[Repository]:
    await get_membership(organization_id, user, db)
    result = await db.scalars(
        select(Repository)
        .where(Repository.organization_id == organization_id)
        .order_by(Repository.created_at.desc())
    )
    return list(result)


@router.post(
    "/organizations/{organization_id}/repositories/archive",
    response_model=RepositoryRead,
    status_code=201,
)
async def add_repository_archive(
    organization_id: UUID,
    request: Request,
    archive: UploadFile = File(...),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Repository:
    """Ingest a local source archive without granting the API host-path access."""
    await get_membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    await _limit_expensive_action(request, user, organization_id)
    if not archive.filename or not archive.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=422, detail="Upload a .zip archive of a folder or repository"
        )
    target = Path("/srv/app/workspaces") / f"upload-{uuid.uuid4()}"
    staged_archive = target.with_suffix(".zip")
    try:
        staged_archive.parent.mkdir(parents=True, exist_ok=True)
        uploaded_bytes = 0
        with staged_archive.open("wb") as staged:
            while chunk := await archive.read(64 * 1024):
                uploaded_bytes += len(chunk)
                if uploaded_bytes > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail="Archive exceeds the upload limit")
                staged.write(chunk)
        with zipfile.ZipFile(staged_archive) as zipped:
            if len(zipped.infolist()) > 20_000:
                raise HTTPException(status_code=422, detail="Archive contains too many files")
            uncompressed_bytes = sum(item.file_size for item in zipped.infolist())
            if uncompressed_bytes > settings.max_repository_bytes:
                raise HTTPException(
                    status_code=413, detail="Archive expands beyond the configured safety limit"
                )
            target.mkdir(parents=True, exist_ok=False)
            for item in zipped.infolist():
                relative = Path(item.filename)
                if relative.is_absolute() or ".." in relative.parts or item.is_dir():
                    if relative.is_absolute() or ".." in relative.parts:
                        raise HTTPException(
                            status_code=422, detail="Archive contains an unsafe path"
                        )
                    continue
                if (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise HTTPException(
                        status_code=422, detail="Symbolic links are not accepted in archives"
                    )
                if item.flag_bits & 0x1:
                    raise HTTPException(
                        status_code=422,
                        detail="Encrypted archives are not accepted",
                    )
                if item.file_size > settings.max_repository_file_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail="Archive contains an oversized file",
                    )
                if item.compress_size and item.file_size / item.compress_size > 100:
                    raise HTTPException(
                        status_code=422,
                        detail="Archive compression ratio is unsafe",
                    )
                destination = target / relative
                if not destination.resolve().is_relative_to(target.resolve()):
                    raise HTTPException(status_code=422, detail="Archive contains an unsafe path")
                destination.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(item) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output, length=64 * 1024)
    except zipfile.BadZipFile as exc:
        shutil.rmtree(target, ignore_errors=True)
        staged_archive.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="Invalid ZIP archive") from exc
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        staged_archive.unlink(missing_ok=True)
        raise
    finally:
        await archive.close()
    staged_archive.unlink(missing_ok=True)
    repository = Repository(
        organization_id=organization_id,
        name=Path(archive.filename).stem,
        status="queued",
        manifest={"workspace_path": str(target), "ingest": "local_zip"},
    )
    db.add(repository)
    await db.flush()
    await record_audit_event(
        db,
        action="repository.archive_queued",
        resource_type="repository",
        resource_id=str(repository.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"filename": archive.filename},
    )
    await db.commit()
    try:
        from app.worker import analyze_repository_task

        analyze_repository_task.delay(str(repository.id), str(organization_id))
    except Exception:
        pass
    await db.refresh(repository)
    return repository


@router.post(
    "/organizations/{organization_id}/artifacts", response_model=ArtifactRead, status_code=201
)
async def create_new_artifact(
    organization_id: UUID,
    payload: ArtifactCreate,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Artifact:
    await get_membership(
        organization_id,
        user,
        db,
        MembershipRole.ADMIN,
        MembershipRole.ANALYST,
        MembershipRole.REVIEWER,
    )
    if payload.case_id is not None:
        case = await db.get(ResearchCase, payload.case_id)
        if case is None or case.organization_id != organization_id:
            raise HTTPException(status_code=404, detail="Research case not found")
    artifact = await create_artifact(
        db,
        organization_id=organization_id,
        created_by_id=user.id,
        kind=payload.kind,
        title=payload.title,
        content=payload.content,
        sections=payload.sections,
        case_id=payload.case_id,
    )
    await record_audit_event(
        db,
        action="artifact.created",
        resource_type="artifact",
        resource_id=str(artifact.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"kind": payload.kind.value},
    )
    await db.commit()
    await db.refresh(artifact)
    return artifact


@router.get("/organizations/{organization_id}/artifacts", response_model=list[ArtifactRead])
async def list_artifacts(
    organization_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[Artifact]:
    await get_membership(organization_id, user, db)
    result = await db.scalars(
        select(Artifact)
        .where(Artifact.organization_id == organization_id)
        .order_by(Artifact.created_at.desc())
    )
    return list(result)


@router.post(
    "/organizations/{organization_id}/artifacts/{artifact_id}/revisions",
    response_model=ArtifactRead,
    status_code=201,
)
async def revise_artifact(
    organization_id: UUID,
    artifact_id: UUID,
    payload: ArtifactCreate,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Artifact:
    await get_membership(
        organization_id,
        user,
        db,
        MembershipRole.ADMIN,
        MembershipRole.ANALYST,
        MembershipRole.REVIEWER,
    )
    current = await db.get(Artifact, artifact_id)
    if current is None or current.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if payload.kind != current.kind:
        raise HTTPException(status_code=422, detail="An artifact revision cannot change format")
    revised = await create_artifact(
        db,
        organization_id=organization_id,
        created_by_id=user.id,
        kind=current.kind,
        title=payload.title,
        content=payload.content,
        sections=payload.sections,
        case_id=current.case_id,
        revision=current.revision + 1,
    )
    revised.metadata_json = {**revised.metadata_json, "parent_artifact_id": str(current.id)}
    await record_audit_event(
        db,
        action="artifact.revised",
        resource_type="artifact",
        resource_id=str(revised.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"parent_artifact_id": str(current.id)},
    )
    await db.commit()
    await db.refresh(revised)
    return revised


@router.get("/organizations/{organization_id}/artifacts/{artifact_id}/download")
async def download_artifact(
    organization_id: UUID,
    artifact_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await get_membership(organization_id, user, db)
    artifact = await db.get(Artifact, artifact_id)
    if artifact is None or artifact.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return Response(
        content=await read_artifact_bytes(artifact),
        media_type=str(artifact.metadata_json.get("content_type", "application/octet-stream")),
        headers={
            "Content-Disposition": f'attachment; filename="{Path(artifact.storage_key).name}"'
        },
    )
