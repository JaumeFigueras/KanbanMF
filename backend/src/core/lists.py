#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""List operations shared by the list routes and anything else that works on
a board's lists: creating a list, with its access check and WebSocket
notification, and the board's color passed on to the new list.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.access import get_accessible_board
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification, board_recipients
from src.model.board_list import BoardList
from src.model.ui_board_color import UIBoardColor
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_list_color import UIListColor
from src.model.user import User
from src.schemas.board_list import BoardListRead


async def create_list(
    board_id: uuid.UUID,
    name: str,
    user: User,
    db: AsyncSession,
    client_id: str | None,
) -> BoardListRead:
    """Create a new list on a board and append it to the order. User must be owner or shared member.

    The list starts with the creator's own color for the board, if they gave
    it one, so it doesn't stick out; without one it keeps the default.
    """
    board = await get_accessible_board(board_id, user, db)

    board_list = BoardList(board_id=board_id, name=name)
    db.add(board_list)
    await db.flush()  # assigns board_list.id before the order upsert

    # Append new list to the order array (creates the row if it doesn't exist yet)
    stmt = pg_insert(UIBoardListOrder).values(
        board_id=board_id,
        list_ids=[board_list.id],
    ).on_conflict_do_update(
        index_elements=["board_id"],
        set_={
            "list_ids": func.array_append(UIBoardListOrder.list_ids, board_list.id),
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)

    board_color = await db.scalar(
        select(UIBoardColor.color).where(UIBoardColor.user_id == user.id, UIBoardColor.board_id == board_id)
    )
    if board_color is not None:
        db.add(UIListColor(user_id=user.id, list_id=board_list.id, color=board_color))

    await db.commit()
    await db.refresh(board_list)

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(recipients, board_notification("list_created", board_id, client_id))

    return BoardListRead.model_validate(board_list)
