#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model import Base

# Refresh token lifetime: 30 days
REFRESH_TOKEN_EXPIRE_DAYS = 30


class UserSession(Base):
    """Persistent login session for a user.

    Implements the refresh token rotation pattern:
    - On login: a refresh token is created and stored HASHED here.
      The plain token is sent to the client as an HTTP-only cookie.
    - On token refresh: the plain token from the cookie is verified
      against the hash, a new refresh token is issued (old one deleted),
      and a new short-lived JWT access token is returned.
    - On logout: the session row is deleted, invalidating the refresh token.

    One user can have multiple active sessions (multiple devices).
    """
    __tablename__ = "user_sessions"

    # Primary key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    # Foreign key to User
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Hashed refresh token — never store the plain token in the DB
    hashed_refresh_token: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="bcrypt hash of the refresh token. Plain token is sent via HTTP-only cookie."
    )

    # Device / client info (optional, useful for 'active sessions' management UI)
    device_info: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="e.g. 'Chrome on Windows 11' or 'Safari on iPhone'. Informational only."
    )

    # Session validity
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment=f"Session expiry. Refresh tokens last {REFRESH_TOKEN_EXPIRE_DAYS} days."
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="Updated every time the refresh token is used to get a new access token."
    )

    # Relationship
    user: Mapped["User"] = relationship(
        "User",
        back_populates="sessions"
    )

    def __repr__(self) -> str:
        return f"<UserSession id={self.id} user_id={self.user_id} device={self.device_info}>"
