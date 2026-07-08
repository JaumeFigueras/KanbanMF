#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKeyConstraint, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.board_notification_settings import BoardNotificationSettings


class BoardNotificationOffset(Base):
    """One configured trigger day for a user's due-date notifications on a board.

    offset_days is signed relative to a card's due_at: negative days before,
    zero on the due day itself, positive days after. A user can configure any
    number of these per board (e.g. -3, -1, 0, 1) to model "3 days before, 1
    day before, on the day, and 1 day after" — independently of what any
    other user with access to the same board has configured.
    """

    __tablename__ = "board_notification_offsets"

    __table_args__ = (
        ForeignKeyConstraint(
            ["board_id", "user_id"],
            ["board_notification_settings.board_id", "board_notification_settings.user_id"],
            ondelete="CASCADE",
        ),
    )

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
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
        return f"<BoardNotificationOffset board_id={self.board_id} user_id={self.user_id} offset_days={self.offset_days}>"
