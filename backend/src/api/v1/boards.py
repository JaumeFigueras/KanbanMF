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
from src.model.user_avatar import UserAvatar
from src.model.user_board_star import UserBoardStar
from src.model.user_preferences import UserPreferences
from src.schemas.board import BoardCreate, BoardRead, BoardUpdate, BoardsResponse

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
        .where(
            Board.owner_id == current_user.id,
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
        )
        .order_by(Board.created_at.desc())
    )
    owned = owned_result.scalars().all()

    shared_result = await db.execute(
        select(Board)
        .join(BoardShare, BoardShare.board_id == Board.id)
        .where(
            BoardShare.user_id == current_user.id,
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
        )
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


@router.get("/archived", response_model=list[BoardRead])
async def list_archived_boards(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BoardRead]:
    """Return owned archived (but not deleted) boards for the current user."""
    result = await db.execute(
        select(Board)
        .where(
            Board.owner_id == current_user.id,
            Board.is_archived.is_(True),
            Board.is_deleted.is_(False),
        )
        .order_by(Board.created_at.desc())
    )
    boards = result.scalars().all()
    if not boards:
        return []

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

    starred = await _starred_ids(current_user.id, db)

    return [
        _to_read(b, starred, current_user.display_name, owner_initials, owner_has_avatar)
        for b in boards
    ]


@router.get("/{board_id}", response_model=BoardRead)
async def get_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardRead:
    """Fetch a single board. User must be the owner or a shared member."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")

    if board.owner_id != current_user.id:
        share_result = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == current_user.id,
            )
        )
        if share_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Fetch owner info
    owner_name = current_user.display_name
    pref_owner_id = current_user.id
    if board.owner_id != current_user.id:
        owner_result = await db.execute(select(User).where(User.id == board.owner_id))
        owner = owner_result.scalar_one_or_none()
        owner_name = owner.display_name if owner else ""
        pref_owner_id = board.owner_id

    pref_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == pref_owner_id)
    )
    pref = pref_result.scalar_one_or_none()
    owner_initials = (
        pref.initials if (pref and pref.initials)
        else _compute_initials(owner_name)
    )
    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == board.owner_id)
    )
    owner_has_avatar = avatar_result.scalar_one_or_none() is not None
    starred = await _starred_ids(current_user.id, db)

    return _to_read(board, starred, owner_name, owner_initials, owner_has_avatar)


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete a board (is_deleted=True). Only the owner can delete a board."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this board")

    board.is_deleted = True
    await db.commit()


@router.patch("/{board_id}", response_model=BoardRead)
async def update_board(
    board_id: uuid.UUID,
    body: BoardUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardRead:
    """Update a board's name. Only the owner can update a board."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can update this board")

    if body.name is not None:
        board.name = body.name
    if body.is_archived is not None:
        board.is_archived = body.is_archived
    await db.commit()
    await db.refresh(board)

    # Resolve owner info (always the current user for owned boards)
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

    star_result = await db.execute(
        select(UserBoardStar.board_id).where(
            UserBoardStar.user_id == current_user.id,
            UserBoardStar.board_id == board.id,
        )
    )
    starred: set[uuid.UUID] = {board.id} if star_result.scalar_one_or_none() else set()

    return _to_read(board, starred, current_user.display_name, owner_initials, owner_has_avatar)
