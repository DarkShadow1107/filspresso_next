from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db import SessionLocal, get_db, set_organization_context
from app.dependencies import local_default_user
from app.models import (
    SpectreFinding,
    SpectreLLMUsage,
    SpectrePoc,
    SpectreReport,
    SpectreScanEvent,
    SpectreScanRun,
    FindingSeverity,
    FindingStatus,
    Membership,
    MembershipRole,
    Repository,
    RepositoryFile,
    ScanStatus,
    User,
)
from app.schemas import (
    SpectreDecision,
    SpectreFindingRead,
    SpectreLLMUsageRead,
    SpectrePocRead,
    SpectreReportRead,
    SpectreRepositoryFileRead,
    SpectreScanCreate,
    SpectreScanEventRead,
    SpectreScanRead,
)
from app.services.artifacts import MinioArtifactStore
from app.services.audit import record_audit_event
from app.services.spectre import emit_scan_event
from app.services.spectre_reports import get_scan_report_bytes
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/organizations/{organization_id}", tags=["Spectre"])
settings = get_settings()


async def _membership(
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
        raise HTTPException(status_code=403, detail="Insufficient organization role")
    await set_organization_context(db, organization_id)
    return membership


async def _scan_or_404(db: AsyncSession, organization_id: UUID, scan_id: UUID) -> SpectreScanRun:
    scan = await db.get(SpectreScanRun, scan_id)
    if scan is None or scan.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Spectre scan not found")
    return scan


async def _rate_limit_scan(request: Request, user: User, organization_id: UUID) -> None:
    await enforce_rate_limit(
        request,
        scope="spectre_scan",
        limit=settings.expensive_rate_limit_per_hour,
        window_seconds=3600,
        subject=f"{user.id}:{organization_id}",
    )


@router.post(
    "/repositories/{repository_id}/scans",
    response_model=SpectreScanRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_scan(
    organization_id: UUID,
    repository_id: UUID,
    payload: SpectreScanCreate,
    request: Request,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> SpectreScanRun:
    await _membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    await _rate_limit_scan(request, user, organization_id)
    repository = await db.get(Repository, repository_id)
    if repository is None or repository.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Repository not found")
    active = await db.scalar(
        select(SpectreScanRun)
        .where(
            SpectreScanRun.organization_id == organization_id,
            SpectreScanRun.repository_id == repository_id,
            SpectreScanRun.status.in_(
                [
                    ScanStatus.QUEUED.value,
                    ScanStatus.RUNNING.value,
                    ScanStatus.AWAITING_APPROVAL.value,
                ]
            ),
        )
        .limit(1)
    )
    if active is not None:
        raise HTTPException(
            status_code=409, detail="Repository already has an active Spectre scan"
        )
    scan = SpectreScanRun(
        organization_id=organization_id,
        repository_id=repository_id,
        requested_by_id=user.id,
        status=ScanStatus.QUEUED.value,
        current_stage="queued",
        settings=payload.model_dump(),
        summary={
            "product": "Spectre",
            "generation_model": "granite-4.2",
            "embedding_model": "minilm",
        },
    )
    db.add(scan)
    await db.flush()
    await record_audit_event(
        db,
        action="spectre.scan_queued",
        resource_type="spectre_scan",
        resource_id=str(scan.id),
        organization_id=organization_id,
        actor_id=user.id,
        details={"repository_id": str(repository_id), "tier": payload.tier},
    )
    await db.commit()
    try:
        from app.worker import execute_spectre_scan_task

        execute_spectre_scan_task.delay(str(scan.id), str(organization_id))
    except Exception as exc:
        scan.status = ScanStatus.FAILED.value
        scan.current_stage = "failed_to_queue"
        scan.error = f"Unable to queue scan: {exc}"[:2_000]
        await db.commit()
        raise HTTPException(status_code=503, detail="Spectre worker is unavailable") from exc
    await emit_scan_event(
        db,
        scan,
        event_type="scan_queued",
        stage="queued",
        message="Spectre scan queued for the local worker.",
        payload={"scan_id": str(scan.id), "repository_id": str(repository_id)},
    )
    await db.refresh(scan)
    return scan


@router.get(
    "/repositories/{repository_id}/scans",
    response_model=list[SpectreScanRead],
)
async def list_repository_scans(
    organization_id: UUID,
    repository_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpectreScanRun]:
    await _membership(organization_id, user, db)
    result = await db.scalars(
        select(SpectreScanRun)
        .where(
            SpectreScanRun.organization_id == organization_id,
            SpectreScanRun.repository_id == repository_id,
        )
        .order_by(SpectreScanRun.created_at.desc(), SpectreScanRun.id.desc())
        .limit(limit)
    )
    return list(result)


@router.get("/scans/{scan_id}", response_model=SpectreScanRead)
async def get_scan(
    organization_id: UUID,
    scan_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> SpectreScanRun:
    await _membership(organization_id, user, db)
    return await _scan_or_404(db, organization_id, scan_id)


@router.post("/scans/{scan_id}/cancel", response_model=SpectreScanRead)
async def cancel_scan(
    organization_id: UUID,
    scan_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> SpectreScanRun:
    await _membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.ANALYST)
    scan = await _scan_or_404(db, organization_id, scan_id)
    if scan.status in {
        ScanStatus.COMPLETED.value,
        ScanStatus.INCOMPLETE.value,
        ScanStatus.FAILED.value,
        ScanStatus.CANCELLED.value,
    }:
        return scan
    scan.status = ScanStatus.CANCELLED.value
    scan.current_stage = "cancelled_by_user"
    scan.cancelled_at = datetime.now(UTC)
    scan.completed_at = datetime.now(UTC)
    await db.commit()
    await emit_scan_event(
        db,
        scan,
        event_type="scan_cancelled",
        stage="cancelled_by_user",
        message="Cancellation requested by the user.",
    )
    await db.refresh(scan)
    return scan


@router.get("/scans/{scan_id}/events", response_model=list[SpectreScanEventRead])
async def list_scan_events(
    organization_id: UUID,
    scan_id: UUID,
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpectreScanEvent]:
    await _membership(organization_id, user, db)
    await _scan_or_404(db, organization_id, scan_id)
    result = await db.scalars(
        select(SpectreScanEvent)
        .where(
            SpectreScanEvent.organization_id == organization_id,
            SpectreScanEvent.scan_run_id == scan_id,
            SpectreScanEvent.sequence > after,
        )
        .order_by(SpectreScanEvent.sequence)
        .limit(limit)
    )
    return list(result)


async def _event_stream(organization_id: UUID, scan_id: UUID, after: int) -> AsyncIterator[str]:
    cursor = after
    idle_ticks = 0
    while True:
        rows: list[SpectreScanEvent] = []
        terminal = False
        async with SessionLocal() as session:
            await set_organization_context(session, organization_id)
            scan = await session.get(SpectreScanRun, scan_id)
            if scan is None or scan.organization_id != organization_id:
                return
            rows = list(
                await session.scalars(
                    select(SpectreScanEvent)
                    .where(
                        SpectreScanEvent.organization_id == organization_id,
                        SpectreScanEvent.scan_run_id == scan_id,
                        SpectreScanEvent.sequence > cursor,
                    )
                    .order_by(SpectreScanEvent.sequence)
                    .limit(200)
                )
            )
            terminal = scan.status in {
                ScanStatus.COMPLETED.value,
                ScanStatus.INCOMPLETE.value,
                ScanStatus.FAILED.value,
                ScanStatus.CANCELLED.value,
            }
        for row in rows:
            cursor = row.sequence
            payload = SpectreScanEventRead.model_validate(row).model_dump(mode="json")
            yield f"id: {row.sequence}\nevent: {row.event_type}\ndata: {json.dumps(payload)}\n\n"
        if rows:
            idle_ticks = 0
        else:
            idle_ticks += 1
            if idle_ticks % 15 == 0:
                yield ": keep-alive\n\n"
        if terminal and not rows:
            return
        await asyncio.sleep(0.5)


@router.get("/scans/{scan_id}/events/stream")
async def stream_scan_events(
    organization_id: UUID,
    scan_id: UUID,
    after: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    await _membership(organization_id, user, db)
    await _scan_or_404(db, organization_id, scan_id)
    if after == 0 and last_event_id:
        try:
            after = max(0, int(last_event_id))
        except ValueError:
            after = 0
    return StreamingResponse(
        _event_stream(organization_id, scan_id, after),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/scans/{scan_id}/findings", response_model=list[SpectreFindingRead])
async def list_scan_findings(
    organization_id: UUID,
    scan_id: UUID,
    severity: FindingSeverity | None = None,
    finding_status: FindingStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=500, ge=1, le=2_000),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpectreFinding]:
    await _membership(organization_id, user, db)
    await _scan_or_404(db, organization_id, scan_id)
    query = select(SpectreFinding).where(
        SpectreFinding.organization_id == organization_id,
        SpectreFinding.scan_run_id == scan_id,
    )
    if severity is not None:
        query = query.where(SpectreFinding.severity == severity.value)
    if finding_status is not None:
        query = query.where(SpectreFinding.status == finding_status.value)
    result = await db.scalars(query.order_by(SpectreFinding.created_at).limit(limit))
    return list(result)


@router.get("/scans/{scan_id}/usage", response_model=list[SpectreLLMUsageRead])
async def list_scan_usage(
    organization_id: UUID,
    scan_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpectreLLMUsage]:
    await _membership(organization_id, user, db)
    await _scan_or_404(db, organization_id, scan_id)
    result = await db.scalars(
        select(SpectreLLMUsage)
        .where(
            SpectreLLMUsage.organization_id == organization_id,
            SpectreLLMUsage.scan_run_id == scan_id,
        )
        .order_by(SpectreLLMUsage.created_at)
    )
    return list(result)


@router.get("/scans/{scan_id}/files", response_model=list[SpectreRepositoryFileRead])
async def list_snapshot_files(
    organization_id: UUID,
    scan_id: UUID,
    query: str | None = Query(default=None, min_length=1, max_length=300),
    limit: int = Query(default=200, ge=1, le=2_000),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[RepositoryFile]:
    await _membership(organization_id, user, db)
    scan = await _scan_or_404(db, organization_id, scan_id)
    if scan.snapshot_id is None:
        return []
    statement = select(RepositoryFile).where(
        RepositoryFile.organization_id == organization_id,
        RepositoryFile.snapshot_id == scan.snapshot_id,
    )
    if query:
        statement = statement.where(RepositoryFile.path.ilike(f"%{query}%"))
    result = await db.scalars(statement.order_by(RepositoryFile.path).limit(limit))
    return list(result)


@router.get("/scans/{scan_id}/files/{file_id}")
async def read_snapshot_file(
    organization_id: UUID,
    scan_id: UUID,
    file_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _membership(organization_id, user, db)
    scan = await _scan_or_404(db, organization_id, scan_id)
    file_row = await db.get(RepositoryFile, file_id)
    if (
        file_row is None
        or file_row.organization_id != organization_id
        or file_row.snapshot_id != scan.snapshot_id
        or not file_row.content_storage_key
    ):
        raise HTTPException(status_code=404, detail="Snapshot file content not found")
    try:
        content = await MinioArtifactStore().get(file_row.content_storage_key)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Snapshot storage is unavailable") from exc
    if b"\x00" in content:
        raise HTTPException(status_code=415, detail="Binary snapshot files cannot be displayed")
    return PlainTextResponse(content.decode("utf-8", errors="replace"))


@router.get("/scans/{scan_id}/pocs", response_model=list[SpectrePocRead])
async def list_scan_pocs(
    organization_id: UUID,
    scan_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpectrePoc]:
    await _membership(organization_id, user, db)
    await _scan_or_404(db, organization_id, scan_id)
    result = await db.scalars(
        select(SpectrePoc)
        .where(
            SpectrePoc.organization_id == organization_id,
            SpectrePoc.scan_run_id == scan_id,
        )
        .order_by(SpectrePoc.created_at)
    )
    return list(result)


async def _decide_poc(
    organization_id: UUID,
    poc_id: UUID,
    payload: SpectreDecision,
    user: User,
    db: AsyncSession,
    approve: bool,
) -> SpectrePoc:
    await _membership(organization_id, user, db, MembershipRole.ADMIN, MembershipRole.REVIEWER)
    poc = await db.scalar(
        select(SpectrePoc)
        .where(SpectrePoc.id == poc_id, SpectrePoc.organization_id == organization_id)
        .with_for_update()
    )
    if poc is None:
        raise HTTPException(status_code=404, detail="PoC proposal not found")
    if poc.status != "pending":
        raise HTTPException(status_code=409, detail=f"PoC is already {poc.status}")
    now = datetime.now(UTC)
    poc.status = "approved" if approve else "rejected"
    poc.reviewed_by_id = user.id
    poc.reviewed_at = now
    if not approve:
        poc.error = payload.note or "Rejected by reviewer"
    await db.commit()
    scan = await db.get(SpectreScanRun, poc.scan_run_id)
    if scan is not None:
        await emit_scan_event(
            db,
            scan,
            event_type="poc_approved" if approve else "poc_rejected",
            stage="approval",
            message=(
                "PoC approved and queued for isolated execution."
                if approve
                else "PoC rejected by reviewer."
            ),
            payload={"poc_id": str(poc.id), "note": payload.note},
        )
    if approve:
        try:
            from app.worker import execute_spectre_poc_task

            execute_spectre_poc_task.delay(str(poc.id), str(organization_id))
        except Exception as exc:
            poc.status = "failed"
            poc.error = f"Unable to queue PoC execution: {exc}"[:2_000]
            await db.commit()
            raise HTTPException(status_code=503, detail="PoC executor is unavailable") from exc
    await db.refresh(poc)
    return poc


@router.post("/pocs/{poc_id}/approve", response_model=SpectrePocRead)
async def approve_poc(
    organization_id: UUID,
    poc_id: UUID,
    payload: SpectreDecision = SpectreDecision(),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> SpectrePoc:
    return await _decide_poc(organization_id, poc_id, payload, user, db, True)


@router.post("/pocs/{poc_id}/reject", response_model=SpectrePocRead)
async def reject_poc(
    organization_id: UUID,
    poc_id: UUID,
    payload: SpectreDecision = SpectreDecision(),
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> SpectrePoc:
    return await _decide_poc(organization_id, poc_id, payload, user, db, False)


@router.get("/scans/{scan_id}/reports", response_model=list[SpectreReportRead])
async def list_scan_reports(
    organization_id: UUID,
    scan_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpectreReport]:
    await _membership(organization_id, user, db)
    await _scan_or_404(db, organization_id, scan_id)
    result = await db.scalars(
        select(SpectreReport)
        .where(
            SpectreReport.organization_id == organization_id,
            SpectreReport.scan_run_id == scan_id,
        )
        .order_by(SpectreReport.format)
    )
    return list(result)


@router.get("/reports/{report_id}/download")
async def download_scan_report(
    organization_id: UUID,
    report_id: UUID,
    user: User = Depends(local_default_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _membership(organization_id, user, db)
    report = await db.get(SpectreReport, report_id)
    if report is None or report.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Spectre report not found")
    try:
        data = await get_scan_report_bytes(report)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Report storage is unavailable") from exc
    extension = "md" if report.format == "markdown" else report.format
    return Response(
        content=data,
        media_type=report.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="spectre-{report.id}.{extension}"'
        },
    )
