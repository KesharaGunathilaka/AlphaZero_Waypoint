from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.auth import bearer_scheme, get_current_token_payload
from app.auth.local import read_token
from app.config import get_settings
from app.db.session import begin_transaction, get_db

settings = get_settings()

DbSession = Annotated[AsyncSession, Depends(get_db)]


@dataclass(frozen=True)
class CurrentUser:
    """The signed-in person, as a row of wp.app_user (the database decides role and scope)."""

    user_id: int
    role: str
    name: str
    email: str | None
    depot_id: int | None
    outlet_id: int | None
    vehicle_id: int | None


_USER_SQL = """
SELECT user_id, role::text AS role, name, email, depot_id, outlet_id, vehicle_id
FROM wp.app_user WHERE active AND {where}
"""


async def _clerk_email(clerk_user_id: str) -> str | None:
    """Primary email of a Clerk user, read once to link a new sign-in to its wp.app_user row."""
    secret = settings.CLERK_SECRET_KEY.get_secret_value()
    if not secret:
        return None
    async with httpx.AsyncClient(timeout=5) as client:
        res = await client.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {secret}"},
        )
    if res.status_code != 200:
        return None
    data = res.json()
    for entry in data.get("email_addresses") or []:
        if entry.get("id") == data.get("primary_email_address_id"):
            return entry.get("email_address")
    return None


async def get_current_user(
    request: Request,
    db: DbSession,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    dev_email = request.headers.get("X-Dev-User")
    if settings.AUTH_DEV_BYPASS and settings.ENVIRONMENT == "development" and dev_email:
        row = (await db.execute(text(_USER_SQL.format(where="lower(email) = lower(:e)")), {"e": dev_email})).mappings().first()
    elif settings.AUTH_MODE == "local":
        if credentials is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
        sub = read_token(credentials.credentials)["sub"]
        row = (await db.execute(text(_USER_SQL.format(where="user_id = :u")), {"u": int(sub)})).mappings().first()
    else:
        payload = await get_current_token_payload(credentials)
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing 'sub' claim")
        row = (await db.execute(text(_USER_SQL.format(where="clerk_user_id = :s")), {"s": sub})).mappings().first()
        if row is None:
            email = await _clerk_email(sub)
            if email:
                await db.execute(
                    text("UPDATE wp.app_user SET clerk_user_id = :s WHERE lower(email) = lower(:e) AND clerk_user_id IS NULL"),
                    {"s": sub, "e": email},
                )
                await db.commit()
                await begin_transaction(db)
                row = (await db.execute(text(_USER_SQL.format(where="clerk_user_id = :s")), {"s": sub})).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This sign-in has no Waypoint account")
    user = CurrentUser(**row)
    await begin_transaction(db, user.user_id)
    return user


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(*roles: str):
    """Dependency factory: the signed-in user must hold one of `roles` (admin always passes)."""

    async def checker(user: CurrentUserDep) -> CurrentUser:
        if user.role != "admin" and user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot use this endpoint")
        return user

    return checker
