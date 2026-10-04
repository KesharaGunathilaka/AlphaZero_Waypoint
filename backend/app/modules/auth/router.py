"""Local sign-in endpoints (AUTH_MODE=local only; 404 otherwise). See app/auth/local.py."""

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.local import issue_token
from app.config import get_settings
from app.dependencies import DbSession
from app.security.rate_limit import limiter

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["Local sign-in"])


def _local_only() -> None:
    if settings.AUTH_MODE != "local":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginIn, db: DbSession):  # noqa: ARG001  (request: rate limiter)
    _local_only()
    row = (await db.execute(text("""
        SELECT user_id, role::text AS role, name, email FROM wp.app_user
        WHERE active AND lower(email) = lower(:e) AND password_hash IS NOT NULL
          AND password_hash = public.crypt(:p, password_hash)"""), {"e": body.email.strip(), "p": body.password})
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is wrong")
    token, expires = issue_token(row["user_id"], row["role"], row["name"])
    return {"token": token, "expires_at": expires, "user": dict(row)}


@router.get("/accounts")
async def demo_accounts(db: DbSession):
    """The accounts that can sign in locally, for the sign-in page's "demo accounts" list."""
    _local_only()
    result = await db.execute(text("""
        SELECT u.email, u.name, u.role::text AS role, ou.code AS outlet, v.source_id AS vehicle,
               CASE WHEN u.all_depots THEN 'Kandy and Peliyagoda' ELSE d.name END AS depot
        FROM wp.app_user u LEFT JOIN wp.outlet ou ON ou.outlet_id = u.outlet_id
        LEFT JOIN wp.vehicle v ON v.vehicle_id = u.vehicle_id LEFT JOIN wp.depot d ON d.depot_id = u.depot_id
        WHERE u.active AND u.password_hash IS NOT NULL
        ORDER BY array_position(ARRAY['dispatcher','loader','driver','store_manager','admin'], u.role::text), u.email"""))
    return [dict(r) for r in result.mappings()]
