#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Card operations shared by the card routes and anything else that works on
cards: reading a list's cards, creating, updating (which also moves and
archives), and setting a list's card order, each with its access checks and
WebSocket notifications — plus the helpers that turn a card into a
``CardRead``.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.access import get_accessible_board, get_card, get_list, reject_if_template
from src.core.card_replacement import board_user_ids, former_people
from src.core.people import people_by_id
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification, board_recipients
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.label import Label
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user import User
from src.schemas.card import CardCreate, CardOrderRead, CardRead, CardUpdate
from src.schemas.checklist import ChecklistRead
from src.schemas.label import LabelRead
from src.schemas.person import PersonRead


def card_load_options() -> tuple:
    """Loader options for everything :func:`card_to_read` reads."""
    return (
        selectinload(Card.labels),
        selectinload(Card.members),
        selectinload(Card.assignees),
        selectinload(Card.checklists).selectinload(Checklist.items),
    )


async def get_labels(
    board_id: uuid.UUID, label_ids: list[uuid.UUID], db: AsyncSession
) -> list[Label]:
    """Resolve label ids to Label rows, scoped to the board so a client can't
    attach labels belonging to a different board."""
    if not label_ids:
        return []
    result = await db.execute(
        select(Label).where(Label.id.in_(label_ids), Label.board_id == board_id)
    )
    return list(result.scalars().all())


async def _get_board_user_ids(board_id: uuid.UUID, db: AsyncSession) -> set[uuid.UUID]:
    """The users allowed to work with the board: its owner plus everyone it's shared with."""
    board_result = await db.execute(select(Board.owner_id).where(Board.id == board_id))
    owner_id = board_result.scalar_one_or_none()
    share_result = await db.execute(
        select(BoardShare.user_id).where(BoardShare.board_id == board_id)
    )
    ids = set(share_result.scalars().all())
    if owner_id:
        ids.add(owner_id)
    return ids


async def get_users(
    board_id: uuid.UUID, user_ids: list[uuid.UUID], db: AsyncSession
) -> list[User]:
    """Resolve user ids to User rows, scoped to users allowed to work with the
    board so a client can't add a member/assignee who isn't on the board."""
    if not user_ids:
        return []
    allowed_ids = await _get_board_user_ids(board_id, db)
    scoped_ids = [uid for uid in user_ids if uid in allowed_ids]
    if not scoped_ids:
        return []
    result = await db.execute(select(User).where(User.id.in_(scoped_ids)))
    return list(result.scalars().all())


def card_to_read(card: Card, people: dict[uuid.UUID, PersonRead]) -> CardRead:
    """Build a CardRead; ``card`` must come with :func:`card_load_options`
    loaded and ``people`` must hold everyone :func:`card_people_ids` names."""
    return CardRead(
        id=card.id,
        list_id=card.list_id,
        name=card.name,
        description=card.description,
        is_archived=card.is_archived,
        is_deleted=card.is_deleted,
        start_at=card.start_at,
        due_at=card.due_at,
        end_at=card.end_at,
        labels=[LabelRead.model_validate(lbl) for lbl in card.labels],
        creator=people.get(card.creator_id) if card.creator_id else None,
        members=[people[u.id] for u in card.members if u.id in people],
        assignees=[people[u.id] for u in card.assignees if u.id in people],
        checklists=[ChecklistRead.model_validate(cl) for cl in card.checklists],
        replaced_by_id=card.replaced_by_id,
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def card_people_ids(card: Card) -> set[uuid.UUID]:
    """The creator, members and assignees of a card."""
    ids = {u.id for u in card.members} | {u.id for u in card.assignees}
    if card.creator_id:
        ids.add(card.creator_id)
    return ids


async def cards_to_read(cards: list[Card], db: AsyncSession) -> list[CardRead]:
    """Build the CardRead of each card, resolving their people in one batch."""
    user_ids: set[uuid.UUID] = set()
    for c in cards:
        user_ids |= card_people_ids(c)
    people = await people_by_id(user_ids, db)
    return [card_to_read(c, people) for c in cards]


async def read_card(card_id: uuid.UUID, db: AsyncSession) -> CardRead:
    """Reload a card with everything it shows and build its CardRead."""
    result = await db.execute(
        select(Card).options(*card_load_options()).where(Card.id == card_id)
    )
    return (await cards_to_read([result.scalar_one()], db))[0]


async def list_cards(
    board_id: uuid.UUID, list_id: uuid.UUID, user: User, db: AsyncSession
) -> list[CardRead]:
    """Return all non-archived, non-deleted cards for a list, oldest first."""
    await get_accessible_board(board_id, user, db)
    await get_list(board_id, list_id, db)
    result = await db.execute(
        select(Card)
        .options(*card_load_options())
        .where(
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
            Card.is_archived.is_(False),
        )
        .order_by(Card.created_at.asc())
    )
    return await cards_to_read(list(result.scalars().all()), db)


async def create_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    body: CardCreate,
    user: User,
    db: AsyncSession,
    client_id: str | None,
) -> CardRead:
    """Create a card inside a list, with ``user`` as its creator."""
    board = await get_accessible_board(board_id, user, db)
    reject_if_template(board, "Templates cannot hold cards")
    await get_list(board_id, list_id, db)

    # The creator is always a member by default, regardless of what the
    # client sent — it can't be left out.
    member_ids = {*body.member_ids, user.id}
    members = await get_users(board_id, list(member_ids), db)
    if user not in members:
        members.append(user)

    card = Card(
        list_id=list_id,
        creator_id=user.id,
        name=body.name,
        description=body.description,
        start_at=body.start_at,
        due_at=body.due_at,
        end_at=body.end_at,
        labels=await get_labels(board_id, body.label_ids, db),
        members=members,
        assignees=await get_users(board_id, body.assignee_ids, db),
    )
    db.add(card)
    await db.commit()
    card_read = await read_card(card.id, db)

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(
        recipients, board_notification("card_created", board_id, client_id, list_id=list_id)
    )

    return card_read


