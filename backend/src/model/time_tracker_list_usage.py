#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.model.base import Base


class TimeTrackerListUsage(Base):
    """How often a user tracked time on a list recently: one row of the
    ranking the time tracker orders its list choices by.

    Derived data, rebuilt from scratch every night by
    src.core.time_tracker_ranking from the user's time entries of the last
    90 days (TimeEntry.list_id). It holds the count rather than a position, so the
    alphabetical tie-break between equally used lists always uses the
    current name. A list with no row has not been used in that window and
    counts as zero.
    """

    __tablename__ = "time_tracker_list_usage"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("board_lists.id", ondelete="CASCADE"),
        primary_key=True,
    )

    usage_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Number of this user's time entries on this list in the ranking window.",
    )

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="When the nightly job built this row.",
    )

    def __repr__(self) -> str:
        return f"<TimeTrackerListUsage user_id={self.user_id} list_id={self.list_id} usage_count={self.usage_count}>"
