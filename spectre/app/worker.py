import hashlib
from pathlib import Path
from uuid import UUID

from celery import Celery

from app.core.config import get_settings
from app.services.workflow import execute_research_run_sync

settings = get_settings()
celery_app = Celery("codesentry", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_soft_time_limit=1200,
    task_time_limit=1260,
    timezone="UTC",
    beat_schedule={
        "watchlist-tick": {
            "task": "app.worker.watchlist_tick",
            "schedule": 300.0,
        },
        "proposal-timeout-tick": {
            "task": "app.worker.proposal_timeout_tick",
            "schedule": 60.0,
        },
    },
)


@celery_app.task(
    name="app.worker.execute_research_run",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
)
def execute_research_run_task(self: object, run_id: str, organization_id: str) -> None:
    execute_research_run_sync(run_id, organization_id)


@celery_app.task(name="app.worker.proposal_timeout_tick")
def proposal_timeout_tick() -> int:
    import asyncio

    asyncio.run(_expire_stale_proposals())
    return 0


async def _expire_stale_proposals() -> None:
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from app.core.config import get_settings as _get_settings
    from app.db import SessionLocal, close_database, set_organization_context
    from app.models import (
        AgentTask,
        CaseStatus,
        CodeProposal,
        ProposalStatus,
        ResearchCase,
        ResearchRun,
        TaskStatus,
    )
    from app.services.workflow import execute_research_run_sync

    timeout_seconds = _get_settings().proposal_timeout_seconds
    now = datetime.now(UTC)
    try:
        async with SessionLocal() as session:
            stale = list(
                await session.scalars(
                    select(CodeProposal).where(
                        CodeProposal.status == ProposalStatus.PENDING,
                        CodeProposal.run_id.is_not(None),
                        CodeProposal.created_at < now - timedelta(seconds=timeout_seconds),
                    )
                )
            )
            for proposal in stale:
                proposal.status = ProposalStatus.REJECTED
                proposal.error = f"Auto-rejected after {timeout_seconds}s without a decision"
                proposal.reviewed_at = now
                await set_organization_context(session, proposal.organization_id)
                if proposal.run_id is not None:
                    task = await session.scalar(
                        select(AgentTask)
                        .where(
                            AgentTask.run_id == proposal.run_id,
                            AgentTask.task_type == "code_analysis",
                        )
                        .order_by(AgentTask.created_at)
                    )
                    if task is not None and task.status == TaskStatus.RUNNING:
                        task.status = TaskStatus.SKIPPED
                        task.result_payload = {
                            "status": "skipped_without_execution",
                            "reason": proposal.error,
                        }
                        task.completed_at = now
                await session.commit()
                if proposal.run_id is not None:
                    execute_research_run_sync(str(proposal.run_id), str(proposal.organization_id))

            # Reap runs the user cancelled but whose worker task already ended.
            reap_cutoff = now - timedelta(seconds=20)
            zombies = list(
                await session.scalars(
                    select(ResearchRun).where(
                        ResearchRun.status == CaseStatus.RUNNING,
                        ResearchRun.cancelled_at.is_not(None),
                        ResearchRun.cancelled_at < reap_cutoff,
                    )
                )
            )
            for run in zombies:
                await set_organization_context(session, run.organization_id)
                for task in (
                    await session.scalars(select(AgentTask).where(AgentTask.run_id == run.id))
                ).all():
                    if task.status in {TaskStatus.PENDING, TaskStatus.RUNNING}:
                        task.status = TaskStatus.SKIPPED
                        task.completed_at = now
                run.status = CaseStatus.CANCELLED
                run.current_stage = "cancelled_by_user"
                run.completed_at = now
                case_row = await session.get(ResearchCase, run.case_id)
                if case_row is not None and case_row.status == CaseStatus.RUNNING:
                    case_row.status = CaseStatus.CANCELLED
                await session.commit()
    finally:
        await close_database()


@celery_app.task(name="app.worker.watchlist_tick")
def watchlist_tick() -> None:
    """Reserved scheduler hook for persisted watchlists and source-change jobs."""


