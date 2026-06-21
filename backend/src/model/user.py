#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model import Base


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

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"
