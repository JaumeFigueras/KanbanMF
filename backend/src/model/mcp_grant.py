#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`McpGrant` model: a user's approval of one OAuth client, with
the boards it may reach.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.mcp_grant_board import McpGrantBoard
    from src.model.oauth_client import OAuthClient
    from src.model.user import User


class McpGrant(Base):
    """What a user allowed when they pressed Allow on the consent page.

    One row per approval: the client, the user it acts for, whether it may
    only read, and the boards it may reach (:class:`McpGrantBoard`, only
    boards the user owns). Every token the client gets hangs off the grant,
    so deleting the grant — "revoke" in the connected apps list — ends the
    access at once. Boards added later are never included on their own.
    """

    __tablename__ = "mcp_grants"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("oauth_clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    read_only: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="When true the client may read the boards but not change them.",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last time one of the grant's access tokens was accepted.",
    )

    # Relationships
    user: Mapped["User"] = relationship("User")

    client: Mapped["OAuthClient"] = relationship("OAuthClient")

    boards: Mapped[list["McpGrantBoard"]] = relationship(
        "McpGrantBoard",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<McpGrant id={self.id} user_id={self.user_id} client_id={self.client_id}>"
