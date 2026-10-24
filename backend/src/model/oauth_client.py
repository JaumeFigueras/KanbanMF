#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`OAuthClient` model: an application allowed to ask for access to
the MCP server, such as Claude.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.model.base import Base

# How an OAuthClient came to exist.
REGISTRATION_DCR = "dcr"
REGISTRATION_CIMD = "cimd"


class OAuthClient(Base):
    """An OAuth client of the MCP authorization server.

    Clients are public (they hold no secret; PKCE protects the code) and come
    in two kinds, told apart by ``registration``:

    - ``dcr``: registered by the client itself through Dynamic Client
      Registration (RFC 7591). ``client_id`` is a random string issued here.
      Claude's hosted apps register a new client for every connection, so
      clients never approved by anyone are deleted by the hourly clean-up.
    - ``cimd``: a Client ID Metadata Document. ``client_id`` is an HTTPS URL
      the client publishes its name and redirect URIs at; the row caches that
      document, fetched again once ``metadata_fetched_at`` is a day old.

    A client is only a name and a list of redirect URIs: on its own it can do
    nothing. Access comes from an :class:`~src.model.mcp_grant.McpGrant`,
    which a user creates on the consent page.
    """

    __tablename__ = "oauth_clients"

    __table_args__ = (
        CheckConstraint("registration IN ('dcr', 'cimd')", name="ck_oauth_clients_registration"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    client_id: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        unique=True,
        comment="The OAuth client_id: a random string (dcr) or the metadata document's URL (cimd).",
    )

    registration: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="dcr (Dynamic Client Registration) or cimd (Client ID Metadata Document).",
    )

    client_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="Name shown on the consent page and in the connected apps list.",
    )

    redirect_uris: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        comment="Where the authorization code may be sent; matched exactly (loopback: any port).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    metadata_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="cimd only: when the metadata document was last fetched.",
    )

    def __repr__(self) -> str:
        return f"<OAuthClient id={self.id} client_id={self.client_id!r} registration={self.registration}>"
