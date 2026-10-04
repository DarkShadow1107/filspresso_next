from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", secrets_dir="/run/secrets", case_sensitive=False
    )

    environment: str = "development"
    app_secret: str = "development-only-change-me"
    database_url: str = "postgresql+asyncpg://spectre:spectre@localhost:5432/spectre"
    migration_database_url: str | None = None
    redis_url: str = "redis://localhost:6379/0"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "spectre"
    minio_secret_key: str = "replace-this-minio-secret"
    minio_bucket: str = "spectre-artifacts"
    model_runtime_url: str = "http://localhost:8090"
    embedding_runtime_url: str = "http://localhost:8092"
    sandbox_url: str = "http://localhost:8091"
    cors_origins: str = "http://localhost:3000"
    trusted_hosts: str = "localhost,127.0.0.1,testserver"
    public_base_url: str = "https://127.0.0.1:8080"
    model_dir: Path = Field(default=Path("models"))
    auto_create_schema: bool = False
    max_upload_bytes: int = 52_428_800
    ddg_max_results: int = 8
    model_gpu_layers: int = 18
    jwt_algorithm: str = "HS256"
    jwt_access_minutes: int = 30
    jwt_refresh_days: int = 14
    session_cookie_secure: bool = False
    session_cookie_name: str = "sf_access"
    refresh_cookie_name: str = "sf_refresh"
    csrf_cookie_name: str = "sf_csrf"
    sandbox_service_token: str | None = None
    allow_bearer_auth: bool = True
    rate_limit_fail_closed: bool = False
    auth_rate_limit_per_hour: int = 10
    expensive_rate_limit_per_hour: int = 20
    max_repository_bytes: int = 262_144_000
    max_repository_file_bytes: int = 26_214_400
    proposal_timeout_seconds: int = 1_800

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        return [item.strip() for item in self.trusted_hosts.split(",") if item.strip()]

    @model_validator(mode="after")
    def validate_production_configuration(self) -> "Settings":
        if self.environment.lower() != "production":
            return self
        placeholders = {
            "development-only-change-me",
            "replace-with-a-long-random-secret",
"replace-this-minio-secret",
                "spectre",
                "spectre_app",
        }
        sensitive_values = {
            self.app_secret,
            self.minio_secret_key,
            self.sandbox_service_token or "",
        }
        if sensitive_values & placeholders or any(len(value) < 32 for value in sensitive_values):
            raise ValueError("Production secrets must be unique values of at least 32 characters")
        parsed_redis = urlparse(self.redis_url)
        if not parsed_redis.password:
            raise ValueError("Production Redis URL must include ACL credentials")
        if not self.session_cookie_secure or self.allow_bearer_auth:
            raise ValueError("Production requires secure cookie sessions and disables bearer auth")
        parsed_public_url = urlparse(self.public_base_url)
        if parsed_public_url.scheme != "https" or not parsed_public_url.hostname:
            raise ValueError("Production public base URL must be HTTPS")
        if any(not urlparse(origin).scheme == "https" for origin in self.cors_origin_list):
            raise ValueError("Production CORS origins must be HTTPS")
        if self.auto_create_schema:
            raise ValueError("AUTO_CREATE_SCHEMA must be disabled in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
