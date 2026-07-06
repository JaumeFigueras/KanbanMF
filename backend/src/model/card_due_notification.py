#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.card import Card
    from src.model.user import User


class CardDueNotification(Base):
    """Send-log for a card's due-date email notifications.

    Recorded once per (card, recipient, calendar day) so the notification
    job can tell it already sent today's notification and skip re-sending
    if it reruns, including on days when the overdue daily-repeat is active.
    """

    __tablename__ = "card_due_notifications"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    notification_date: Mapped[date] = mapped_column(
        Date,
        primary_key=True,
        comment="Calendar day (in the recipient's timezone) this notification was sent for.",
    )

    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    card: Mapped["Card"] = relationship(
        "Card",
        back_populates="due_notifications",
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="due_notifications",
    )

    def __repr__(self) -> str:
        return (
            f"<CardDueNotification card_id={self.card_id} user_id={self.user_id} "
            f"notification_date={self.notification_date}>"
        )
