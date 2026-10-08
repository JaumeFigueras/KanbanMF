#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Turning pending board invitations into shares, and cleaning up expired ones.

An invitation is addressed to an e-mail, not a user, so nothing can be shared
until an account with that address exists *and* has proved it owns the
address. accept_pending_invitations() is therefore called only at the two
points where an account becomes verified: local e-mail verification and a
Google sign-in (Google addresses are verified by Google).
"""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification
from src.model.board import Board
from src.model.board_invitation import BoardInvitation
from src.model.board_share import BoardShare
from src.model.user import User

logger = logging.getLogger(__name__)


async def accept_pending_invitations(db: AsyncSession, user: User) -> list[uuid.UUID]:
    """Share with ``user`` every board they have an unexpired invitation to.

    Matches the invitations' (lowercase) e-mail against the user's address
    case-insensitively, adds a BoardShare for each one (unless the board is
    already shared with them) and deletes the accepted invitations, then
    notifies the owner and the user so their open tabs refetch. Invitations
    to a board that has since been deleted are dropped without sharing.
    Expired ones are left for delete_expired_invitations().

    Must only be called for a verified user. Commits its own changes and
    returns the ids of the boards newly shared.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(BoardInvitation, Board)
        .join(Board, Board.id == BoardInvitation.board_id)
        .where(
            BoardInvitation.email == user.email.lower(),
            BoardInvitation.expires_at > now,
        )
    )
    rows = list(result.all())
    if not rows:
        return []

    shared: list[tuple[uuid.UUID, uuid.UUID]] = []
    for invitation, board in rows:
        if not board.is_deleted and board.owner_id != user.id:
            await db.execute(
                pg_insert(BoardShare)
                .values(board_id=board.id, user_id=user.id)
                .on_conflict_do_nothing(index_elements=["board_id", "user_id"])
            )
            shared.append((board.id, board.owner_id))
        await db.delete(invitation)
    await db.commit()

    for board_id, owner_id in shared:
        await manager.notify_many({owner_id, user.id}, board_notification("board_shared", board_id, None))
        await manager.notify(owner_id, board_notification("board_invitations_changed", board_id, None))

    return [board_id for board_id, _ in shared]


async def delete_expired_invitations() -> None:
    """Hourly job: remove invitations past their expiry date.

    Every query already ignores expired invitations, so this only keeps the
    table from growing; nothing depends on it running on time.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(BoardInvitation).where(BoardInvitation.expires_at <= datetime.now(timezone.utc))
        )
        await db.commit()
    if result.rowcount:
        logger.info("Deleted %d expired board invitation(s)", result.rowcount)
