import hashlib

from fastapi import HTTPException, Request, status
from redis import asyncio as redis_asyncio
from redis.exceptions import RedisError

from app.core.config import get_settings


def _client_identifier(request: Request, subject: str = "") -> str:
    address = request.client.host if request.client else "unknown"
    return hashlib.sha256(f"{address}:{subject.lower()}".encode()).hexdigest()


async def enforce_rate_limit(
    request: Request, *, scope: str, limit: int, window_seconds: int, subject: str = ""
) -> None:
    settings = get_settings()
    client = redis_asyncio.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    key = f"spectre:rate:{scope}:{_client_identifier(request, subject)}"
    try:
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, window_seconds)
        if count > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again later.",
                headers={"Retry-After": str(window_seconds)},
            )
    except RedisError:
        if settings.rate_limit_fail_closed:
            raise HTTPException(status_code=503, detail="Rate limiter is unavailable") from None
    finally:
        await client.aclose()
