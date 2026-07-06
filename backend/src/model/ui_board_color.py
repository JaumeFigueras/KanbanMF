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
    from src.model.board import Board
    from src.model.user import User


class UIBoardColor(Base):
    """A user's personal color choice for a board.

    Purely a per-user display preference: the owner and every shared user
    can each pick their own color for the same board without affecting what
    anyone else sees. No row means the board renders with its default color.
    """

    __tablename__ = "ui_board_colors"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("boards.id", ondelete="CASCADE"),
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

    user: Mapped["User"] = relationship("User", back_populates="board_colors")
    board: Mapped["Board"] = relationship("Board", back_populates="user_colors")

    def __repr__(self) -> str:
        return f"<UIBoardColor user_id={self.user_id} board_id={self.board_id} color={self.color!r}>"
