import logging
from typing import Annotated, Any

from app.config import get_settings
from app.db.session import get_db
from app.modules.user.models import User
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook, WebhookVerificationError

settings = get_settings()
logger = logging.getLogger(__name__)
DbSession = Annotated[AsyncSession, Depends(get_db)]

# NOTE: mount this router WITHOUT the Clerk bearer-auth dependency — it's
# authenticated via the Svix signature instead, not a user JWT.
router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


def _primary_email(data: dict[str, Any]) -> str | None:
    emails = data.get("email_addresses") or []
    primary_id = data.get("primary_email_address_id")
    for entry in emails:
        if entry.get("id") == primary_id:
            return entry.get("email_address")
    return emails[0].get("email_address") if emails else None


@router.post("/clerk", status_code=status.HTTP_204_NO_CONTENT)
async def clerk_webhook(request: Request, db: AsyncSession = DbSession) -> None:
    if not settings.CLERK_WEBHOOK_SECRET:
        raise RuntimeError("CLERK_WEBHOOK_SECRET is not configured")

    body = await request.body()
    headers = {
        "svix-id": request.headers.get("svix-id", ""),
        "svix-timestamp": request.headers.get("svix-timestamp", ""),
        "svix-signature": request.headers.get("svix-signature", ""),
    }

    try:
        event = Webhook(settings.CLERK_WEBHOOK_SECRET).verify(body, headers)
    except WebhookVerificationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook signature") from exc

    event_type = event.get("type")
    data = event.get("data", {})
    clerk_id = data.get("id")
    if not clerk_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Event missing user id")

    if event_type in ("user.created", "user.updated"):
        result = await db.execute(select(User).where(User.clerk_id == clerk_id))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(clerk_id=clerk_id)
            db.add(user)
        user.email = _primary_email(data)
        user.first_name = data.get("first_name")
        user.last_name = data.get("last_name")
        user.image_url = data.get("image_url")
        user.is_active = True
        await db.commit()

    elif event_type == "user.deleted":
        result = await db.execute(select(User).where(User.clerk_id == clerk_id))
        user = result.scalar_one_or_none()
        if user is not None:
            user.is_active = False
            await db.commit()

    else:
        logger.info("Unhandled Clerk webhook event type: %s", event_type)
