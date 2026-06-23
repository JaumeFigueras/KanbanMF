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


class UserPreferences(Base):

    __tablename__ = "user_preferences"

    # Primary key (also FK — one-to-one with User)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="One-to-one with User. Deleting the user also deletes the avatar."
    )

    language_locale: Mapped[str] = mapped_column(
        String(10),
        nullable=False
    )

    number_locale: Mapped[str] = mapped_column(
        String(10),
        nullable=False
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
        back_populates="preferences"
    )

