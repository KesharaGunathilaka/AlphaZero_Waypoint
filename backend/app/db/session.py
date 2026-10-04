import asyncio
import logging
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

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

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def begin_transaction(session: AsyncSession, user_id: int | None = None) -> None:
    """Run as the first statement of every transaction (get_db does it for you; call it again after
    a commit, or once you know the signed-in user). Sets schema wp first in the search path and the
    acting user that wp.me() and the row-level policies read. Both are transaction-local, which is
    what keeps them correct behind Neon's PgBouncer pooler."""
    await session.execute(
        text("SELECT set_config('search_path', 'wp, public', true), set_config('wp.user_id', :uid, true)"),
        {"uid": "" if user_id is None else str(user_id)},
    )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a scoped async DB session."""
    async with AsyncSessionLocal() as session:
        try:
            await begin_transaction(session)
            yield session
        except Exception:
            await session.rollback()
            raise

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