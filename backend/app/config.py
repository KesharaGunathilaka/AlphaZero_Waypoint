from functools import lru_cache
from typing import Literal, Self

from pydantic import PositiveInt, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


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

    # Postgres
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: SecretStr
    POSTGRES_DB: str

    @property
    def DATABASE_URL(self) -> URL:
        return URL.create(
            "postgresql+asyncpg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD.get_secret_value(),
            host=self.POSTGRES_HOST,
            port=self.POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )

    # Clerk
    CLERK_JWKS_URL: str = ""  # e.g. https://<your-domain>.clerk.accounts.dev/.well-known/jwks.json
    CLERK_ISSUER: str = ""
    CLERK_AUTHORIZED_PARTIES: list[str] = []  # from Clerk Dashboard > API Keys > your key > Authorized Parties
    CLERK_WEBHOOK_SECRET: SecretStr = SecretStr("")  # from Clerk Dashboard > Webhooks > your endpoint > Signing Secret

    # LLM provider credentials
    OPENAI_API_KEY: SecretStr | None = None
    GOOGLE_API_KEY: SecretStr | None = None
    ANTHROPIC_API_KEY: SecretStr | None = None

    # Local HuggingFace models
    HF_MODELS_DIR: str = "./hf_models"
    HF_DEVICE: Literal["cuda", "cpu", "mps"] = "cpu"

    DEFAULT_LLM_PROVIDER: str = "openai"
    DEFAULT_LLM_MODEL: str = "gpt-4o"

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
        return self



@lru_cache
def get_settings() -> Settings:
    return Settings()
