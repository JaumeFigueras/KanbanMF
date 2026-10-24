#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The :class:`McpGrantBoard` model: one board an MCP grant may reach."""

import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.model.base import Base


class McpGrantBoard(Base):
    """A board ticked on the consent page for a grant.

    Only boards the grant's user owns are ever stored, and the MCP server
    checks the board again on every call, so one that is deleted or archived
    drops out of reach without this row being touched.
    """

    __tablename__ = "mcp_grant_boards"

    grant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mcp_grants.id", ondelete="CASCADE"),
        primary_key=True,
    )

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("boards.id", ondelete="CASCADE"),
        primary_key=True,
    )

    def __repr__(self) -> str:
        return f"<McpGrantBoard grant_id={self.grant_id} board_id={self.board_id}>"
