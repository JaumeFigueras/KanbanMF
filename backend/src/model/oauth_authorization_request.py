#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`OAuthAuthorizationRequest` model: an authorization request
waiting on the consent page.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.oauth_client import OAuthClient


class OAuthAuthorizationRequest(Base):
    """A validated ``/oauth/authorize`` request, kept while the user decides.

    The authorize endpoint checks the client, the redirect URI and PKCE, stores
    the request here and sends the browser to the frontend's consent page with
    the row's id. Approving or denying it deletes the row; one left alone
    expires after a few minutes and is removed by the hourly clean-up.
    """

    __tablename__ = "oauth_authorization_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("oauth_clients.id", ondelete="CASCADE"),
        nullable=False,
    )

    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)

    state: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="The client's state, returned unchanged with the code.",
    )

    code_challenge: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        comment="PKCE S256 challenge the code verifier must match.",
    )

    resource: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="The MCP server the token will be for (RFC 8707).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relationships
    client: Mapped["OAuthClient"] = relationship("OAuthClient")

    def __repr__(self) -> str:
        return f"<OAuthAuthorizationRequest id={self.id} client_id={self.client_id}>"
