"""Local sign-in for the Docker delivery (AUTH_MODE=local); the deployed app signs in with Clerk.

Passwords are bcrypt hashes in wp.app_user.password_hash, checked by Postgres (pgcrypto), so no
password ever leaves the database. A successful sign-in returns an HS256 token signed with
LOCAL_AUTH_SECRET; the web app keeps it in an httpOnly cookie and sends it as a Bearer token.
"""

from datetime import UTC, datetime, timedelta

import jwt
from fastapi import HTTPException, status

from app.config import get_settings

settings = get_settings()

ISSUER, AUDIENCE = "waypoint-local", "waypoint"


def issue_token(user_id: int, role: str, name: str) -> tuple[str, datetime]:
    expires = datetime.now(UTC) + timedelta(hours=settings.LOCAL_TOKEN_HOURS)
    claims = {"sub": str(user_id), "role": role, "name": name, "iss": ISSUER, "aud": AUDIENCE,
              "iat": datetime.now(UTC), "exp": expires}
    return jwt.encode(claims, settings.LOCAL_AUTH_SECRET.get_secret_value(), algorithm="HS256"), expires


def read_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.LOCAL_AUTH_SECRET.get_secret_value(), algorithms=["HS256"],
                          issuer=ISSUER, audience=AUDIENCE)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your sign-in has expired; sign in again") from exc
