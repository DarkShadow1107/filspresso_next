import pytest
from pydantic import ValidationError

from app.schemas import UserMemoryRecordCreate
from app.services.user_memory import (
    MAX_MEMORY_RECORD_BYTES,
    ensure_memory_content_size,
    memory_safe_source_url,
)


def test_memory_content_is_bounded_by_utf8_bytes() -> None:
    ensure_memory_content_size("a" * MAX_MEMORY_RECORD_BYTES)

    with pytest.raises(ValueError, match="maximum size"):
        ensure_memory_content_size("a" * (MAX_MEMORY_RECORD_BYTES + 1))


def test_memory_record_schema_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        UserMemoryRecordCreate(content="remember this", unexpected=True)  # type: ignore[call-arg]


def test_memory_source_url_removes_credentials_and_query() -> None:
    assert (
        memory_safe_source_url("https://user:password@example.com/path?token=secret#fragment")
        == "https://example.com/path"
    )
