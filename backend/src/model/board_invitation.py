#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.model.base import Base

if TYPE_CHECKING:
    from src.model.board import Board
    from src.model.user import User

# How long an invitation stays pending before it's ignored and cleaned up.
INVITATION_TTL = timedelta(days=30)


def _generate_token() -> str:
    return secrets.token_urlsafe(32)


def _default_expiry() -> datetime:
    return datetime.now(timezone.utc) + INVITATION_TTL


class BoardInvitation(Base):
    """A pending share of a board with an e-mail address that has no account yet.

    ``BoardShare`` needs a user row to point at, so an invitation to someone
    who isn't registered is kept here instead. Once an account with that
    e-mail address is verified (local e-mail verification, or a Google
    sign-in), every unexpired invitation for it is turned into a
    ``BoardShare`` and the invitation row is deleted.

    ``email`` is always stored lowercase (enforced by a ``CHECK``) so the
    match against the user's address can be case-insensitive while the
    ``(board_id, email)`` unique constraint still blocks duplicates that
    differ only in case.

    ``token`` goes into the link in the invitation e-mail. It only lets the
    sign-up page show the invitation and pre-fill the address; access is
    granted by the verified e-mail match, never by the token alone.
    """

    __tablename__ = "board_invitations"

    __table_args__ = (
        UniqueConstraint("board_id", "email", name="uq_board_invitations_board_email"),
        CheckConstraint("email = lower(email)", name="ck_board_invitations_email_lowercase"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("boards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="Invited address, lowercase. Matched against users.email case-insensitively.",
    )

    invited_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="The board owner who sent the invitation.",
    )

    language: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="Language the invitation e-mail was written in (en, ca).",
    )

    token: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        default=_generate_token,
        comment="Random token for the sign-up link in the invitation e-mail.",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_default_expiry,
        comment="After this the invitation is ignored and deleted by the hourly cleanup.",
    )

    # Relationships
    board: Mapped["Board"] = relationship(
        "Board",
        back_populates="invitations",
    )

    invited_by: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        return f"<BoardInvitation id={self.id} board_id={self.board_id} email={self.email!r}>"
