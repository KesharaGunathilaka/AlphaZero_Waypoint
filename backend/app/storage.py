"""Where photo and signature bytes live, behind one interface.

* "db": table wp.attachment_blob. Self-contained, so `docker compose up` needs no cloud account.
* "s3": an S3-compatible bucket (Neon object storage in production), path-style addressing.

Screens show an image through a short-lived link from `view_url()`: a presigned bucket URL, or a
signed link to this API for the "db" backend (an <img> tag cannot send the sign-in token).
"""

import asyncio
import hashlib
import hmac
import secrets
import time
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

settings = get_settings()
LINK_SECONDS = 3600
_SIGNING_KEY = settings.URL_SIGNING_SECRET.get_secret_value().encode() or secrets.token_bytes(32)


@lru_cache
def _s3():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.AWS_ENDPOINT_URL_S3 or None,
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY.get_secret_value() or None,
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )


async def put(db: AsyncSession, key: str, data: bytes, content_type: str) -> None:
    if settings.STORAGE_BACKEND == "s3":
        await asyncio.to_thread(
            _s3().put_object, Bucket=settings.S3_BUCKET, Key=key, Body=data, ContentType=content_type
        )
    else:
        await db.execute(
            text("INSERT INTO attachment_blob(storage_key, data) VALUES (:k, :b) ON CONFLICT DO NOTHING"),
            {"k": key, "b": data},
        )


async def get(db: AsyncSession, key: str) -> bytes | None:
    """Bytes of a stored object ("db" backend; the "s3" backend serves through presigned links)."""
    row = (await db.execute(text("SELECT data FROM attachment_blob WHERE storage_key = :k"), {"k": key})).first()
    return bytes(row[0]) if row else None


def _signature(attachment_id: str, expires: int) -> str:
    return hmac.new(_SIGNING_KEY, f"{attachment_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def link_is_valid(attachment_id: str, expires: int, signature: str) -> bool:
    return expires >= time.time() and hmac.compare_digest(_signature(attachment_id, expires), signature)


async def view_url(attachment_id: str, key: str) -> str:
    if settings.STORAGE_BACKEND == "s3":
        return await asyncio.to_thread(
            _s3().generate_presigned_url,
            "get_object",
            Params={"Bucket": settings.S3_BUCKET, "Key": key},
            ExpiresIn=LINK_SECONDS,
        )
    expires = int(time.time()) + LINK_SECONDS
    return (f"{settings.PUBLIC_API_URL.rstrip('/')}{settings.API_V1_PREFIX}/attachments/{attachment_id}/raw"
            f"?expires={expires}&signature={_signature(attachment_id, expires)}")
