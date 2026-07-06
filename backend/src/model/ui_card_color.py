#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.card import Card
    from src.model.user import User


class UICardColor(Base):
    """A user's personal color choice for a card.

    Purely a per-user display preference, same as UIBoardColor/UIListColor:
    the owner and every shared user can each pick their own color for the
    same card. No row means the card renders with its default color.
    """

    __tablename__ = "ui_card_colors"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
    )

    color: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Hex colour code (e.g. #FF5733) or any CSS colour string.",
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="card_colors")
    card: Mapped["Card"] = relationship("Card", back_populates="user_colors")

    def __repr__(self) -> str:
        return f"<UICardColor user_id={self.user_id} card_id={self.card_id} color={self.color!r}>"
