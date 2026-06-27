#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.user import User
from src.model.user_board_star import UserBoardStar
from src.schemas.board import BoardCreate, BoardRead, BoardsResponse

router = APIRouter()


async def _starred_ids(user_id: uuid.UUID, db: AsyncSession) -> set[uuid.UUID]:
    """Return the set of board IDs that the given user has starred."""
    result = await db.execute(
        select(UserBoardStar.board_id).where(UserBoardStar.user_id == user_id)
    )
    return set(result.scalars().all())


def _to_read(board: Board, starred: set[uuid.UUID]) -> BoardRead:
    return BoardRead(
        id=board.id,
        owner_id=board.owner_id,
        name=board.name,
        is_archived=board.is_archived,
        is_deleted=board.is_deleted,
        is_starred=board.id in starred,
        created_at=board.created_at,
        updated_at=board.updated_at,
    )


@router.get("", response_model=BoardsResponse)
async def list_boards(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardsResponse:
    """Return all non-deleted boards for the current user.

    - owned: boards where the current user is the owner.
    - shared: boards shared with the current user by someone else.

    Each board carries an is_starred flag scoped to the current user.
    """
    starred = await _starred_ids(current_user.id, db)

    owned_result = await db.execute(
        select(Board)
        .where(Board.owner_id == current_user.id, Board.is_deleted.is_(False))
        .order_by(Board.created_at.desc())
    )
    owned = owned_result.scalars().all()

    shared_result = await db.execute(
        select(Board)
        .join(BoardShare, BoardShare.board_id == Board.id)
        .where(BoardShare.user_id == current_user.id, Board.is_deleted.is_(False))
        .order_by(Board.created_at.desc())
    )
    shared = shared_result.scalars().all()

    return BoardsResponse(
        owned=[_to_read(b, starred) for b in owned],
        shared=[_to_read(b, starred) for b in shared],
    )


@router.post("", response_model=BoardRead, status_code=status.HTTP_201_CREATED)
async def create_board(
    body: BoardCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardRead:
    """Create a new board owned by the current user.

    If is_starred is True, a UserBoardStar entry is created in the same
    transaction so the board appears in the Starred accordion immediately.
    """
    board = Board(
        owner_id=current_user.id,
        name=body.name,
    )
    db.add(board)
    await db.flush()  # assigns board.id before we reference it in UserBoardStar

    if body.is_starred:
        db.add(UserBoardStar(user_id=current_user.id, board_id=board.id))

    await db.commit()
    await db.refresh(board)

    return _to_read(board, {board.id} if body.is_starred else set())
