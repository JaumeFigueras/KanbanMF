#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, LargeBinary, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

# Maximum avatar size: 100 KB
MAX_AVATAR_SIZE_BYTES = 100 * 1024


class UserAvatar(Base):
    """Binary avatar image for a user.

    Stored as a BYTEA blob in PostgreSQL for easy migration.
    Maximum size is 100 KB enforced at both the DB and application level.
    Supported MIME types: image/jpeg, image/png, image/webp, image/gif.
    """
    __tablename__ = "user_avatars"

    __table_args__ = (
        CheckConstraint(
            f"octet_length(data) <= {MAX_AVATAR_SIZE_BYTES}",
            name="ck_avatar_max_size"
        ),
    )

    # Primary key (also FK — one-to-one with User)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="One-to-one with User. Deleting the user also deletes the avatar."
    )

    # Binary image data
    data: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
        comment="Raw image bytes. Maximum 100 KB."
    )

    # MIME type needed to serve the image correctly via the API
    mime_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="e.g. image/jpeg, image/png, image/webp, image/gif"
    )

    # Timestamp
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )

    # Relationship
    user: Mapped["User"] = relationship(
        "User",
        back_populates="avatar"
    )

    def __repr__(self) -> str:
        return f"<UserAvatar user_id={self.user_id} mime_type={self.mime_type} size={len(self.data)}B>"
