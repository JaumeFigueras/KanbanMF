#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.model.base import Base


class CardMember(Base):
    """Junction table recording which users are members of a card.

    Membership grants visibility and the right to comment, but does not
    imply responsibility — that is conveyed by CardAssignee.
    """

    __tablename__ = "card_members"

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

    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="When the user was added as a member of this card.",
    )

    def __repr__(self) -> str:
        return f"<CardMember card_id={self.card_id} user_id={self.user_id}>"
