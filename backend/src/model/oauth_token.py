#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`OAuthToken` model: an access token and its refresh token."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.mcp_grant import McpGrant


class OAuthToken(Base):
    """An access/refresh token pair issued for a grant.

    Both tokens are random strings, stored only as their SHA-256: they are not
    JWTs, so ``get_current_user`` never accepts them and they work only on the
    MCP server. Refreshing rotates: a new row is created and this one gets
    ``rotated_at`` and an expired access token. Presenting a rotated refresh
    token again means it leaked, so the whole grant is deleted.
    """

    __tablename__ = "oauth_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    grant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mcp_grants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    access_token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        comment="SHA-256 (hex) of the access token.",
    )

    refresh_token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        comment="SHA-256 (hex) of the refresh token.",
    )

    resource: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="The MCP server the tokens are for (their audience).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    access_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    refresh_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    rotated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the refresh token was traded for a new pair; it is dead from then on.",
    )

    # Relationships
    grant: Mapped["McpGrant"] = relationship("McpGrant")

    def __repr__(self) -> str:
        return f"<OAuthToken id={self.id} grant_id={self.grant_id}>"
