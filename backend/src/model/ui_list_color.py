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
    from src.model.board_list import BoardList
    from src.model.user import User


class UIListColor(Base):
    """A user's personal color choice for a board list.

    Purely a per-user display preference, same as UIBoardColor: the owner
    and every shared user can each pick their own color for the same list.
    No row means the list renders with its default color.
    """

    __tablename__ = "ui_list_colors"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("board_lists.id", ondelete="CASCADE"),
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

    user: Mapped["User"] = relationship("User", back_populates="list_colors")
    board_list: Mapped["BoardList"] = relationship("BoardList", back_populates="user_colors")

    def __repr__(self) -> str:
        return f"<UIListColor user_id={self.user_id} list_id={self.list_id} color={self.color!r}>"
