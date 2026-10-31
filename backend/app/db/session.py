import asyncio
import logging
from collections.abc import AsyncGenerator

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

engine = create_async_engine(
    settings.SQLALCHEMY_URL,
    connect_args=settings.DB_CONNECT_ARGS,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    pool_recycle=1800,
)

class WaypointSession(Session):
    """The sync session under each AsyncSession; carries the transaction-context hook below."""


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    sync_session_class=WaypointSession,
    expire_on_commit=False,
    autoflush=False,
)


_CONTEXT_SQL = text("SELECT set_config('search_path', 'wp, public', true), set_config('wp.user_id', :uid, true)")


@event.listens_for(WaypointSession, "after_begin")
def _set_transaction_context(session, _transaction, connection) -> None:
    """First statement of EVERY transaction of a session, including the ones after a commit: schema wp first
    in the search path, and the acting user that wp.me() and the row-level policies read. Both are
    transaction-local (correct behind Neon's PgBouncer pooler), so they must be set again each time;
    otherwise a read after a commit would run as nobody and row-level security would hide its rows."""
    user_id = session.info.get("wp_user_id")
    connection.execute(_CONTEXT_SQL, {"uid": "" if user_id is None else str(user_id)})


async def begin_transaction(session: AsyncSession, user_id: int | None = None) -> None:
    """Make `user_id` the acting user of this session: for the transaction in progress now, and (through
    the after_begin hook above) for every later one."""
    session.info["wp_user_id"] = user_id
    await session.execute(_CONTEXT_SQL, {"uid": "" if user_id is None else str(user_id)})


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a scoped async DB session."""
    async with AsyncSessionLocal() as session:
        try:
            await begin_transaction(session)
            yield session
        except Exception:
            await session.rollback()
            raise

async def connected_role() -> dict:
    """Who the API is connected as: a superuser or the owner of schema wp bypasses row-level security."""
    async with engine.connect() as conn:
        row = (await conn.execute(text("""
            SELECT current_user AS role, r.rolsuper AS superuser,
                   pg_has_role(current_user, (SELECT nspowner FROM pg_namespace WHERE nspname = 'wp'), 'USAGE') AS owner
            FROM pg_roles r WHERE r.rolname = current_user"""))).mappings().first()
    return dict(row) if row else {}


async def db_is_healthy(timeout: float = 2.0) -> bool:
    """Return True if the database answers a trivial query within `timeout` seconds."""
    try:
        async with asyncio.timeout(timeout):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Database health check failed")
        return False
    return True