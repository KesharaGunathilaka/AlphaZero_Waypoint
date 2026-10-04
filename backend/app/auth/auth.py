"""Clerk sign-in (the deployed app): verify the Clerk session token the web app sends."""
from functools import lru_cache

import httpx
import jwt
from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import get_settings

settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)


@lru_cache
def _jwks_client() -> PyJWKClient:
    if not settings.CLERK_JWKS_URL:
        raise RuntimeError("CLERK_JWKS_URL is not configured")
    return PyJWKClient(settings.CLERK_JWKS_URL)


async def get_current_token_payload(credentials: HTTPAuthorizationCredentials | None) -> dict:
    """Verifies the Clerk-issued JWT (RS256, keys from CLERK_JWKS_URL) and returns its claims."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    token = credentials.credentials
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.CLERK_ISSUER or None,
            audience=settings.CLERK_AUDIENCE,
            options={"verify_aud": settings.CLERK_AUDIENCE is not None},
        )
    except (jwt.PyJWTError, httpx.HTTPError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc
