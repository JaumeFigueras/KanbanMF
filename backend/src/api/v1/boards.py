#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.ui_board_order import UIBoardOrder
from src.model.user import User
from src.model.user_avatar import UserAvatar
from src.model.user_board_star import UserBoardStar
from src.model.user_preferences import UserPreferences
from src.schemas.board import (
    BoardCreate,
    BoardOrderRead,
    BoardOrderUpdate,
    BoardRead,
    BoardUpdate,
    BoardsResponse,
)
from src.schemas.person import PersonRead

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


async def _get_order(user_id: uuid.UUID, db: AsyncSession) -> UIBoardOrder | None:
    result = await db.execute(
        select(UIBoardOrder).where(UIBoardOrder.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _remove_from_order(
    user_id: uuid.UUID, board_id: uuid.UUID, db: AsyncSession
) -> None:
    """Remove a board ID from all three order arrays in one statement."""
    await db.execute(
        update(UIBoardOrder)
        .where(UIBoardOrder.user_id == user_id)
        .values(
            owned_ids=func.array_remove(UIBoardOrder.owned_ids, board_id),
            starred_ids=func.array_remove(UIBoardOrder.starred_ids, board_id),
            shared_ids=func.array_remove(UIBoardOrder.shared_ids, board_id),
            updated_at=func.now(),
        )
    )


@router.get("", response_model=BoardsResponse)
async def list_boards(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardsResponse:
    """Return all non-deleted boards for the current user."""
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
    """Create a new board and append it to the owner's board order."""
    board = Board(owner_id=current_user.id, name=body.name)
    db.add(board)
    await db.flush()

    if body.is_starred:
        db.add(UserBoardStar(user_id=current_user.id, board_id=board.id))

    # Append to owned_ids (and starred_ids if requested)
    order_update: dict = {
        "owned_ids": func.array_append(UIBoardOrder.owned_ids, board.id),
        "updated_at": func.now(),
    }
    if body.is_starred:
        order_update["starred_ids"] = func.array_append(UIBoardOrder.starred_ids, board.id)

    await db.execute(
        pg_insert(UIBoardOrder).values(
            user_id=current_user.id,
            starred_ids=[board.id] if body.is_starred else [],
            owned_ids=[board.id],
            shared_ids=[],
        ).on_conflict_do_update(
            index_elements=["user_id"],
            set_=order_update,
        )
    )

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


# NOTE: /order must be defined before /{board_id} so FastAPI matches the
# literal "order" segment before trying to parse it as a UUID.

@router.get("/order", response_model=BoardOrderRead)
async def get_board_order(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardOrderRead:
    """Return the stored board display order for the current user."""
    order = await _get_order(current_user.id, db)
    if order is None:
        return BoardOrderRead(starred_ids=[], owned_ids=[], shared_ids=[])
    return BoardOrderRead(
        starred_ids=order.starred_ids,
        owned_ids=order.owned_ids,
        shared_ids=order.shared_ids,
    )


@router.put("/order", response_model=BoardOrderRead)
async def update_board_order(
    body: BoardOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardOrderRead:
    """Replace one or more section orderings. Omit a field to leave it unchanged."""
    order = await _get_order(current_user.id, db)
    current_starred = order.starred_ids if order else []
    current_owned = order.owned_ids if order else []
    current_shared = order.shared_ids if order else []

    new_starred = body.starred_ids if body.starred_ids is not None else current_starred
    new_owned = body.owned_ids if body.owned_ids is not None else current_owned
    new_shared = body.shared_ids if body.shared_ids is not None else current_shared

    await db.execute(
        pg_insert(UIBoardOrder).values(
            user_id=current_user.id,
            starred_ids=new_starred,
            owned_ids=new_owned,
            shared_ids=new_shared,
        ).on_conflict_do_update(
            index_elements=["user_id"],
            set_={
                "starred_ids": new_starred,
                "owned_ids": new_owned,
                "shared_ids": new_shared,
                "updated_at": func.now(),
            },
        )
    )
    await db.commit()

    return BoardOrderRead(
        starred_ids=new_starred,
        owned_ids=new_owned,
        shared_ids=new_shared,
    )


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
    """Soft-delete a board and remove it from the owner's order."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this board")

    board.is_deleted = True
    await _remove_from_order(current_user.id, board_id, db)
    await db.commit()


async def _check_board_access(
    board_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> Board:
    """Return the board if the user is the owner or a shared member, else raise."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != current_user.id:
        share = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == current_user.id,
            )
        )
        if share.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return board


@router.get("/{board_id}/members", response_model=list[PersonRead])
async def list_board_members(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PersonRead]:
    """Return the users allowed to work with the board: its owner plus everyone it's shared with."""
    board = await _check_board_access(board_id, current_user, db)

    share_result = await db.execute(
        select(BoardShare.user_id).where(BoardShare.board_id == board_id)
    )
    member_ids = {board.owner_id, *share_result.scalars().all()}

    users_result = await db.execute(select(User).where(User.id.in_(member_ids)))
    users = list(users_result.scalars().all())

    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id.in_(member_ids))
    )
    prefs_by_id = {p.user_id: p for p in prefs_result.scalars()}

    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id.in_(member_ids))
    )
    avatar_ids = set(avatar_result.scalars().all())

    people = [
        PersonRead(
            id=user.id,
            display_name=user.display_name,
            initials=(
                prefs_by_id[user.id].initials
                if user.id in prefs_by_id and prefs_by_id[user.id].initials
                else _compute_initials(user.display_name)
            ),
            has_avatar=user.id in avatar_ids,
        )
        for user in users
    ]
    people.sort(key=lambda p: p.display_name.lower())
    return people


