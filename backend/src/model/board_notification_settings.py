#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.board import Board
    from src.model.board_notification_offset import BoardNotificationOffset
    from src.model.user import User


class BoardNotificationSettings(Base):
    """Per-user, per-board configuration for due-date email notifications.

    One row per (board, user): every person with access to a board — owner
    or shared member — controls their own due-date reminders independently.
    A user enabling notifications on a board only ever affects themselves;
    it can never cause another user (e.g. an assignee who hasn't opted in)
    to be emailed. notify_hour is interpreted in this user's own timezone
    (UserPreferences.timezone). Which days trigger a notification is stored
    separately in BoardNotificationOffset.
    """

    __tablename__ = "board_notification_settings"

    __table_args__ = (
        CheckConstraint("notify_hour >= 0 AND notify_hour <= 23", name="ck_board_notification_settings_notify_hour_range"),
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