async def check_restorable(card: Card, board: Board, db: AsyncSession) -> None:
    """Refuse to restore an archived card that was replaced, or that holds
    people who no longer have access to the board.

    Both answer 409 with a ``code`` the frontend explains: ``card_replaced``
    carries the replacement (when it's still on the board, so it can be
    opened), ``former_people`` the names of the people who left. The second
    can still be copied: the copy leaves those people out.
    """
    if card.replaced_by_id is not None:
        replacement_result = await db.execute(
            select(Card.list_id).where(
                Card.id == card.replaced_by_id,
                Card.is_archived.is_(False),
                Card.is_deleted.is_(False),
            )
        )
        replacement_list_id = replacement_result.scalar_one_or_none()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "card_replaced",
                "replaced_by_id": str(card.replaced_by_id) if replacement_list_id else None,
                "replaced_by_list_id": str(replacement_list_id) if replacement_list_id else None,
            },
        )

    gone = former_people(card, await board_user_ids(board, db))
    if gone:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "former_people", "names": [u.display_name for u in gone]},
        )


async def update_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: CardUpdate,
    user: User,
    db: AsyncSession,
    client_id: str | None,
) -> CardRead:
    """Update a card's fields, move it to another list of the board, or
    archive/restore it.

    Only the fields set in ``body`` change; a field explicitly set to ``None``
    clears it.
    """
    board = await get_accessible_board(board_id, user, db)
    await get_list(board_id, list_id, db)
    card = await get_card(list_id, card_id, db, card_load_options())

    # A field explicitly sent as `null` clears it; an omitted field leaves it
    # untouched — `is not None` alone can't tell those two cases apart.
    fields_set = body.model_fields_set
    effective_start_at = body.start_at if "start_at" in fields_set else card.start_at
    effective_end_at = body.end_at if "end_at" in fields_set else card.end_at
    if (
        effective_start_at is not None
        and effective_end_at is not None
        and effective_start_at > effective_end_at
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Start date cannot be after end date.",
        )

    if body.is_archived is False and card.is_archived:
        await check_restorable(card, board, db)

    if body.name is not None:
        card.name = body.name
    if body.description is not None:
        card.description = body.description
    if body.is_archived is not None:
        card.is_archived = body.is_archived
    if "start_at" in fields_set:
        card.start_at = body.start_at
    if "due_at" in fields_set:
        card.due_at = body.due_at
    if "end_at" in fields_set:
        card.end_at = body.end_at
    if "label_ids" in fields_set:
        card.labels = await get_labels(board_id, body.label_ids or [], db)
    if "member_ids" in fields_set:
        card.members = await get_users(board_id, body.member_ids or [], db)
    if "assignee_ids" in fields_set:
        card.assignees = await get_users(board_id, body.assignee_ids or [], db)

    source_list_id = list_id  # the list this card belonged to before this request
    moved_to: uuid.UUID | None = None
    if body.list_id is not None and body.list_id != card.list_id:
        # Moving the card to a different list — validate the destination
        # belongs to the same board before reassigning.
        destination_list = await get_list(board_id, body.list_id, db)
        card.list_id = destination_list.id
        moved_to = destination_list.id

    # Field groups notify separately: a plain field edit only touches the
    # card's own list, a move touches both the source and destination list,
    # and archiving is its own event (mirrors the notify types list events use).
    events: list[str] = []
    update_fields = {"name", "description", "start_at", "due_at", "end_at", "label_ids", "member_ids", "assignee_ids"}
    if update_fields & fields_set:
        events.append("card_updated")
    if moved_to is not None:
        events.append("card_moved")
    if body.is_archived is True:
        events.append("card_archived")
    elif body.is_archived is False:
        events.append("card_unarchived")

    await db.commit()

    if events:
        recipients = await board_recipients(board_id, board.owner_id, db)
        notify_list_ids = {card.list_id, source_list_id} if moved_to is not None else {card.list_id}
        for event in events:
            for lid in notify_list_ids:
                await manager.notify_many(recipients, board_notification(event, board_id, client_id, list_id=lid))

    return await read_card(card.id, db)


async def set_card_order(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_ids: list[uuid.UUID],
    user: User,
    db: AsyncSession,
    client_id: str | None,
) -> CardOrderRead:
    """Replace the custom card order for a list. User must be the owner or a shared member."""
    board = await get_accessible_board(board_id, user, db)
    await get_list(board_id, list_id, db)

    # Validate that every submitted ID is a live (non-deleted) card on this list
    valid_result = await db.execute(
        select(Card.id).where(
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
    )
    valid_ids = set(valid_result.scalars().all())
    for cid in card_ids:
        if cid not in valid_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Card {cid} does not belong to this list or has been deleted",
            )

    stmt = pg_insert(UIListCardOrder).values(
        list_id=list_id,
        card_ids=card_ids,
    ).on_conflict_do_update(
        index_elements=["list_id"],
        set_={
            "card_ids": card_ids,
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)
    await db.commit()

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(
        recipients, board_notification("card_order_changed", board_id, client_id, list_id=list_id)
    )

    return CardOrderRead(list_id=list_id, card_ids=card_ids)
