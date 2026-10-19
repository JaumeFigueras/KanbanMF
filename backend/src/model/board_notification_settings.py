#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Iterable, List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.board import Board
    from src.model.board_notification_offset import BoardNotificationOffset
    from src.model.user import User

# notify_weekdays bitmasks: bit (isoweekday - 1) set means that day is allowed.
WORKDAYS_MASK = 0b0011111  # Monday-Friday
ALL_WEEKDAYS_MASK = 0b1111111  # Monday-Sunday


def weekdays_to_mask(weekdays: Iterable[int]) -> int:
    """Pack ISO weekday numbers (1 = Monday ... 7 = Sunday) into a notify_weekdays bitmask."""
    mask = 0
    for day in weekdays:
        mask |= 1 << (day - 1)
    return mask


def mask_to_weekdays(mask: int) -> list[int]:
    """Unpack a notify_weekdays bitmask into sorted ISO weekday numbers (1 = Monday ... 7 = Sunday)."""
    return [day for day in range(1, 8) if mask & (1 << (day - 1))]


class BoardNotificationSettings(Base):
    """Per-user, per-board configuration for due-date email notifications.

    One row per (board, user): every person with access to a board — owner
    or shared member — controls their own due-date reminders independently.
    A user enabling notifications on a board only ever affects themselves;
    it can never cause another user (e.g. an assignee who hasn't opted in)
    to be emailed. notify_hour is interpreted in this user's own timezone
    (UserPreferences.timezone). Which days relative to a card's due date
    trigger a notification is stored separately in BoardNotificationOffset;
    notify_weekdays then restricts which days of the week anything is sent at
    all — a reminder falling on an unselected weekday is skipped, not
    postponed.
    """

    __tablename__ = "board_notification_settings"

    __table_args__ = (
        CheckConstraint("notify_hour >= 0 AND notify_hour <= 23", name="ck_board_notification_settings_notify_hour_range"),
        CheckConstraint(
            "notify_weekdays >= 1 AND notify_weekdays <= 127",
            name="ck_board_notification_settings_notify_weekdays_range",
        ),
    )

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("boards.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Deleting the board also deletes every user's notification settings for it.",
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Deleting the user also deletes their notification settings.",
    )

    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    notify_hour: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=9,
        server_default="9",
        comment="Hour of day (0-23) at which notifications are sent, in this user's own timezone.",
    )

    notify_weekdays: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=WORKDAYS_MASK,
        server_default=str(WORKDAYS_MASK),
        comment="Bitmask of ISO weekdays on which notifications may be sent, in this user's own timezone: "
                "bit 0 = Monday ... bit 6 = Sunday. Defaults to Monday-Friday (31); 127 is every day.",
    )

    overdue_repeat_after_days: Mapped[Optional[int]] = mapped_column(
        SmallInteger,
        nullable=True,
        comment="Once a card is this many days past due, notify daily until resolved. NULL disables the repeat.",
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
    board: Mapped["Board"] = relationship(
        "Board",
        back_populates="notification_settings",
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="board_notification_settings",
    )

    offsets: Mapped[List["BoardNotificationOffset"]] = relationship(
        "BoardNotificationOffset",
        back_populates="settings",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<BoardNotificationSettings board_id={self.board_id} user_id={self.user_id} is_enabled={self.is_enabled}>"
