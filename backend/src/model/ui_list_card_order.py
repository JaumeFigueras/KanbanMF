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
    from src.model.board_list import BoardList


class UIListCardOrder(Base):
    """Stores the UI-driven custom card order for a board list.

    One row per list; card_ids is an ordered array of Card UUIDs.
    Write access is restricted to the board owner. Shared users read only.
    """

    __tablename__ = "ui_list_card_orders"

    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("board_lists.id", ondelete="CASCADE"),
        primary_key=True,
    )

    card_ids: Mapped[list[uuid.UUID]] = mapped_column(
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

    board_list: Mapped["BoardList"] = relationship("BoardList", back_populates="ui_card_order")

    def __repr__(self) -> str:
        return f"<UIListCardOrder list_id={self.list_id} len={len(self.card_ids)}>"
