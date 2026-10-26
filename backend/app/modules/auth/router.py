"""Local sign-in endpoints (AUTH_MODE=local only; 404 otherwise). See app/auth/local.py."""

import logging

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.auth.local import issue_token
from app.config import get_settings
from app.dependencies import DbSession
from app.security.login_throttle import login_throttle
from app.security.rate_limit import limiter

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Local sign-in"])


def _local_only() -> None:
    if settings.AUTH_MODE != "local":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


def _masked(email: str) -> str:
    """For the log: enough to spot an attack on one account, without writing the full address."""
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}"


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginIn, db: DbSession):  # noqa: ARG001  (request: rate limiter)
    _local_only()
    email = body.email.strip().lower()
    wait = login_throttle.wait_seconds(email)
    if wait:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"Too many wrong passwords for this account. Try again in {wait // 60 + 1} min.",
                            headers={"Retry-After": str(wait)})
    row = (await db.execute(text("""
        SELECT user_id, role::text AS role, name, email FROM wp.app_user
        WHERE active AND lower(email) = :e AND password_hash IS NOT NULL
          AND password_hash = public.crypt(:p, password_hash)"""), {"e": email, "p": body.password})
    ).mappings().first()
    if row is None:
        login_throttle.failed(email)
        logger.warning("Failed sign-in for %s", _masked(email))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is wrong")
    login_throttle.succeeded(email)
    token, expires = issue_token(row["user_id"], row["role"], row["name"])
    return {"token": token, "expires_at": expires, "user": dict(row)}


@router.get("/accounts")
async def demo_accounts(db: DbSession):
    """The accounts that can sign in locally, for the sign-in page's "demo accounts" list.

    The admin account is left out: it has no depot, vehicle or outlet, so each role's app would show
    errors or empty screens. It stays in the database (demo reset places the seed orders as admin).
    """
    _local_only()
    result = await db.execute(text("""
        SELECT u.email, u.name, u.role::text AS role, ou.code AS outlet, v.source_id AS vehicle,
               CASE WHEN u.all_depots THEN 'Kandy and Peliyagoda' ELSE d.name END AS depot
        FROM wp.app_user u LEFT JOIN wp.outlet ou ON ou.outlet_id = u.outlet_id
        LEFT JOIN wp.vehicle v ON v.vehicle_id = u.vehicle_id LEFT JOIN wp.depot d ON d.depot_id = u.depot_id
        WHERE u.active AND u.password_hash IS NOT NULL AND u.role <> 'admin'
        ORDER BY array_position(ARRAY['dispatcher','loader','driver','store_manager'], u.role::text), u.email"""))
    return [dict(r) for r in result.mappings()]
