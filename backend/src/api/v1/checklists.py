#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.user import User
from src.schemas.checklist import (
    ChecklistCreate,
    ChecklistItemCreate,
    ChecklistItemOrderUpdate,
    ChecklistItemRead,
    ChecklistItemUpdate,
    ChecklistOrderUpdate,
    ChecklistRead,
    ChecklistUpdate,
)

router = APIRouter()


async def _get_accessible_board(
    board_id: uuid.UUID, user: User, db: AsyncSession
) -> Board:
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


async def _get_list(
    board_id: uuid.UUID, list_id: uuid.UUID, db: AsyncSession
) -> BoardList:
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


async def _get_card(list_id: uuid.UUID, card_id: uuid.UUID, db: AsyncSession) -> Card:
    result = await db.execute(
        select(Card).where(
            Card.id == card_id,
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    return card


async def _get_checklist(card_id: uuid.UUID, checklist_id: uuid.UUID, db: AsyncSession) -> Checklist:
    result = await db.execute(
        select(Checklist)
        .options(selectinload(Checklist.items))
        .where(Checklist.id == checklist_id, Checklist.card_id == card_id)
    )
    checklist = result.scalar_one_or_none()
    if checklist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checklist not found")
    return checklist


async def _get_item(
    checklist_id: uuid.UUID, item_id: uuid.UUID, db: AsyncSession
) -> ChecklistItem:
    result = await db.execute(
        select(ChecklistItem).where(
            ChecklistItem.id == item_id,
            ChecklistItem.checklist_id == checklist_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checklist item not found")
    return item


async def _require_card(
    board_id: uuid.UUID, list_id: uuid.UUID, card_id: uuid.UUID, user: User, db: AsyncSession
) -> Card:
    await _get_accessible_board(board_id, user, db)
    await _get_list(board_id, list_id, db)
    return await _get_card(list_id, card_id, db)


@router.get("", response_model=list[ChecklistRead])
async def list_checklists(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChecklistRead]:
    """Return all checklists (with items) for a card, in display order."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    result = await db.execute(
        select(Checklist)
        .options(selectinload(Checklist.items))
        .where(Checklist.card_id == card_id)
        .order_by(Checklist.position)
    )
    return [ChecklistRead.model_validate(c) for c in result.scalars().all()]


@router.post("", response_model=ChecklistRead, status_code=status.HTTP_201_CREATED)
async def create_checklist(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: ChecklistCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChecklistRead:
    """Add a checklist to a card, appended after any existing checklists."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    count_result = await db.execute(
        select(func.count()).select_from(Checklist).where(Checklist.card_id == card_id)
    )
    checklist = Checklist(card_id=card_id, name=body.name, position=count_result.scalar_one())
    db.add(checklist)
    await db.commit()
    checklist = await _get_checklist(card_id, checklist.id, db)
    return ChecklistRead.model_validate(checklist)


@router.put("/order", response_model=list[ChecklistRead])
async def update_checklist_order(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: ChecklistOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChecklistRead]:
    """Reorder a card's checklists — body must list every checklist on the
    card exactly once; position is set to each id's index."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    result = await db.execute(
        select(Checklist).where(Checklist.card_id == card_id)
    )
    checklists = {c.id: c for c in result.scalars().all()}
    if set(body.checklist_ids) != set(checklists.keys()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="checklist_ids must list every checklist on this card exactly once.",
        )
    for position, checklist_id in enumerate(body.checklist_ids):
        checklists[checklist_id].position = position
    await db.commit()

    result = await db.execute(
        select(Checklist)
        .options(selectinload(Checklist.items))
        .where(Checklist.card_id == card_id)
        .order_by(Checklist.position)
    )
    return [ChecklistRead.model_validate(c) for c in result.scalars().all()]


@router.patch("/{checklist_id}", response_model=ChecklistRead)
async def update_checklist(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    body: ChecklistUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChecklistRead:
    """Rename a checklist."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    checklist = await _get_checklist(card_id, checklist_id, db)
    if body.name is not None:
        checklist.name = body.name
    await db.commit()
    checklist = await _get_checklist(card_id, checklist_id, db)
    return ChecklistRead.model_validate(checklist)


@router.delete("/{checklist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a checklist and all of its items."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    checklist = await _get_checklist(card_id, checklist_id, db)
    await db.delete(checklist)
    await db.commit()


@router.post(
    "/{checklist_id}/items",
    response_model=ChecklistItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_checklist_item(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    body: ChecklistItemCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChecklistItemRead:
    """Add an item to a checklist, appended after any existing items."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    checklist = await _get_checklist(card_id, checklist_id, db)
    item = ChecklistItem(
        checklist_id=checklist_id,
        text=body.text,
        is_done=body.is_done,
        position=len(checklist.items),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return ChecklistItemRead.model_validate(item)


@router.put("/{checklist_id}/items/order", response_model=list[ChecklistItemRead])
async def update_checklist_item_order(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    body: ChecklistItemOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChecklistItemRead]:
    """Reorder a checklist's items — body must list every item in the
    checklist exactly once; position is set to each id's index."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    checklist = await _get_checklist(card_id, checklist_id, db)
    items = {i.id: i for i in checklist.items}
    if set(body.item_ids) != set(items.keys()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="item_ids must list every item in this checklist exactly once.",
        )
    for position, item_id in enumerate(body.item_ids):
        items[item_id].position = position
    await db.commit()

    result = await db.execute(
        select(ChecklistItem)
        .where(ChecklistItem.checklist_id == checklist_id)
        .order_by(ChecklistItem.position)
    )
    return [ChecklistItemRead.model_validate(i) for i in result.scalars().all()]


@router.patch("/{checklist_id}/items/{item_id}", response_model=ChecklistItemRead)
async def update_checklist_item(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    item_id: uuid.UUID,
    body: ChecklistItemUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChecklistItemRead:
    """Edit an item's text or toggle its done state."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    await _get_checklist(card_id, checklist_id, db)
    item = await _get_item(checklist_id, item_id, db)
    if body.text is not None:
        item.text = body.text
    if body.is_done is not None:
        item.is_done = body.is_done
    await db.commit()
    await db.refresh(item)
    return ChecklistItemRead.model_validate(item)


@router.delete("/{checklist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist_item(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    item_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove an item from a checklist."""
    await _require_card(board_id, list_id, card_id, current_user, db)
    await _get_checklist(card_id, checklist_id, db)
    item = await _get_item(checklist_id, item_id, db)
    await db.delete(item)
    await db.commit()
