from app.db.base import Base
from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column


class User(Base):
    """Local shadow of a Clerk user. Populated/kept in sync by the Clerk webhook.
    Never written to directly from application routes."""

    __tablename__ = "users"

    clerk_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    first_name: Mapped[str | None] = mapped_column(String(150))
    last_name: Mapped[str | None] = mapped_column(String(150))
    image_url: Mapped[str | None] = mapped_column(String(1024))
    # Soft-delete flag: set False on a `user.deleted` webhook event instead of
    # hard-deleting, so existing attempts/FKs referencing this user survive.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
