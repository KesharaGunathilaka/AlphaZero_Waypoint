from functools import lru_cache
from typing import Literal, Self
from uuid import uuid4

from pydantic import PositiveInt, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL, make_url


class Settings(BaseSettings):
    """Central app configuration, loaded from environment / .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    APP_NAME: str = "MedStudent.lk Backend"
    ENVIRONMENT: Literal["development", "production"] = "production"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGINS: list[str] = []
    ALLOWED_HOSTS: list[str] = ["localhost"]
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    RATE_LIMIT_DEFAULT: str = "100/minute"
    MAX_REQUEST_BODY_BYTES: PositiveInt = 11 * 1024 * 1024

    # Postgres: either one DATABASE_URL (Neon, as copied from its dashboard) or the POSTGRES_*
    # parts (docker compose). DATABASE_URL wins when both are set.
    DATABASE_URL: SecretStr | None = None
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5433
    POSTGRES_USER: str = "waypoint"
    POSTGRES_PASSWORD: SecretStr = SecretStr("waypoint")
    POSTGRES_DB: str = "waypoint"
    # Every table lives in schema wp; the database's default search_path is set to "wp, public"
    # by db/waypoint_schema.sql, so queries can use plain table names.

    @property
    def SQLALCHEMY_URL(self) -> URL:
        if self.DATABASE_URL is not None:
            url = make_url(self.DATABASE_URL.get_secret_value()).set(drivername="postgresql+asyncpg")
            # asyncpg does not understand libpq options; SSL is passed in DB_CONNECT_ARGS instead.
            query = {k: v for k, v in url.query.items() if k not in ("sslmode", "channel_binding")}
            return url.set(query=query)
        return URL.create(
            "postgresql+asyncpg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD.get_secret_value(),
            host=self.POSTGRES_HOST,
            port=self.POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )

    @property
    def DB_CONNECT_ARGS(self) -> dict:
        args: dict = {}
        if self.DATABASE_URL is not None:
            url = make_url(self.DATABASE_URL.get_secret_value())
            if url.query.get("sslmode", "require") != "disable":
                args["ssl"] = "require"
            if "-pooler" in (url.host or ""):
                # Neon's pooled endpoint is PgBouncer in transaction mode: no cached prepared statements.
                args["statement_cache_size"] = 0
                args["prepared_statement_name_func"] = lambda: f"__asyncpg_{uuid4()}__"
        return args

    # Clerk
    CLERK_JWKS_URL: str = ""  # e.g. https://<your-domain>.clerk.accounts.dev/.well-known/jwks.json
    CLERK_ISSUER: str = ""
    CLERK_AUDIENCE: str | None = None  # read by app/auth/auth.py; None = do not check "aud"
    # Used once per new sign-in to read the user's email and link them to their wp.app_user row.
    CLERK_SECRET_KEY: SecretStr = SecretStr("")
    # Development only: accept "X-Dev-User: <email>" instead of a Clerk token (tests, curl).
    AUTH_DEV_BYPASS: bool = False
    CLERK_AUTHORIZED_PARTIES: list[str] = []  # from Clerk Dashboard > API Keys > your key > Authorized Parties
    CLERK_WEBHOOK_SECRET: SecretStr = SecretStr("")  # from Clerk Dashboard > Webhooks > your endpoint > Signing Secret

    @model_validator(mode="after")
    def _validate_security(self) -> Self:
        if self.ENVIRONMENT == "production":
            if self.DEBUG:
                raise ValueError("DEBUG must be False in production")
            if not self.CLERK_AUTHORIZED_PARTIES:
                raise ValueError("CLERK_AUTHORIZED_PARTIES must be set in production")
            if not self.CORS_ORIGINS or "*" in self.CORS_ORIGINS:
                raise ValueError("CORS_ORIGINS must be explicit in production")
            if not self.ALLOWED_HOSTS or "*" in self.ALLOWED_HOSTS:
                raise ValueError("ALLOWED_HOSTS must be explicit in production")
            if self.AUTH_DEV_BYPASS:
                raise ValueError("AUTH_DEV_BYPASS must be off in production")
        return self



@lru_cache
def get_settings() -> Settings:
    return Settings()
