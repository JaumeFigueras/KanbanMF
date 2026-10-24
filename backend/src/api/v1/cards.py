#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Routes for cards: create, read, update, move between lists, copy, archive,
delete, per-user colour and per-user order within a list.

``archived_router`` serves a board's archived cards, which are not nested
under a list in the URL.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_client_id, get_current_user, get_db
from src.core import cards as card_service
from src.core.access import get_accessible_board, get_list, reject_if_template
from src.core.cards import card_load_options, cards_to_read, get_labels, get_users
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification, board_recipients
from src.model.board_list import BoardList
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.ui_card_color import UICardColor
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user import User
from src.schemas.card import CardCopyCreate, CardCreate, CardOrderRead, CardOrderUpdate, CardRead, CardUpdate
from src.schemas.ui_color import ColorRead, ColorUpdate

router = APIRouter()

# Mounted separately (see router.py) at /boards/{board_id}/cards, since it's
# board-scoped rather than list-scoped like `router` above.
archived_router = APIRouter()


@archived_router.get("/archived", response_model=list[CardRead])
async def list_archived_cards(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CardRead]:
    """Return every archived (non-deleted) card on the board, whether it was
    archived directly or its whole list was. User must be owner or shared member."""
    await get_accessible_board(board_id, current_user, db)

    result = await db.execute(
        select(Card)
        .options(*card_load_options())
        .join(BoardList, BoardList.id == Card.list_id)
        .where(
            BoardList.board_id == board_id,
            Card.is_deleted.is_(False),
            or_(Card.is_archived.is_(True), BoardList.is_archived.is_(True)),
        )
        .order_by(Card.updated_at.desc())
    )
    return await cards_to_read(list(result.scalars().all()), db)


@router.get("", response_model=list[CardRead])
async def list_cards(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CardRead]:
    """Return all non-archived, non-deleted cards for a list."""
    return await card_service.list_cards(board_id, list_id, current_user, db)


@router.post("", response_model=CardRead, status_code=status.HTTP_201_CREATED)
async def create_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    body: CardCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> CardRead:
    """Create a card inside a list."""
    return await card_service.create_card(board_id, list_id, body, current_user, db, client_id)


@router.post("/{card_id}/copy", response_model=CardRead, status_code=status.HTTP_201_CREATED)
async def copy_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: CardCopyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> CardRead:
    """Duplicate a card into a board/list the user has access to (owner or
    shared member of the target board) — may be the same list, a different
    list on the same board, or a list on an entirely different board.

    Labels/members/assignees are re-scoped to the target board the same way
    create_card scopes client-submitted ids, so anything that doesn't belong
    there (e.g. a label from the source board when copying cross-board) is
    silently dropped rather than erroring. Checklists have no bulk-copy
    endpoint of their own, so they're duplicated item by item.

    `include_description` and `include_checklists` both default to True, so
    the plain copy action is unaffected. The frontend clears both when
    extracting a checklist item into its own card: that wants the source
    card's labels, dates, people and color, but starts with an empty
    description and no checklists of its own.
    """
    await get_accessible_board(board_id, current_user, db)
    await get_list(board_id, list_id, db)
    source_result = await db.execute(
        select(Card)
        .options(*card_load_options())
        .where(Card.id == card_id, Card.list_id == list_id, Card.is_deleted.is_(False))
    )
    source = source_result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")

    target_board = await get_accessible_board(body.target_board_id, current_user, db)
    reject_if_template(target_board, "Templates cannot hold cards")
    await get_list(body.target_board_id, body.target_list_id, db)

    # The copying user is always a member of the copy, same as create_card.
    member_ids = {u.id for u in source.members} | {current_user.id}
    members = await get_users(body.target_board_id, list(member_ids), db)
    if current_user not in members:
        members.append(current_user)

    new_card = Card(
        list_id=body.target_list_id,
        creator_id=current_user.id,
        name=body.name,
        description=source.description if body.include_description else None,
        start_at=source.start_at,
        due_at=source.due_at,
        end_at=source.end_at,
        labels=await get_labels(body.target_board_id, [lbl.id for lbl in source.labels], db),
        members=members,
        assignees=await get_users(body.target_board_id, [u.id for u in source.assignees], db),
    )
    db.add(new_card)
    await db.flush()  # assigns new_card.id before the checklists below reference it

    source_color_result = await db.execute(
        select(UICardColor.color).where(
            UICardColor.user_id == current_user.id,
            UICardColor.card_id == card_id,
        )
    )
    source_color = source_color_result.scalar_one_or_none()
    if source_color is not None:
        db.add(UICardColor(user_id=current_user.id, card_id=new_card.id, color=source_color))

    if body.include_checklists:
        for checklist in source.checklists:
            new_checklist = Checklist(card_id=new_card.id, name=checklist.name, position=checklist.position)
            db.add(new_checklist)
            await db.flush()  # assigns new_checklist.id before its items reference it
            for item in checklist.items:
                db.add(ChecklistItem(
                    checklist_id=new_checklist.id,
                    text=item.text,
                    is_done=item.is_done,
                    position=item.position,
                ))

    await db.commit()

    result = await db.execute(
        select(Card).options(*card_load_options()).where(Card.id == new_card.id)
    )
    new_card = result.scalar_one()

    recipients = await board_recipients(body.target_board_id, target_board.owner_id, db)
    await manager.notify_many(
        recipients,
        board_notification(
            "card_created", body.target_board_id, client_id, list_id=body.target_list_id
        ),
    )

    return (await cards_to_read([new_card], db))[0]


