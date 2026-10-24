#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Routes for a card's checklists and their items, including their order."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.api.deps import get_client_id, get_current_user, get_db
from src.core import checklists as checklist_service
from src.core.checklists import get_checklist, get_item, notify_card_updated, require_card
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


@router.get("", response_model=list[ChecklistRead])
async def list_checklists(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChecklistRead]:
    """Return all checklists (with items) for a card, in display order."""
    await require_card(board_id, list_id, card_id, current_user, db)
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
    client_id: str | None = Depends(get_client_id),
) -> ChecklistRead:
    """Add a checklist to a card, appended after any existing checklists."""
    return await checklist_service.create_checklist(board_id, list_id, card_id, body, current_user, db, client_id)


@router.put("/order", response_model=list[ChecklistRead])
async def update_checklist_order(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: ChecklistOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> list[ChecklistRead]:
    """Reorder a card's checklists — body must list every checklist on the
    card exactly once; position is set to each id's index."""
    await require_card(board_id, list_id, card_id, current_user, db)
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
    await notify_card_updated(board_id, list_id, db, client_id)

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
    client_id: str | None = Depends(get_client_id),
) -> ChecklistRead:
    """Rename a checklist."""
    await require_card(board_id, list_id, card_id, current_user, db)
    checklist = await get_checklist(card_id, checklist_id, db)
    if body.name is not None:
        checklist.name = body.name
    await db.commit()
    await notify_card_updated(board_id, list_id, db, client_id)
    checklist = await get_checklist(card_id, checklist_id, db)
    return ChecklistRead.model_validate(checklist)


@router.delete("/{checklist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Delete a checklist and all of its items."""
    await require_card(board_id, list_id, card_id, current_user, db)
    checklist = await get_checklist(card_id, checklist_id, db)
    await db.delete(checklist)
    await db.commit()
    await notify_card_updated(board_id, list_id, db, client_id)


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
    client_id: str | None = Depends(get_client_id),
) -> ChecklistItemRead:
    """Add an item to a checklist, appended after any existing items."""
    return await checklist_service.create_checklist_item(
        board_id, list_id, card_id, checklist_id, body, current_user, db, client_id
    )


@router.put("/{checklist_id}/items/order", response_model=list[ChecklistItemRead])
async def update_checklist_item_order(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    body: ChecklistItemOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> list[ChecklistItemRead]:
    """Reorder a checklist's items — body must list every item in the
    checklist exactly once; position is set to each id's index."""
    await require_card(board_id, list_id, card_id, current_user, db)
    checklist = await get_checklist(card_id, checklist_id, db)
    items = {i.id: i for i in checklist.items}
    if set(body.item_ids) != set(items.keys()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="item_ids must list every item in this checklist exactly once.",
        )
    for position, item_id in enumerate(body.item_ids):
        items[item_id].position = position
    await db.commit()
    await notify_card_updated(board_id, list_id, db, client_id)

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
    client_id: str | None = Depends(get_client_id),
) -> ChecklistItemRead:
    """Edit an item's text or toggle its done state."""
    return await checklist_service.update_checklist_item(
        board_id, list_id, card_id, checklist_id, item_id, body, current_user, db, client_id
    )


@router.delete("/{checklist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist_item(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    item_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Remove an item from a checklist."""
    await require_card(board_id, list_id, card_id, current_user, db)
    await get_checklist(card_id, checklist_id, db)
    item = await get_item(checklist_id, item_id, db)
    await db.delete(item)
    await db.commit()
    await notify_card_updated(board_id, list_id, db, client_id)
