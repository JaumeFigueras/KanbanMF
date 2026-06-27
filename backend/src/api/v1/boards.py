#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.user import User
from src.model.user_avatar import UserAvatar
from src.model.user_board_star import UserBoardStar
from src.model.user_preferences import UserPreferences
from src.schemas.board import BoardCreate, BoardRead, BoardsResponse

router = APIRouter()


def _compute_initials(display_name: str) -> str:
    return "".join(w[0].upper() for w in display_name.split() if w)[:3]


async def _starred_ids(user_id: uuid.UUID, db: AsyncSession) -> set[uuid.UUID]:
    """Return the set of board IDs that the given user has starred."""
    result = await db.execute(
        select(UserBoardStar.board_id).where(UserBoardStar.user_id == user_id)
    )
    return set(result.scalars().all())


def _to_read(
    board: Board,
    starred: set[uuid.UUID],
    owner_display_name: str,
    owner_initials: str | None,
    owner_has_avatar: bool,
) -> BoardRead:
    return BoardRead(
        id=board.id,
        owner_id=board.owner_id,
        owner_display_name=owner_display_name,
        owner_initials=owner_initials,
        owner_has_avatar=owner_has_avatar,
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

    Each board carries is_starred and owner info scoped to the current user.
    Owner info is batch-fetched in two queries regardless of board count.
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

    # Batch-fetch owner display names and initials for all unique owners
    owner_ids = {b.owner_id for b in list(owned) + list(shared)}
    users_by_id: dict[uuid.UUID, User] = {}
    prefs_by_id: dict[uuid.UUID, UserPreferences] = {}

    avatar_ids: set[uuid.UUID] = set()
    if owner_ids:
        u_result = await db.execute(select(User).where(User.id.in_(owner_ids)))
        users_by_id = {u.id: u for u in u_result.scalars()}

        p_result = await db.execute(
            select(UserPreferences).where(UserPreferences.user_id.in_(owner_ids))
        )
        prefs_by_id = {p.user_id: p for p in p_result.scalars()}

        a_result = await db.execute(
            select(UserAvatar.user_id).where(UserAvatar.user_id.in_(owner_ids))
        )
        avatar_ids = set(a_result.scalars().all())

    def board_to_read(board: Board) -> BoardRead:
        owner = users_by_id.get(board.owner_id)
        pref = prefs_by_id.get(board.owner_id)
        dn = owner.display_name if owner else ""
        initials = pref.initials if (pref and pref.initials) else _compute_initials(dn)
        return _to_read(board, starred, dn, initials, board.owner_id in avatar_ids)

    return BoardsResponse(
        owned=[board_to_read(b) for b in owned],
        shared=[board_to_read(b) for b in shared],
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
    board = Board(owner_id=current_user.id, name=body.name)
    db.add(board)
    await db.flush()  # assigns board.id before we reference it in UserBoardStar

    if body.is_starred:
        db.add(UserBoardStar(user_id=current_user.id, board_id=board.id))

    await db.commit()
    await db.refresh(board)

    pref_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == current_user.id)
    )
    pref = pref_result.scalar_one_or_none()
    owner_initials = (
        pref.initials if (pref and pref.initials)
        else _compute_initials(current_user.display_name)
    )

    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == current_user.id)
    )
    owner_has_avatar = avatar_result.scalar_one_or_none() is not None

    return _to_read(
        board,
        {board.id} if body.is_starred else set(),
        current_user.display_name,
        owner_initials,
        owner_has_avatar,
    )
