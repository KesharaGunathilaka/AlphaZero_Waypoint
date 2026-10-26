import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from app.api.v1.router import router
from app.config import Settings, get_settings
from app.db.session import AsyncSessionLocal, begin_transaction, connected_role, db_is_healthy, engine
from app.security.body_size_limit import BodySizeLimitMiddleware
from app.security.rate_limit import limiter
from app.security.security_headers import SecurityHeadersMiddleware


async def close_due_runs() -> int:
    """Close order intake for every run whose cutoff has passed and open its plan (as the system admin
    account). What the dispatcher's "Close orders now" button does, on the clock."""
    async with AsyncSessionLocal() as db:
        admin = await db.scalar(text("SELECT user_id FROM wp.app_user WHERE role = 'admin' AND active ORDER BY user_id LIMIT 1"))
        if admin is None:
            return 0
        await begin_transaction(db, admin)
        due = (await db.execute(text("SELECT run_id FROM wp.run WHERE state = 'open' AND cutoff_at <= now() ORDER BY cutoff_at"))).scalars().all()
        for run_id in due:
            await db.execute(text("SELECT wp.close_run(:r)"), {"r": run_id})
            await db.execute(text("SELECT wp.create_plan(:r, :u)"), {"r": run_id, "u": admin})
        await db.commit()
        return len(due)


async def cutoff_loop(every: int) -> None:
    log = logging.getLogger("app.cutoff")
    while True:
        try:
            closed = await close_due_runs()
            if closed:
                log.info("Closed %s run(s) at the cutoff", closed)
        except Exception:  # keep the loop alive; the next tick tries again
            log.exception("Automatic cutoff failed")
        await asyncio.sleep(every)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    settings = get_settings()
    task = asyncio.create_task(cutoff_loop(settings.AUTO_CUTOFF_SECONDS)) if settings.AUTO_CUTOFF_SECONDS > 0 else None
    try:
        role = await connected_role()
        if role.get("superuser") or role.get("owner"):
            logging.getLogger(__name__).warning(
                "Connected to the database as %s, which bypasses row-level security and the append-only rules. "
                "Connect as the restricted role waypoint_api (db/load.sh --api-role).", role.get("role"))
    except Exception:  # the database may not be up yet; /health reports that
        logging.getLogger(__name__).exception("Could not check the database role")
    yield
    if task is not None:
        task.cancel()
    await engine.dispose()

def _security_headers(settings: Settings) -> dict[str, str]:
    headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        # Orders, deliveries, names and tokens: never kept by a browser or proxy cache. (Responses that set
        # their own Cache-Control, like the short-lived image links, keep theirs.)
        "Cache-Control": "no-store",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    }
    if settings.ENVIRONMENT == "production":
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    return headers


def create_app() -> FastAPI:
    settings = get_settings()
    is_production = settings.ENVIRONMENT == "production"

    logging.basicConfig(
        level=settings.LOG_LEVEL,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app = FastAPI(
        title=settings.APP_NAME,
        debug=settings.DEBUG,
        lifespan=lifespan,
        docs_url=None if is_production else "/docs",
        redoc_url=None if is_production else "/redoc",
        openapi_url=None if is_production else "/openapi.json",
    )

    # Last added = outermost. Request flow:
    # TrustedHost -> SecurityHeaders -> CORS -> SlowAPI -> routes
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(
        BodySizeLimitMiddleware, max_body_size=settings.MAX_REQUEST_BODY_BYTES
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=False,  # Bearer tokens only; no cookies
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware, headers=_security_headers(settings))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)

    app.include_router(router, prefix=settings.API_V1_PREFIX)

    @app.get("/health", tags=["health"])
    @limiter.exempt
    async def health(response: Response) -> dict[str, str]:
        if not await db_is_healthy():
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "unavailable"}
        return {"status": "ok"}

    return app


app = create_app()