@router.patch("/{card_id}", response_model=CardRead)
async def update_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: CardUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> CardRead:
    """Update a card's fields, move it to another list of the board, or
    archive/restore it."""
    return await card_service.update_card(board_id, list_id, card_id, body, current_user, db, client_id)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Soft-delete a card by setting is_deleted=True. Only the board owner may do this."""
    board = await get_accessible_board(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this card")
    await get_list(board_id, list_id, db)
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
    card.is_deleted = True
    await db.commit()

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(
        recipients, board_notification("card_deleted", board_id, client_id, list_id=list_id)
    )


@router.get("/order", response_model=CardOrderRead)
async def get_card_order(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CardOrderRead:
    """Return the stored custom card order for a list."""
    await get_accessible_board(board_id, current_user, db)
    await get_list(board_id, list_id, db)

    result = await db.execute(
        select(UIListCardOrder).where(UIListCardOrder.list_id == list_id)
    )
    order = result.scalar_one_or_none()
    return CardOrderRead(
        list_id=list_id,
        card_ids=order.card_ids if order else [],
    )


@router.put("/order", response_model=CardOrderRead)
async def update_card_order(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    body: CardOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> CardOrderRead:
    """Replace the custom card order for a list. User must be the owner or a shared member."""
    return await card_service.set_card_order(board_id, list_id, body.card_ids, current_user, db, client_id)


@router.get("/{card_id}/color", response_model=ColorRead)
async def get_card_color(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Return the current user's personal color choice for this card, if any."""
    await get_accessible_board(board_id, current_user, db)
    await get_list(board_id, list_id, db)
    result = await db.execute(
        select(UICardColor.color).where(
            UICardColor.user_id == current_user.id,
            UICardColor.card_id == card_id,
        )
    )
    return ColorRead(color=result.scalar_one_or_none())


@router.put("/{card_id}/color", response_model=ColorRead)
async def set_card_color(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: ColorUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Set the current user's personal color for this card. Per-user only."""
    await get_accessible_board(board_id, current_user, db)
    await get_list(board_id, list_id, db)
    await db.execute(
        pg_insert(UICardColor)
        .values(user_id=current_user.id, card_id=card_id, color=body.color)
        .on_conflict_do_update(
            index_elements=["user_id", "card_id"],
            set_={"color": body.color, "updated_at": func.now()},
        )
    )
    await db.commit()
    return ColorRead(color=body.color)


@router.delete("/{card_id}/color", status_code=status.HTTP_204_NO_CONTENT)
async def clear_card_color(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Reset the current user's color for this card back to the default. Idempotent."""
    await get_accessible_board(board_id, current_user, db)
    await get_list(board_id, list_id, db)
    await db.execute(
        delete(UICardColor).where(
            UICardColor.user_id == current_user.id,
            UICardColor.card_id == card_id,
        )
    )
    await db.commit()
