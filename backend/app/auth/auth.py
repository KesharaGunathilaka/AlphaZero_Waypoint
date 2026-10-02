from functools import lru_cache

import httpx
import jwt
from app.config import get_settings
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)
credentials = Depends(bearer_scheme)

ADMIN_ORG_ROLE = "org:admin"


@lru_cache
def _jwks_client() -> PyJWKClient:
    if not settings.CLERK_JWKS_URL:
        raise RuntimeError("CLERK_JWKS_URL is not configured")
    return PyJWKClient(settings.CLERK_JWKS_URL)


async def get_current_token_payload(
    credentials: HTTPAuthorizationCredentials | None = credentials,
) -> dict:
    """
    Verifies the Clerk-issued JWT sent by the frontend and returns its full claim set.
    """
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    token = credentials.credentials
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.CLERK_ISSUER or None,
            audience=settings.CLERK_AUDIENCE,
            options={"verify_aud": settings.CLERK_AUDIENCE is not None},
        )
    except (jwt.PyJWTError, httpx.HTTPError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc

    return payload


current_token_payload = Depends(get_current_token_payload)

async def get_current_user_id(
    payload: dict = current_token_payload,
) -> str:
    """Returns the Clerk user id (`sub`) from the verified token."""
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing 'sub' claim")
    return sub


async def require_org_admin(
    payload: dict = current_token_payload,
) -> dict:
    """Dependency that additionally requires the caller to hold the Clerk org:admin role.

    Use on content-management routes (long cases and their nested resources).
    """
    if payload.get("org_role") != ADMIN_ORG_ROLE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return payload
