"""Small helpers shared by the routers: run SQL against schema wp, map rule errors to HTTP."""

import json
import logging
import re
from contextlib import asynccontextmanager
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Workflow functions raise "WPnnn: message"; WP0xx are permission errors, everything else a rule.
_WP_ERROR = re.compile(r"(WP\d{3}): ([^\n]*)")


def _http_error(exc: DBAPIError) -> HTTPException:
    message = str(exc.orig) if exc.orig is not None else str(exc)
    match = _WP_ERROR.search(message)
    if match is None:
        logger.error("Database error: %s", message)
        return HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Database error")
    code, text_ = match.groups()
    http = status.HTTP_403_FORBIDDEN if code.startswith("WP0") else status.HTTP_409_CONFLICT
    return HTTPException(http, {"code": code, "message": text_.strip()})


@asynccontextmanager
async def rule_errors():
    """Turn a workflow function's WPnnn exception into a 403/409 with its message."""
    try:
        yield
    except DBAPIError as exc:
        raise _http_error(exc) from exc


def _params(params: dict[str, Any] | None) -> dict[str, Any]:
    # jsonb parameters are sent as JSON text and cast in SQL with ::jsonb
    return {k: json.dumps(v) if isinstance(v, (dict, list)) else v for k, v in (params or {}).items()}


async def rows(db: AsyncSession, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    async with rule_errors():
        result = await db.execute(text(sql), _params(params))
    return [dict(r) for r in result.mappings().all()]


async def one(db: AsyncSession, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    found = await rows(db, sql, params)
    return found[0] if found else None


async def scalar(db: AsyncSession, sql: str, params: dict[str, Any] | None = None) -> Any:
    async with rule_errors():
        result = await db.execute(text(sql), _params(params))
    return result.scalar()


def not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
