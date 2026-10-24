#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`OAuthAuthorizationCode` model: a short-lived, single-use
authorization code.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.model.base import Base


class OAuthAuthorizationCode(Base):
    """The code sent back to the client after the user approves.

    Only the SHA-256 of the code is stored. The client trades it once, within a
    few minutes, at the token endpoint, proving it holds the PKCE verifier; the
    row is deleted when traded.
    """

    __tablename__ = "oauth_authorization_codes"

    code_hash: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        comment="SHA-256 (hex) of the code.",
    )

    grant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mcp_grants.id", ondelete="CASCADE"),
        nullable=False,
    )

    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)

    code_challenge: Mapped[str] = mapped_column(String(128), nullable=False)

    resource: Mapped[str] = mapped_column(Text, nullable=False)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    def __repr__(self) -> str:
        return f"<OAuthAuthorizationCode grant_id={self.grant_id}>"
