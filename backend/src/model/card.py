#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base
from src.model.card_member import CardMember
from src.model.card_assignee import CardAssignee
from src.model.card_label import CardLabel

if TYPE_CHECKING:
    from src.model.board_list import BoardList
    from src.model.label import Label
    from src.model.user import User


class Card(Base):
    """A card inside a board list.

    Deletion and archiving are soft-flags; the API filters them at query time.
    creator_id is nullable so that cards survive if the creator account is deleted.
    """

    __tablename__ = "cards"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("board_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    creator_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
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
    )

    start_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    due_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    end_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
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
    board_list: Mapped["BoardList"] = relationship(
        "BoardList",
        back_populates="cards",
    )

    creator: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[creator_id],
        back_populates="created_cards",
    )

    members: Mapped[List["User"]] = relationship(
        "User",
        secondary=CardMember.__table__,
        back_populates="member_cards",
    )

    assignees: Mapped[List["User"]] = relationship(
        "User",
        secondary=CardAssignee.__table__,
        back_populates="assignee_cards",
    )

    labels: Mapped[List["Label"]] = relationship(
        "Label",
        secondary=CardLabel.__table__,
        back_populates="cards",
    )

    def __repr__(self) -> str:
        return f"<Card id={self.id} name={self.name!r} list_id={self.list_id}>"
