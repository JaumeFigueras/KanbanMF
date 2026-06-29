#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.model.base import Base


class CardAssignee(Base):
    """Junction table recording which users are assigned to a card.

    Assignment implies responsibility for completing the card's task,
    distinct from mere membership (CardMember).
    """

    __tablename__ = "card_assignees"

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

    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="When the user was assigned to this card.",
    )

    def __repr__(self) -> str:
        return f"<CardAssignee card_id={self.card_id} user_id={self.user_id}>"
