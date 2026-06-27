#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import List

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base
from src.model.board_share import BoardShare


class Board(Base):
    """A Kanban board owned by a user and optionally shared with others.

    Deletion is soft: is_deleted=True hides the board without removing it from the DB.
    Archived boards are read-only; starred boards are pinned in the UI.
    """

    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    is_starred: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    is_archived: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="Soft-delete flag. Deleted boards are hidden but retained in the DB.",
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
    owner: Mapped["User"] = relationship(
        "User",
        foreign_keys=[owner_id],
        back_populates="owned_boards",
    )

    shares: Mapped[List["BoardShare"]] = relationship(
        "BoardShare",
        back_populates="board",
        cascade="all, delete-orphan",
    )

    # Convenience: direct access to User objects without going through BoardShare
    shared_with: Mapped[List["User"]] = relationship(
        "User",
        secondary=BoardShare.__table__,
        back_populates="shared_boards",
        viewonly=True,
    )

    def __repr__(self) -> str:
        return f"<Board id={self.id} name={self.name!r} owner_id={self.owner_id}>"
