#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base


class UserBoardStar(Base):
    """Records that a specific user has starred a specific board.

    The star is a personal preference scoped to (user, board) — it is
    independent of ownership or share status, so both owners and shared
    users can star or un-star a board without affecting anyone else.
    """

    __tablename__ = "user_board_stars"

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

    starred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="When the user starred this board.",
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="board_stars",
    )

    board: Mapped["Board"] = relationship(
        "Board",
        back_populates="stars",
    )

    def __repr__(self) -> str:
        return f"<UserBoardStar user_id={self.user_id} board_id={self.board_id}>"
