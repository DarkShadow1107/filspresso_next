from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserMemoryPreference, UserMemoryRecord
from app.services.ingestion import FetchedDocument, fetch_public_document

MAX_MEMORY_RECORD_BYTES = 16 * 1024
MAX_MEMORY_RECORDS = 1_000
MAX_MEMORY_SOURCE_URL_BYTES = 2_048


class MemoryDisabledError(Exception):
    pass


class MemoryRecordLimitError(Exception):
    pass


def ensure_memory_content_size(content: str) -> None:
    if not content.strip():
        raise ValueError("Memory content must not be blank")
    if len(content.encode("utf-8")) > MAX_MEMORY_RECORD_BYTES:
        raise ValueError("Memory content exceeds the maximum size")


async def require_writable_memory(
    db: AsyncSession, user_id: UUID, *, lock: bool = False
) -> UserMemoryPreference:
    query = select(UserMemoryPreference).where(UserMemoryPreference.user_id == user_id)
    if lock:
        query = query.with_for_update()
    preference = await db.scalar(query)
    if preference is None or not preference.enabled:
        raise MemoryDisabledError
    return preference


async def ensure_memory_capacity(db: AsyncSession, user_id: UUID) -> None:
    count = await db.scalar(
        select(func.count())
        .select_from(UserMemoryRecord)
        .where(UserMemoryRecord.user_id == user_id)
    )
    if (count or 0) >= MAX_MEMORY_RECORDS:
        raise MemoryRecordLimitError


async def capture_public_memory_url(url: str) -> FetchedDocument:
    document = await fetch_public_document(url, max_bytes=MAX_MEMORY_RECORD_BYTES)
    ensure_memory_content_size(document.text)
    return document


def memory_safe_source_url(url: str) -> str:
    """Retain a useful source reference without persisting query-string secrets."""
    parsed = urlsplit(url)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError("Captured URL is invalid")
    source_url = urlunsplit((parsed.scheme, parsed.hostname, parsed.path, "", ""))
    if len(source_url.encode("utf-8")) > MAX_MEMORY_SOURCE_URL_BYTES:
        raise ValueError("Captured URL exceeds the maximum size")
    return source_url
