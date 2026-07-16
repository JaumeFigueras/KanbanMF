#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_client_id, get_current_user, get_db
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification, board_recipients
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.ui_board_color import UIBoardColor
from src.model.ui_board_order import UIBoardOrder
from src.model.ui_card_color import UICardColor
from src.model.ui_list_color import UIListColor
from src.model.user import User
from src.model.user_avatar import UserAvatar
from src.model.user_board_star import UserBoardStar
from src.model.user_preferences import UserPreferences
from src.schemas.board import (
    BoardCreate,
    BoardOrderRead,
    BoardOrderUpdate,
    BoardRead,
    BoardShareCreate,
    BoardUpdate,
    BoardsResponse,
)
from src.schemas.person import PersonRead
from src.schemas.ui_color import BoardColorsRead, ColorRead, ColorUpdate

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
    client_id: str | None = Depends(get_client_id),
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

    # Board order is per-user (not shared), so only the owner's other
    # sessions need to know — never the users a board is shared with.
    await manager.notify(current_user.id, board_notification("board_reordered", None, client_id))

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
    client_id: str | None = Depends(get_client_id),
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

    # Deletion only concerns the owner: a single account can have several
    # open sessions (e.g. laptop + a meeting room computer), and all of them
    # need to drop the board even though only one of them triggered this.
    await manager.notify(current_user.id, board_notification("board_deleted", board_id, client_id))


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


@router.post("/{board_id}/shares", response_model=PersonRead, status_code=status.HTTP_201_CREATED)
async def create_board_share(
    board_id: uuid.UUID,
    body: BoardShareCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> PersonRead:
    """Share the board with another user. Only the board owner may do this."""
    board = await _check_board_access(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can share this board")

    if body.user_id == board.owner_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The owner already has access to this board",
        )

    target_result = await db.execute(select(User).where(User.id == body.user_id))
    target_user = target_result.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    existing_result = await db.execute(
        select(BoardShare).where(
            BoardShare.board_id == board_id,
            BoardShare.user_id == body.user_id,
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Board is already shared with this user")

    db.add(BoardShare(board_id=board_id, user_id=body.user_id))
    await db.commit()

    await manager.notify_many(
        {current_user.id, target_user.id},
        board_notification("board_shared", board_id, client_id),
    )

    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == target_user.id)
    )
    prefs = prefs_result.scalar_one_or_none()
    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == target_user.id)
    )
    has_avatar = avatar_result.scalar_one_or_none() is not None

    return PersonRead(
        id=target_user.id,
        display_name=target_user.display_name,
        initials=(
            prefs.initials if prefs and prefs.initials else _compute_initials(target_user.display_name)
        ),
        has_avatar=has_avatar,
    )


@router.delete("/{board_id}/shares/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board_share(
    board_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Revoke a user's shared access to the board. Only the board owner may do this."""
    board = await _check_board_access(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can modify sharing")

    result = await db.execute(
        select(BoardShare).where(
            BoardShare.board_id == board_id,
            BoardShare.user_id == user_id,
        )
    )
    share = result.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board is not shared with this user")

    await db.delete(share)
    await db.commit()

    await manager.notify_many(
        {current_user.id, user_id},
        board_notification("board_unshared", board_id, client_id),
    )


@router.patch("/{board_id}", response_model=BoardRead)
async def update_board(
    board_id: uuid.UUID,
    body: BoardUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
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

    archive_event: str | None = None
    if body.is_archived is not None:
        was_archived = board.is_archived
        board.is_archived = body.is_archived

        if body.is_archived and not was_archived:
            archive_event = "board_archived"
            # Archiving: remove from all order arrays
            await _remove_from_order(current_user.id, board_id, db)
        elif not body.is_archived and was_archived:
            archive_event = "board_unarchived"
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

    if archive_event is not None:
        # Archiving/restoring also hides/reveals the board in shared members'
        # lists (list_boards filters on is_archived), so they need to know too.
        recipients = await board_recipients(board_id, current_user.id, db)
        await manager.notify_many(recipients, board_notification(archive_event, board_id, client_id))

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


@router.get("/{board_id}/colors", response_model=BoardColorsRead)
async def get_board_colors(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardColorsRead:
    """Return every color the current user has personally set on this board
    (the board itself, its lists, and their cards) in one shot, so the
    frontend can render the whole board with its final colors from the
    first paint instead of one request per list/card.
    """
    await _check_board_access(board_id, current_user, db)

    board_color_result = await db.execute(
        select(UIBoardColor.color).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id == board_id,
        )
    )
    board_color = board_color_result.scalar_one_or_none()

    lists_result = await db.execute(
        select(UIListColor.list_id, UIListColor.color)
        .join(BoardList, BoardList.id == UIListColor.list_id)
        .where(BoardList.board_id == board_id, UIListColor.user_id == current_user.id)
    )
    list_colors = {str(list_id): color for list_id, color in lists_result.all()}

    cards_result = await db.execute(
        select(UICardColor.card_id, UICardColor.color)
        .join(Card, Card.id == UICardColor.card_id)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(BoardList.board_id == board_id, UICardColor.user_id == current_user.id)
    )
    card_colors = {str(card_id): color for card_id, color in cards_result.all()}

    return BoardColorsRead(board=board_color, lists=list_colors, cards=card_colors)


@router.get("/{board_id}/color", response_model=ColorRead)
async def get_board_color(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Return the current user's personal color choice for this board, if any."""
    await _check_board_access(board_id, current_user, db)
    result = await db.execute(
        select(UIBoardColor.color).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id == board_id,
        )
    )
    return ColorRead(color=result.scalar_one_or_none())


@router.put("/{board_id}/color", response_model=ColorRead)
async def set_board_color(
    board_id: uuid.UUID,
    body: ColorUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Set the current user's personal color for this board.

    Purely a per-user display preference — the owner and every shared user
    each have their own, so this never affects what anyone else sees.
    """
    await _check_board_access(board_id, current_user, db)
    await db.execute(
        pg_insert(UIBoardColor)
        .values(user_id=current_user.id, board_id=board_id, color=body.color)
        .on_conflict_do_update(
            index_elements=["user_id", "board_id"],
            set_={"color": body.color, "updated_at": func.now()},
        )
    )
    await db.commit()
    return ColorRead(color=body.color)


@router.delete("/{board_id}/color", status_code=status.HTTP_204_NO_CONTENT)
async def clear_board_color(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Reset the current user's color for this board back to the default. Idempotent."""
    await _check_board_access(board_id, current_user, db)
    await db.execute(
        delete(UIBoardColor).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id == board_id,
        )
    )
    await db.commit()
