#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Checklist operations shared by the checklist routes and anything else that
works on a card's checklists: adding a checklist, adding an item, and editing
or ticking an item, each with its access checks — and the notification every
checklist change sends.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.access import get_accessible_board, get_card, get_list
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification, board_recipients
from src.model.board import Board
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.user import User
from src.schemas.checklist import (
    ChecklistCreate,
    ChecklistItemCreate,
    ChecklistItemRead,
    ChecklistItemUpdate,
    ChecklistRead,
)


async def get_checklist(card_id: uuid.UUID, checklist_id: uuid.UUID, db: AsyncSession) -> Checklist:
    """Return the card's checklist with its items, or raise 404."""
    result = await db.execute(
        select(Checklist)
        .options(selectinload(Checklist.items))
        .where(Checklist.id == checklist_id, Checklist.card_id == card_id)
    )
    checklist = result.scalar_one_or_none()
    if checklist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checklist not found")
    return checklist


async def get_item(
    checklist_id: uuid.UUID, item_id: uuid.UUID, db: AsyncSession
) -> ChecklistItem:
    """Return the checklist's item, or raise 404."""
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


async def require_card(
    board_id: uuid.UUID, list_id: uuid.UUID, card_id: uuid.UUID, user: User, db: AsyncSession
) -> Card:
    """Check the user can see the board, and return the card of its list."""
    await get_accessible_board(board_id, user, db)
    await get_list(board_id, list_id, db)
    return await get_card(list_id, card_id, db)


async def notify_card_updated(
    board_id: uuid.UUID, list_id: uuid.UUID, db: AsyncSession, client_id: str | None
) -> None:
    """Tell everyone on the board that a card of the list changed.

    Checklists show on the card's face (the done/total count), so a checklist
    change is a ``card_updated`` of its list: other clients refetch that
    list's cards, as for any other card edit.
    """
    owner_id = (await db.execute(select(Board.owner_id).where(Board.id == board_id))).scalar_one()
    recipients = await board_recipients(board_id, owner_id, db)
    await manager.notify_many(recipients, board_notification("card_updated", board_id, client_id, list_id=list_id))


async def create_checklist(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: ChecklistCreate,
    user: User,
    db: AsyncSession,
    client_id: str | None,
) -> ChecklistRead:
    """Add a checklist to a card, appended after any existing checklists."""
    await require_card(board_id, list_id, card_id, user, db)
    count_result = await db.execute(
        select(func.count()).select_from(Checklist).where(Checklist.card_id == card_id)
    )
    checklist = Checklist(card_id=card_id, name=body.name, position=count_result.scalar_one())
    db.add(checklist)
    await db.commit()
    await notify_card_updated(board_id, list_id, db, client_id)
    checklist = await get_checklist(card_id, checklist.id, db)
    return ChecklistRead.model_validate(checklist)


async def create_checklist_item(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    body: ChecklistItemCreate,
    user: User,
    db: AsyncSession,
    client_id: str | None,
) -> ChecklistItemRead:
    """Add an item to a checklist, appended after any existing items."""
    await require_card(board_id, list_id, card_id, user, db)
    checklist = await get_checklist(card_id, checklist_id, db)
    item = ChecklistItem(
        checklist_id=checklist_id,
        text=body.text,
        is_done=body.is_done,
        position=len(checklist.items),
    )
    db.add(item)
    await db.commit()
    await notify_card_updated(board_id, list_id, db, client_id)
    await db.refresh(item)
    return ChecklistItemRead.model_validate(item)


async def update_checklist_item(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    checklist_id: uuid.UUID,
    item_id: uuid.UUID,
    body: ChecklistItemUpdate,
    user: User,
    db: AsyncSession,
    client_id: str | None,
) -> ChecklistItemRead:
    """Edit an item's text or toggle its done state."""
    await require_card(board_id, list_id, card_id, user, db)
    await get_checklist(card_id, checklist_id, db)
    item = await get_item(checklist_id, item_id, db)
    if body.text is not None:
        item.text = body.text
    if body.is_done is not None:
        item.is_done = body.is_done
    await db.commit()
    await notify_card_updated(board_id, list_id, db, client_id)
    await db.refresh(item)
    return ChecklistItemRead.model_validate(item)
