#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Access checks shared by the routes and the operations in ``src.core``:
load a board the user may see, and a list or card that belongs to it, and
refuse templates where they don't fit.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.user import User


async def get_accessible_board(board_id: uuid.UUID, user: User, db: AsyncSession) -> Board:
    """Return the live board if the user owns it or it is shared with them.

    Raises 404 when the board doesn't exist or is deleted, 403 when the user
    has no access to it.
    """
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != user.id:
        share = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == user.id,
            )
        )
        if share.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return board


async def get_list(board_id: uuid.UUID, list_id: uuid.UUID, db: AsyncSession) -> BoardList:
    """Return the board's non-deleted list, or raise 404."""
    result = await db.execute(
        select(BoardList).where(
            BoardList.id == list_id,
            BoardList.board_id == board_id,
            BoardList.is_deleted.is_(False),
        )
    )
    board_list = result.scalar_one_or_none()
    if board_list is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="List not found")
    return board_list


async def get_card(
    list_id: uuid.UUID, card_id: uuid.UUID, db: AsyncSession, options: tuple = ()
) -> Card:
    """Return the list's non-deleted card, or raise 404.

    ``options`` are loader options for the query, e.g.
    :func:`src.core.cards.card_load_options`.
    """
    result = await db.execute(
        select(Card)
        .options(*options)
        .where(
            Card.id == card_id,
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    return card


def reject_if_template(board: Board, detail: str) -> None:
    """Raise 400 when ``board`` is a template.

    Templates hold only lists, so every route that would put a card, a label,
    a star or notification settings on a board calls this first. Not a FastAPI
    dependency: each router already loads the board through its own access
    check, and this runs on the result.
    """
    if board.is_template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