@router.patch("/{board_id}", response_model=BoardRead)
async def update_board(
    board_id: uuid.UUID,
    body: BoardUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardRead:
    """Update a board's name or archived status. Only the owner can update a board."""
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
        was_archived = board.is_archived
        board.is_archived = body.is_archived

        if body.is_archived and not was_archived:
            # Archiving: remove from all order arrays
            await _remove_from_order(current_user.id, board_id, db)
        elif not body.is_archived and was_archived:
            # Restoring: append back to owned_ids
            await db.execute(
                pg_insert(UIBoardOrder).values(
                    user_id=current_user.id,
                    starred_ids=[],
                    owned_ids=[board_id],
                    shared_ids=[],
                ).on_conflict_do_update(
                    index_elements=["user_id"],
                    set_={
                        "owned_ids": func.array_append(UIBoardOrder.owned_ids, board_id),
                        "updated_at": func.now(),
                    },
                )
            )

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

    star_result = await db.execute(
        select(UserBoardStar.board_id).where(
            UserBoardStar.user_id == current_user.id,
            UserBoardStar.board_id == board.id,
        )
    )
    starred: set[uuid.UUID] = {board.id} if star_result.scalar_one_or_none() else set()

    return _to_read(board, starred, current_user.display_name, owner_initials, owner_has_avatar)


@router.post("/{board_id}/star", status_code=status.HTTP_204_NO_CONTENT)
async def star_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Star a board. Idempotent — starring an already-starred board is a no-op."""
    await _check_board_access(board_id, current_user, db)

    result = await db.execute(
        pg_insert(UserBoardStar)
        .values(user_id=current_user.id, board_id=board_id)
        .on_conflict_do_nothing()
    )

    if result.rowcount > 0:
        # Only update the order array when a new star was actually inserted.
        await db.execute(
            pg_insert(UIBoardOrder)
            .values(user_id=current_user.id, starred_ids=[board_id], owned_ids=[], shared_ids=[])
            .on_conflict_do_update(
                index_elements=["user_id"],
                set_={
                    "starred_ids": func.array_append(UIBoardOrder.starred_ids, board_id),
                    "updated_at": func.now(),
                },
            )
        )

    await db.commit()


@router.delete("/{board_id}/star", status_code=status.HTTP_204_NO_CONTENT)
async def unstar_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a star from a board. Idempotent."""
    await _check_board_access(board_id, current_user, db)

    await db.execute(
        delete(UserBoardStar).where(
            UserBoardStar.user_id == current_user.id,
            UserBoardStar.board_id == board_id,
        )
    )

    await db.execute(
        update(UIBoardOrder)
        .where(UIBoardOrder.user_id == current_user.id)
        .values(
            starred_ids=func.array_remove(UIBoardOrder.starred_ids, board_id),
            updated_at=func.now(),
        )
    )

    await db.commit()
