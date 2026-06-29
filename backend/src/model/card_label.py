#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.model.base import Base


class CardLabel(Base):
    """Junction table attaching board-level labels to individual cards."""

    __tablename__ = "card_labels"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
    )

    label_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("labels.id", ondelete="CASCADE"),
        primary_key=True,
    )

    def __repr__(self) -> str:
        return f"<CardLabel card_id={self.card_id} label_id={self.label_id}>"
