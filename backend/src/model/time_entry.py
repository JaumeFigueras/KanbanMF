#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`TimeEntry` model: a private record of time spent on a card."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, List, Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
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
    not change with it. Nothing here points at a board or a card: the
    board_id, list_id and card_id columns record where the work happened,
    but as plain values with no foreign key, so deleting the board, list or
    card never touches the entry. They exist for statistics only — the
    nightly usage ranking the time tracker orders its board and list
    choices by (see src.core.time_tracker_ranking) — and may be NULL on
    entries recorded before they were added.

    An entry with no ``ended_at`` is the one currently running. A partial
    unique index allows only one of those per user, so "already tracking"
    is enforced by the database rather than only by the API.

    ``comment`` is the one field that isn't copied from anywhere: it's the
    user's own note on what this stretch of work actually was, written when
    the entry is created or added later from the edit dialog.

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
        # The nightly usage ranking counts each user's recent entries.
        Index("ix_time_entries_user_id_started_at", "user_id", "started_at"),
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

    board_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        comment="Board the work was on, for usage statistics. Deliberately not a foreign key.",
    )

    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        comment="List the card was in, for usage statistics. Deliberately not a foreign key.",
    )

    card_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        comment="Card the work was on, for usage statistics. Deliberately not a foreign key.",
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

    comment: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Free note the user wrote about this stretch of work. Not copied from the card.",
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
