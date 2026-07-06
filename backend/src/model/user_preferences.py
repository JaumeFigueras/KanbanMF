#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import enum
import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base


class DateFormat(str, enum.Enum):
    NUMERIC = "numeric"
    TEXTUAL = "textual"


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

    initials: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
        comment="Up to 3 custom initials. NULL means use the computed default (first letter of each display_name word)."
    )

    date_format: Mapped[DateFormat] = mapped_column(
        SAEnum(DateFormat, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default=DateFormat.NUMERIC.value,
        comment="How dates are displayed on cards: 'numeric' (27/06/2026) or 'textual' (27 June 2026)."
    )

    timezone: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default="UTC",
        comment="IANA timezone name (e.g. 'Europe/Madrid'). Used to localize due-date notification hours for this user."
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
