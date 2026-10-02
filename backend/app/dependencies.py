from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.auth import get_current_user_id, require_org_admin
from app.db.session import get_db
from app.modules.user.models import User

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUserId = Annotated[str, Depends(get_current_user_id)]
AdminUser = Annotated[dict, Depends(require_org_admin)]


async def get_current_db_user(user_id: CurrentUserId, db: DbSession) -> User:
    """Resolves the Clerk `sub` claim to the internal User row (matched on clerk_id)."""
    result = await db.execute(select(User).where(User.clerk_id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


CurrentDbUser = Annotated[User, Depends(get_current_db_user)]
