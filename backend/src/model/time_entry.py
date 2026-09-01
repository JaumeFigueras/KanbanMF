#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, List, Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.user import User


class TimeEntry(Base):
    """A stretch of time a user spent working on a card.

    The board name, card name and labels are **copies** taken when the entry
    is created, not references: a card can afterwards be renamed, relabelled,
    archived or deleted, and the record of the time already spent on it must
    not change with it. Nothing here points at a board or a card.

    An entry with no ``ended_at`` is the one currently running. A partial
    unique index allows only one of those per user, so "already tracking"
    is enforced by the database rather than only by the API.

    The entry belongs to exactly one user and is never shared, unlike the
    boards the work happened on.
    """

    __tablename__ = "time_entries"

    __table_args__ = (
        CheckConstraint(
            "ended_at IS NULL OR ended_at > started_at",
            name="ck_time_entries_end_after_start",
        ),
        Index(
            "ux_time_entries_one_running_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Owner of the entry. Time tracking is private: entries are never shared.",
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="NULL while the entry is still running.",
    )

    board_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Copy of the board's name when the entry was created.",
    )

    card_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Copy of the card's name when the entry was created.",
    )

    labels: Mapped[List[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default="[]",
        comment="Copy of the card's labels when the entry was created: [{name, color}, ...].",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="time_entries",
    )

    def __repr__(self) -> str:
        return (
            f"<TimeEntry id={self.id} card_name={self.card_name!r} "
            f"started_at={self.started_at} ended_at={self.ended_at}>"
        )
