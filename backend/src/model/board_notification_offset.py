#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.board_notification_settings import BoardNotificationSettings


class BoardNotificationOffset(Base):
    """One configured trigger day for a board's due-date notifications.

    offset_days is signed relative to a card's due_at: negative days before,
    zero on the due day itself, positive days after. A board can have any
    number of these (e.g. -3, -1, 0, 1) to model "3 days before, 1 day
    before, on the day, and 1 day after".
    """

    __tablename__ = "board_notification_offsets"

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("board_notification_settings.board_id", ondelete="CASCADE"),
        primary_key=True,
    )

    offset_days: Mapped[int] = mapped_column(
        SmallInteger,
        primary_key=True,
        comment="Days relative to due_at: negative=before, 0=on due day, positive=after.",
    )

    # Relationships
    settings: Mapped["BoardNotificationSettings"] = relationship(
        "BoardNotificationSettings",
        back_populates="offsets",
    )

    def __repr__(self) -> str:
        return f"<BoardNotificationOffset board_id={self.board_id} offset_days={self.offset_days}>"
