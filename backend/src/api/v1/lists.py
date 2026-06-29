#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.user import User
from src.schemas.board_list import BoardListCreate, BoardListRead, BoardListUpdate

router = APIRouter()


async def _get_accessible_board(
    board_id: uuid.UUID, user: User, db: AsyncSession
) -> Board:
    """Return the board if the user is the owner or a shared member, else raise."""
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


@router.get("", response_model=list[BoardListRead])
async def list_board_lists(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BoardListRead]:
    """Return all non-deleted lists for a board. User must be the owner or a shared member."""
    await _get_accessible_board(board_id, current_user, db)

    result = await db.execute(
        select(BoardList)
        .where(
            BoardList.board_id == board_id,
            BoardList.is_deleted.is_(False),
        )
        .order_by(BoardList.created_at.asc())
    )
    lists = result.scalars().all()
    return [BoardListRead.model_validate(lst) for lst in lists]


@router.post("", response_model=BoardListRead, status_code=status.HTTP_201_CREATED)
async def create_board_list(
    board_id: uuid.UUID,
    body: BoardListCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardListRead:
    """Create a new list on a board. User must be the owner or a shared member."""
    await _get_accessible_board(board_id, current_user, db)

    board_list = BoardList(board_id=board_id, name=body.name)
    db.add(board_list)
    await db.commit()
    await db.refresh(board_list)
    return BoardListRead.model_validate(board_list)


@router.patch("/{list_id}", response_model=BoardListRead)
async def update_board_list(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    body: BoardListUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardListRead:
    """Update a list's name or archived status. User must be the owner or a shared member."""
    await _get_accessible_board(board_id, current_user, db)

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

    if body.name is not None:
        board_list.name = body.name
    if body.is_archived is not None:
        board_list.is_archived = body.is_archived

    await db.commit()
    await db.refresh(board_list)
    return BoardListRead.model_validate(board_list)
