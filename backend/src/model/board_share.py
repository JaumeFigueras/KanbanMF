#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base


class BoardShare(Base):
    """Represents a board being shared with a specific user.

    The composite primary key (board_id, user_id) ensures each user can only
    appear once per board. Extra columns (e.g. role, accepted_at) can be added
    here without changing the Board or User models.
    """

    __tablename__ = "board_shares"

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("boards.id", ondelete="CASCADE"),
        primary_key=True,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    shared_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="When the board was shared with this user.",
    )

    # Relationships
    board: Mapped["Board"] = relationship(
        "Board",
        back_populates="shares",
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="board_share_entries",
    )

    def __repr__(self) -> str:
        return f"<BoardShare board_id={self.board_id} user_id={self.user_id}>"
