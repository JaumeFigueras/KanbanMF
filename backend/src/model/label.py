#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base
from src.model.card_label import CardLabel

if TYPE_CHECKING:
    from src.model.board import Board
    from src.model.card import Card


class Label(Base):
    """A coloured label defined at board level and attachable to any card in that board."""

    __tablename__ = "labels"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("boards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    color: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Hex colour code (e.g. #FF5733) or any CSS colour string.",
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
        back_populates="labels",
    )

    cards: Mapped[List["Card"]] = relationship(
        "Card",
        secondary=CardLabel.__table__,
        back_populates="labels",
    )

    def __repr__(self) -> str:
        return f"<Label id={self.id} name={self.name!r} board_id={self.board_id}>"
