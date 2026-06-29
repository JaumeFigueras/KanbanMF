#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.user import User


class UIBoardOrder(Base):
    """Per-user UI ordering of boards across the three sections.

    One row per user; each array holds board UUIDs in display order.
    All three sections are stored together so a single row covers the
    full board list state for that user.
    """

    __tablename__ = "ui_board_orders"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    starred_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
        default=list,
        server_default="{}",
    )

    owned_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
        default=list,
        server_default="{}",
    )

    shared_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
        default=list,
        server_default="{}",
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="ui_board_order")

    def __repr__(self) -> str:
        return f"<UIBoardOrder user_id={self.user_id}>"
