#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base
from src.model.board_share import BoardShare
from src.model.user_board_star import UserBoardStar
from src.model.card_member import CardMember
from src.model.card_assignee import CardAssignee

if TYPE_CHECKING:
    from src.model.board import Board
    from src.model.board_notification_settings import BoardNotificationSettings
    from src.model.card import Card
    from src.model.card_due_notification import CardDueNotification
    from src.model.ui_board_color import UIBoardColor
    from src.model.ui_board_order import UIBoardOrder
    from src.model.ui_card_color import UICardColor
    from src.model.ui_list_color import UIListColor


class User(Base):
    """Core user profile. One row per real-world person.

    Email is the unique identifier across all providers.
    - Local users can change their email (is_verified resets to False).
    - Google users have their email managed by Google and cannot change it here.

    Authentication credentials are stored separately in UserIdentity
    so the same user can log in via multiple providers.
    """
    __tablename__ = "users"

    # Primary key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )

    # Profile fields
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
        comment="Unique identifier. Changeable for local accounts; managed by Google for OAuth users."
    )
    display_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )

    # Account status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False
    )
    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="True when email has been verified. Always True for Google users. Resets to False when local user changes email."
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )

    # Relationships
    identities: Mapped[List["UserIdentity"]] = relationship(
        "UserIdentity",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    avatar: Mapped[Optional["UserAvatar"]] = relationship(
        "UserAvatar",
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False
    )
    sessions: Mapped[List["UserSession"]] = relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    preferences: Mapped[List["UserPreferences"]] = relationship(
        "UserPreferences",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    owned_boards: Mapped[List["Board"]] = relationship(
        "Board",
        foreign_keys="[Board.owner_id]",
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    board_share_entries: Mapped[List["BoardShare"]] = relationship(
        "BoardShare",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    board_stars: Mapped[List["UserBoardStar"]] = relationship(
        "UserBoardStar",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    # Convenience: direct access to Board objects without going through the join model
    shared_boards: Mapped[List["Board"]] = relationship(
        "Board",
        secondary=BoardShare.__table__,
        back_populates="shared_with",
        viewonly=True,
    )
    starred_boards: Mapped[List["Board"]] = relationship(
        "Board",
        secondary=UserBoardStar.__table__,
        back_populates="starred_by",
        viewonly=True,
    )
    ui_board_order: Mapped[Optional["UIBoardOrder"]] = relationship(
        "UIBoardOrder",
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )

    created_cards: Mapped[List["Card"]] = relationship(
        "Card",
        foreign_keys="[Card.creator_id]",
        back_populates="creator",
    )

    member_cards: Mapped[List["Card"]] = relationship(
        "Card",
        secondary=CardMember.__table__,
        back_populates="members",
    )

    assignee_cards: Mapped[List["Card"]] = relationship(
        "Card",
        secondary=CardAssignee.__table__,
        back_populates="assignees",
    )

    due_notifications: Mapped[List["CardDueNotification"]] = relationship(
        "CardDueNotification",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    board_colors: Mapped[List["UIBoardColor"]] = relationship(
        "UIBoardColor",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    list_colors: Mapped[List["UIListColor"]] = relationship(
        "UIListColor",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    card_colors: Mapped[List["UICardColor"]] = relationship(
        "UICardColor",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    board_notification_settings: Mapped[List["BoardNotificationSettings"]] = relationship(
        "BoardNotificationSettings",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"
