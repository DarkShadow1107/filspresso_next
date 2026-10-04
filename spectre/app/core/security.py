import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import get_settings

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerifyMismatchError):
        return False


def _token_claims(
    user_id: UUID, session_id: UUID, token_type: str, expires_at: datetime
) -> dict[str, str | int]:
    issued_at = datetime.now(UTC)
    return {
        "sub": str(user_id),
        "sid": str(session_id),
        "jti": str(uuid4()),
        "type": token_type,
        "iss": "codesentry",
        "aud": "codesentry-browser",
        "iat": int(issued_at.timestamp()),
        "nbf": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }


def create_access_token(user_id: UUID, session_id: UUID | None = None) -> str:
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.jwt_access_minutes)
    return jwt.encode(
        _token_claims(user_id, session_id or uuid4(), "access", expires_at),
        settings.app_secret,
        algorithm=settings.jwt_algorithm,
    )


def create_refresh_token(user_id: UUID, session_id: UUID) -> str:
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(days=settings.jwt_refresh_days)
    return jwt.encode(
        _token_claims(user_id, session_id, "refresh", expires_at),
        settings.app_secret,
        algorithm=settings.jwt_algorithm,
    )


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def random_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def decode_token(token: str, expected_type: str) -> tuple[UUID, UUID]:
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.app_secret,
        algorithms=[settings.jwt_algorithm],
        issuer="codesentry",
        audience="codesentry-browser",
        options={"require": ["exp", "iat", "nbf", "jti", "sub", "sid"]},
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"Token is not a {expected_type} token")
    return UUID(str(payload["sub"])), UUID(str(payload["sid"]))


def decode_access_token(token: str) -> UUID:
    user_id, _ = decode_token(token, "access")
    return user_id
