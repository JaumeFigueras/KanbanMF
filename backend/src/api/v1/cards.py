#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.api.deps import get_client_id, get_current_user, get_db
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification, board_recipients
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.label import Label
from src.model.ui_card_color import UICardColor
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user import User
from src.model.user_avatar import UserAvatar
from src.model.user_preferences import UserPreferences
from src.schemas.card import CardCopyCreate, CardCreate, CardOrderRead, CardOrderUpdate, CardRead, CardUpdate
from src.schemas.checklist import ChecklistRead
from src.schemas.label import LabelRead
from src.schemas.person import PersonRead
from src.schemas.ui_color import ColorRead, ColorUpdate

router = APIRouter()

# Mounted separately (see router.py) at /boards/{board_id}/cards, since it's
# board-scoped rather than list-scoped like `router` above.
archived_router = APIRouter()


def _card_load_options() -> tuple:
    return (
        selectinload(Card.labels),
        selectinload(Card.members),
        selectinload(Card.assignees),
        selectinload(Card.checklists).selectinload(Checklist.items),
    )


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


async def _get_labels(
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


async def _get_users(
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


def _compute_initials(display_name: str) -> str:
    return "".join(w[0].upper() for w in display_name.split() if w)[:3]


async def _people_by_id(
    user_ids: set[uuid.UUID], db: AsyncSession
) -> dict[uuid.UUID, PersonRead]:
    """Batch-resolve user ids to PersonRead summaries (display name, initials,
    whether they have an avatar) for creator/members/assignees."""
    if not user_ids:
        return {}
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users = list(users_result.scalars().all())

    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id.in_(user_ids))
    )
    prefs_by_id = {p.user_id: p for p in prefs_result.scalars()}

    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id.in_(user_ids))
    )
    avatar_ids = set(avatar_result.scalars().all())

    return {
        user.id: PersonRead(
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
    }


def _card_to_read(card: Card, people_by_id: dict[uuid.UUID, PersonRead]) -> CardRead:
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
        creator=people_by_id.get(card.creator_id) if card.creator_id else None,
        members=[people_by_id[u.id] for u in card.members if u.id in people_by_id],
        assignees=[people_by_id[u.id] for u in card.assignees if u.id in people_by_id],
        checklists=[ChecklistRead.model_validate(cl) for cl in card.checklists],
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def _card_people_ids(card: Card) -> set[uuid.UUID]:
    ids = {u.id for u in card.members} | {u.id for u in card.assignees}
    if card.creator_id:
        ids.add(card.creator_id)
    return ids


@archived_router.get("/archived", response_model=list[CardRead])
async def list_archived_cards(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CardRead]:
    """Return every archived (non-deleted) card on the board, whether it was
    archived directly or its whole list was. User must be owner or shared member."""
    await _get_accessible_board(board_id, current_user, db)

    result = await db.execute(
        select(Card)
        .options(*_card_load_options())
        .join(BoardList, BoardList.id == Card.list_id)
        .where(
            BoardList.board_id == board_id,
            Card.is_deleted.is_(False),
            or_(Card.is_archived.is_(True), BoardList.is_archived.is_(True)),
        )
        .order_by(Card.updated_at.desc())
    )
    cards = list(result.scalars().all())

    user_ids: set[uuid.UUID] = set()
    for c in cards:
        user_ids |= _card_people_ids(c)
    people_by_id = await _people_by_id(user_ids, db)

    return [_card_to_read(c, people_by_id) for c in cards]


@router.get("", response_model=list[CardRead])
async def list_cards(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CardRead]:
    """Return all non-archived, non-deleted cards for a list."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    result = await db.execute(
        select(Card)
        .options(*_card_load_options())
        .where(
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
            Card.is_archived.is_(False),
        )
        .order_by(Card.created_at.asc())
    )
    cards = list(result.scalars().all())

    user_ids: set[uuid.UUID] = set()
    for c in cards:
        user_ids |= _card_people_ids(c)
    people_by_id = await _people_by_id(user_ids, db)

    return [_card_to_read(c, people_by_id) for c in cards]


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
    board = await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)

    # The creator is always a member by default, regardless of what the
    # client sent — it can't be left out.
    member_ids = {*body.member_ids, current_user.id}
    members = await _get_users(board_id, list(member_ids), db)
    if current_user not in members:
        members.append(current_user)

    card = Card(
        list_id=list_id,
        creator_id=current_user.id,
        name=body.name,
        description=body.description,
        start_at=body.start_at,
        due_at=body.due_at,
        end_at=body.end_at,
        labels=await _get_labels(board_id, body.label_ids, db),
        members=members,
        assignees=await _get_users(board_id, body.assignee_ids, db),
    )
    db.add(card)
    await db.commit()

    result = await db.execute(
        select(Card).options(*_card_load_options()).where(Card.id == card.id)
    )
    card = result.scalar_one()

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(
        recipients, board_notification("card_created", board_id, client_id, list_id=list_id)
    )

    people_by_id = await _people_by_id(_card_people_ids(card), db)
    return _card_to_read(card, people_by_id)


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
    """
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    source_result = await db.execute(
        select(Card)
        .options(*_card_load_options())
        .where(Card.id == card_id, Card.list_id == list_id, Card.is_deleted.is_(False))
    )
    source = source_result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")

    target_board = await _get_accessible_board(body.target_board_id, current_user, db)
    await _get_list(body.target_board_id, body.target_list_id, db)

    # The copying user is always a member of the copy, same as create_card.
    member_ids = {u.id for u in source.members} | {current_user.id}
    members = await _get_users(body.target_board_id, list(member_ids), db)
    if current_user not in members:
        members.append(current_user)

    new_card = Card(
        list_id=body.target_list_id,
        creator_id=current_user.id,
        name=body.name,
        description=source.description,
        start_at=source.start_at,
        due_at=source.due_at,
        end_at=source.end_at,
        labels=await _get_labels(body.target_board_id, [lbl.id for lbl in source.labels], db),
        members=members,
        assignees=await _get_users(body.target_board_id, [u.id for u in source.assignees], db),
    )
    db.add(new_card)
    await db.flush()  # assigns new_card.id before the checklists below reference it

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
        select(Card).options(*_card_load_options()).where(Card.id == new_card.id)
    )
    new_card = result.scalar_one()

    recipients = await board_recipients(body.target_board_id, target_board.owner_id, db)
    await manager.notify_many(
        recipients,
        board_notification(
            "card_created", body.target_board_id, client_id, list_id=body.target_list_id
        ),
    )

    people_by_id = await _people_by_id(_card_people_ids(new_card), db)
    return _card_to_read(new_card, people_by_id)


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
    """Update a card's name, description, or archived status."""
    board = await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    result = await db.execute(
        select(Card)
        .options(*_card_load_options())
        .where(
            Card.id == card_id,
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")

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
        card.labels = await _get_labels(board_id, body.label_ids or [], db)
    if "member_ids" in fields_set:
        card.members = await _get_users(board_id, body.member_ids or [], db)
    if "assignee_ids" in fields_set:
        card.assignees = await _get_users(board_id, body.assignee_ids or [], db)

    source_list_id = list_id  # the list this card belonged to before this request
    moved_to: uuid.UUID | None = None
    if body.list_id is not None and body.list_id != card.list_id:
        # Moving the card to a different list — validate the destination
        # belongs to the same board before reassigning.
        destination_list = await _get_list(board_id, body.list_id, db)
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

    result = await db.execute(
        select(Card).options(*_card_load_options()).where(Card.id == card.id)
    )
    card = result.scalar_one()

    people_by_id = await _people_by_id(_card_people_ids(card), db)
    return _card_to_read(card, people_by_id)


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
    board = await _get_accessible_board(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this card")
    await _get_list(board_id, list_id, db)
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
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)

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
    board = await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)

    # Validate that every submitted ID is a live (non-deleted) card on this list
    valid_result = await db.execute(
        select(Card.id).where(
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
    )
    valid_ids = set(valid_result.scalars().all())
    for cid in body.card_ids:
        if cid not in valid_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Card {cid} does not belong to this list or has been deleted",
            )

    stmt = pg_insert(UIListCardOrder).values(
        list_id=list_id,
        card_ids=body.card_ids,
    ).on_conflict_do_update(
        index_elements=["list_id"],
        set_={
            "card_ids": body.card_ids,
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)
    await db.commit()

    recipients = await board_recipients(board_id, board.owner_id, db)
    await manager.notify_many(
        recipients, board_notification("card_order_changed", board_id, client_id, list_id=list_id)
    )

    return CardOrderRead(list_id=list_id, card_ids=body.card_ids)


@router.get("/{card_id}/color", response_model=ColorRead)
async def get_card_color(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Return the current user's personal color choice for this card, if any."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
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
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
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
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    await db.execute(
        delete(UICardColor).where(
            UICardColor.user_id == current_user.id,
            UICardColor.card_id == card_id,
        )
    )
    await db.commit()
