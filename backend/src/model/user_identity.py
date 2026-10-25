#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`UserIdentity` model and the :class:`AuthProvider` enum: how a
user signs in.
"""

import uuid
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

class AuthProvider(str, enum.Enum):
    """Supported authentication providers."""
    LOCAL = "local"
    GOOGLE = "google"


class UserIdentity(Base):
    """Authentication identity for a user.

    One user can have multiple identities (e.g., local + Google).

    LOCAL provider:
        - hashed_password is set.
        - hashed_verification_token and verification_token_expiry are set
          until the user verifies their email, then cleared.
        - provider_user_id is None.

    GOOGLE provider:
        - provider_user_id (Google's 'sub' field) is set.
        - hashed_password, hashed_verification_token, verification_token_expiry are None.
        - User is considered verified automatically.

    Google's own access and refresh tokens are not kept: Google is only used
    to sign in, and a stored token would let whoever read the table act on
    the user's Google account.
    """
    __tablename__ = "user_identities"

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

    # Auth provider
    provider: Mapped[AuthProvider] = mapped_column(
        SAEnum(AuthProvider, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )

    # --- Google OAuth fields (nullable for local accounts) ---
    provider_user_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Google's unique user ID ('sub' field in the ID token)."
    )

    # --- Local auth fields (nullable for Google accounts) ---
    hashed_password: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="bcrypt hashed password. Only set for local accounts."
    )

    # Email verification (only used for local accounts)
    hashed_verification_token: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        unique=True,
        comment="SHA-256 (hex) of the one-time token sent by email. Cleared after successful verification."
    )
    verification_token_expiry: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="identities"
    )

    def __repr__(self) -> str:
        return f"<UserIdentity user_id={self.user_id} provider={self.provider}>"
