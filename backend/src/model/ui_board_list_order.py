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
    from src.model.board import Board


class UIBoardListOrder(Base):
    """Stores the UI-driven column order for a board's lists.

    One row per board; list_ids is an ordered array of BoardList UUIDs.
    Write access is restricted to the board owner. Shared users read only.
    """

    __tablename__ = "ui_board_list_orders"

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("boards.id", ondelete="CASCADE"),
        primary_key=True,
    )

    list_ids: Mapped[list[uuid.UUID]] = mapped_column(
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

    board: Mapped["Board"] = relationship("Board", back_populates="ui_list_order")

    def __repr__(self) -> str:
        return f"<UIBoardListOrder board_id={self.board_id} len={len(self.list_ids)}>"
