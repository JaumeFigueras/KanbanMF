#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.model.board_share import BoardShare


def board_notification(event_type: str, board_id: uuid.UUID | None, client_id: str | None) -> dict:
    """Build a notify-and-refetch WebSocket message.

    board_id is None for events that aren't tied to a single board (e.g. a
    user's own board display order). origin_client_id lets the tab/session
    that triggered the change tell its own echo apart from someone else's.
    """
    return {
        "type": event_type,
        "board_id": str(board_id) if board_id is not None else None,
        "origin_client_id": client_id,
    }


async def board_recipients(board_id: uuid.UUID, owner_id: uuid.UUID, db: AsyncSession) -> set[uuid.UUID]:
    """Return everyone who can see this board: its owner plus every shared member."""
    result = await db.execute(select(BoardShare.user_id).where(BoardShare.board_id == board_id))
    return {owner_id, *result.scalars().all()}
