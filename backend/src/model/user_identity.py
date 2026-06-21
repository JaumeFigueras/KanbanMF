#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model import Base

class AuthProvider(str, enum.Enum):
    """Supported authentication providers."""
    LOCAL = "local"
    GOOGLE = "google"


class UserIdentity(Base):
    """Authentication identity for a user.

    One user can have multiple identities (e.g., local + Google).

    LOCAL provider:
        - hashed_password is set.
        - verification_token and verification_token_expiry are set until
          the user verifies their email, then cleared.
        - provider_user_id, access_token, refresh_token, token_expiry are None.

    GOOGLE provider:
        - provider_user_id (Google's 'sub' field) is set.
        - access_token, refresh_token, token_expiry are set.
        - hashed_password, verification_token, verification_token_expiry are None.
        - User is considered verified automatically.
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
        SAEnum(AuthProvider),
        nullable=False
    )

    # --- Google OAuth fields (nullable for local accounts) ---
    provider_user_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Google's unique user ID ('sub' field in the ID token)."
    )
    access_token: Mapped[Optional[str]] = mapped_column(
        String(2048),
        nullable=True
    )
    refresh_token: Mapped[Optional[str]] = mapped_column(
        String(2048),
        nullable=True
    )
    token_expiry: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # --- Local auth fields (nullable for Google accounts) ---
    hashed_password: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="bcrypt hashed password. Only set for local accounts."
    )

    # Email verification (only used for local accounts)
    verification_token: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="One-time token sent by email. Cleared after successful verification."
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