async def _analyze_repository(repository_id: str, organization_id: str) -> None:
    from app.db import SessionLocal, close_database, set_organization_context
    from app.models import Repository
    from app.services.ingestion import FetchedDocument, persist_fetched_document
    from app.services.rag import embed_chunks_for_version
    from app.services.repository import (
        build_repository_manifest,
        clone_repository,
        create_work_shards,
        static_security_findings,
        static_security_plan,
    )

    try:
        async with SessionLocal() as session:
            await set_organization_context(session, UUID(organization_id))
            repository = await session.get(Repository, UUID(repository_id))
            if repository is None or str(repository.organization_id) != organization_id:
                return
            repository.status = "running"
            await session.commit()
            checkout: Path | None = None
            try:
                if repository.remote_url:
                    checkout, commit_sha = clone_repository(
                        repository.remote_url, Path("/srv/app/workspaces")
                    )
                else:
                    workspace_path = repository.manifest.get("workspace_path")
                    if not isinstance(workspace_path, str):
                        raise ValueError("Local repository workspace is unavailable")
                    checkout, commit_sha = Path(workspace_path), "local-upload"
                manifest = build_repository_manifest(
                    checkout,
                    max_total_bytes=settings.max_repository_bytes,
                    max_file_bytes=settings.max_repository_file_bytes,
                )
                rag_files = 0
                rag_chunks = 0
                for file_item in list(manifest.get("files", []))[:250]:
                    relative = str(file_item.get("path", ""))
                    file_path = checkout / relative
                    if not file_path.is_file() or int(file_item.get("size", 0)) > 160_000:
                        continue
                    try:
                        text = file_path.read_text(encoding="utf-8", errors="ignore")
                    except OSError:
                        continue
                    if len(text.strip()) < 20 or "\x00" in text:
                        continue
                    code_document = FetchedDocument(
                        canonical_url=f"repo://{repository.id}/{relative}",
                        title=f"{repository.name}: {relative}",
                        text=text[:240_000],
                        content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                        content_type="text/plain",
                    )
                    version = await persist_fetched_document(
                        session,
                        organization_id=repository.organization_id,
                        document=code_document,
                        source_tier="repository",
                    )
                    rag_files += 1
                    rag_chunks += await embed_chunks_for_version(session, version.id)
                repository.commit_sha = commit_sha
                preserved_manifest = (
                    {
                        key: repository.manifest[key]
                        for key in ("workspace_path", "ingest")
                        if key in repository.manifest
                    }
                    if not repository.remote_url
                    else {}
                )
                repository.manifest = {
                    **manifest,
                    **preserved_manifest,
                    "shards": create_work_shards(manifest),
                    "static_scanners": static_security_plan(checkout),
                    "security_findings": static_security_findings(checkout),
                    "rag_files": rag_files,
                    "rag_chunks_embedded": rag_chunks,
                    "execution_policy": "Static scanners only; repository code is never executed.",
                }
                repository.status = "completed"
                await session.commit()
            except Exception as exc:
                repository.status = "failed"
                repository.manifest = {"error": str(exc)}
                await session.commit()
            finally:
                # Local uploads are the repository's source of truth for later CodeSentry scans.
                if checkout is not None and repository.remote_url:
                    import shutil

                    shutil.rmtree(checkout, ignore_errors=True)
    finally:
        # Avoid retaining asyncpg connections from a Celery task's closed event loop.
        await close_database()


@celery_app.task(
    name="app.worker.analyze_repository",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=2,
)
def analyze_repository_task(self: object, repository_id: str, organization_id: str) -> None:
    import asyncio

    asyncio.run(_analyze_repository(repository_id, organization_id))


@celery_app.task(
    name="app.worker.execute_codesentry_scan",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=2,
)
def execute_codesentry_scan_task(self: object, scan_id: str, organization_id: str) -> None:
    import asyncio

    from app.services.codesentry import execute_codesentry_scan

    async def runner() -> None:
        from app.db import SessionLocal, close_database

        try:
            async with SessionLocal() as session:
                await execute_codesentry_scan(session, UUID(scan_id), UUID(organization_id))
        finally:
            await close_database()

    asyncio.run(runner())


@celery_app.task(
    name="app.worker.execute_codesentry_poc",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=1,
)
def execute_codesentry_poc_task(self: object, poc_id: str, organization_id: str) -> None:
    import asyncio

    from app.services.codesentry import execute_codesentry_poc

    async def runner() -> None:
        from app.db import SessionLocal, close_database

        try:
            async with SessionLocal() as session:
                await execute_codesentry_poc(session, UUID(poc_id), UUID(organization_id))
        finally:
            await close_database()

    asyncio.run(runner())
