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
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_list_color import UIListColor
from src.model.user import User
from src.schemas.board_list import (
    BoardListCreate,
    BoardListOrderRead,
    BoardListOrderUpdate,
    BoardListRead,
    BoardListUpdate,
)
from src.schemas.ui_color import ColorRead, ColorUpdate

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


async def _get_list(board_id: uuid.UUID, list_id: uuid.UUID, db: AsyncSession) -> BoardList:
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


@router.get("", response_model=list[BoardListRead])
async def list_board_lists(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BoardListRead]:
    """Return all non-archived, non-deleted lists for a board. User must be the owner or a shared member."""
    await _get_accessible_board(board_id, current_user, db)

    result = await db.execute(
        select(BoardList)
        .where(
            BoardList.board_id == board_id,
            BoardList.is_deleted.is_(False),
            BoardList.is_archived.is_(False),
        )
        .order_by(BoardList.created_at.asc())
    )
    lists = result.scalars().all()
    return [BoardListRead.model_validate(lst) for lst in lists]


# NOTE: /archived must be defined before /{list_id} so FastAPI matches the
# literal "archived" segment before trying to parse it as a UUID.

@router.get("/archived", response_model=list[BoardListRead])
async def list_archived_lists(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BoardListRead]:
    """Return archived (but not deleted) lists for a board. User must be the owner or a shared member."""
    await _get_accessible_board(board_id, current_user, db)

    result = await db.execute(
        select(BoardList)
        .where(
            BoardList.board_id == board_id,
            BoardList.is_archived.is_(True),
            BoardList.is_deleted.is_(False),
        )
        .order_by(BoardList.created_at.desc())
    )
    lists = result.scalars().all()
    return [BoardListRead.model_validate(lst) for lst in lists]


@router.post("", response_model=BoardListRead, status_code=status.HTTP_201_CREATED)
async def create_board_list(
    board_id: uuid.UUID,
    body: BoardListCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> BoardListRead:
    """Create a new list on a board and append it to the order. User must be owner or shared member."""
    board = await _get_accessible_board(board_id, current_user, db)

    board_list = BoardList(board_id=board_id, name=body.name)
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

    await db.commit()
    await db.refresh(board_list)

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(recipients, board_notification("list_created", board_id, client_id))

    return BoardListRead.model_validate(board_list)


@router.patch("/{list_id}", response_model=BoardListRead)
async def update_board_list(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    body: BoardListUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> BoardListRead:
    """Update a list's name or archived status. User must be the owner or a shared member."""
    board = await _get_accessible_board(board_id, current_user, db)

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

    events: list[str] = []
    if body.name is not None:
        board_list.name = body.name
        events.append("list_renamed")
    if body.is_archived is not None:
        was_archived = board_list.is_archived
        board_list.is_archived = body.is_archived
        if body.is_archived and not was_archived:
            events.append("list_archived")
            # Remove from order array so the board layout stays clean
            await db.execute(
                update(UIBoardListOrder)
                .where(UIBoardListOrder.board_id == board_id)
                .values(
                    list_ids=func.array_remove(UIBoardListOrder.list_ids, list_id),
                    updated_at=func.now(),
                )
            )
            # A card's own is_archived is never touched by its list's state —
            # "is this card archived" is decided at query time as
            # card.is_archived OR its list's is_archived (see
            # list_archived_cards in cards.py). That way restoring the list
            # can't clobber a card that had already been archived on its own.
        elif not body.is_archived and was_archived:
            events.append("list_unarchived")
            # Restoring: append back to the board's list order.
            await db.execute(
                pg_insert(UIBoardListOrder).values(
                    board_id=board_id,
                    list_ids=[list_id],
                ).on_conflict_do_update(
                    index_elements=["board_id"],
                    set_={
                        "list_ids": func.array_append(UIBoardListOrder.list_ids, list_id),
                        "updated_at": func.now(),
                    },
                )
            )

    await db.commit()
    await db.refresh(board_list)

    if events:
        recipients = await board_recipients(board_id, board.owner_id, db)
        for event in events:
            await manager.notify_many(recipients, board_notification(event, board_id, client_id))

    return BoardListRead.model_validate(board_list)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board_list(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Permanently (soft-)delete a list and its cards. Only the board owner may do this."""
    board = await _get_accessible_board(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this list")

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

    board_list.is_deleted = True
    await db.execute(
        update(Card).where(Card.list_id == list_id, Card.is_deleted.is_(False)).values(is_deleted=True)
    )
    await db.execute(
        update(UIBoardListOrder)
        .where(UIBoardListOrder.board_id == board_id)
        .values(
            list_ids=func.array_remove(UIBoardListOrder.list_ids, list_id),
            updated_at=func.now(),
        )
    )
    await db.commit()

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(recipients, board_notification("list_deleted", board_id, client_id))


@router.get("/order", response_model=BoardListOrderRead)
async def get_list_order(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardListOrderRead:
    """Return the stored column order for a board's lists."""
    await _get_accessible_board(board_id, current_user, db)

    result = await db.execute(
        select(UIBoardListOrder).where(UIBoardListOrder.board_id == board_id)
    )
    order = result.scalar_one_or_none()
    return BoardListOrderRead(
        board_id=board_id,
        list_ids=order.list_ids if order else [],
    )


@router.put("/order", response_model=BoardListOrderRead)
async def update_list_order(
    board_id: uuid.UUID,
    body: BoardListOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> BoardListOrderRead:
    """Replace the column order. User must be the owner or a shared member."""
    board = await _get_accessible_board(board_id, current_user, db)

    # Validate that every submitted ID is a live (non-deleted) list on this board
    valid_result = await db.execute(
        select(BoardList.id).where(
            BoardList.board_id == board_id,
            BoardList.is_deleted.is_(False),
        )
    )
    valid_ids = set(valid_result.scalars().all())
    for lid in body.list_ids:
        if lid not in valid_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"List {lid} does not belong to this board or has been deleted",
            )

    stmt = pg_insert(UIBoardListOrder).values(
        board_id=board_id,
        list_ids=body.list_ids,
    ).on_conflict_do_update(
        index_elements=["board_id"],
        set_={
            "list_ids": body.list_ids,
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)
    await db.commit()

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(recipients, board_notification("list_reordered", board_id, client_id))

    return BoardListOrderRead(board_id=board_id, list_ids=body.list_ids)


@router.get("/{list_id}/color", response_model=ColorRead)
async def get_list_color(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Return the current user's personal color choice for this list, if any."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    result = await db.execute(
        select(UIListColor.color).where(
            UIListColor.user_id == current_user.id,
            UIListColor.list_id == list_id,
        )
    )
    return ColorRead(color=result.scalar_one_or_none())


@router.put("/{list_id}/color", response_model=ColorRead)
async def set_list_color(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    body: ColorUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Set the current user's personal color for this list. Per-user only."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    await db.execute(
        pg_insert(UIListColor)
        .values(user_id=current_user.id, list_id=list_id, color=body.color)
        .on_conflict_do_update(
            index_elements=["user_id", "list_id"],
            set_={"color": body.color, "updated_at": func.now()},
        )
    )
    await db.commit()
    return ColorRead(color=body.color)


@router.delete("/{list_id}/color", status_code=status.HTTP_204_NO_CONTENT)
async def clear_list_color(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Reset the current user's color for this list back to the default. Idempotent."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    await db.execute(
        delete(UIListColor).where(
            UIListColor.user_id == current_user.id,
            UIListColor.list_id == list_id,
        )
    )
    await db.commit()
