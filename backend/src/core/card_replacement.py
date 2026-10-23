#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Replacing cards whose members or assignees lost access to the board.

When the owner removes someone from a shared board, every live card that
person is a member or assignee of is archived, to keep it as it was, and a
copy takes its place without them. The same happens to the cards of an
archived list when it is restored, since the list may hold people who left
the board while it was archived.
"""

import uuid

from sqlalchemy import exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.card_assignee import CardAssignee
from src.model.card_member import CardMember
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.ui_card_color import UICardColor
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user import User


def _load_options() -> tuple:
    return (
        selectinload(Card.labels),
        selectinload(Card.members),
        selectinload(Card.assignees),
        selectinload(Card.checklists).selectinload(Checklist.items),
    )


def _involves(user_id: uuid.UUID):
    """SQL condition: the user is a member or an assignee of the card."""
    return or_(
        exists().where(CardMember.card_id == Card.id, CardMember.user_id == user_id),
        exists().where(CardAssignee.card_id == Card.id, CardAssignee.user_id == user_id),
    )


def _live_cards_of(board_id: uuid.UUID, user_id: uuid.UUID):
    """The cards on the board's active lists that the user is on.

    Cards on an archived list are left alone: they are dealt with if the
    list is ever restored (see :func:`replace_cards_with_former_people`).
    """
    return (
        select(Card)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(
            BoardList.board_id == board_id,
            BoardList.is_archived.is_(False),
            BoardList.is_deleted.is_(False),
            Card.is_archived.is_(False),
            Card.is_deleted.is_(False),
            _involves(user_id),
        )
    )


async def board_user_ids(board: Board, db: AsyncSession) -> set[uuid.UUID]:
    """The users with access to the board: its owner and everyone it's shared with."""
    result = await db.execute(select(BoardShare.user_id).where(BoardShare.board_id == board.id))
    return {board.owner_id, *result.scalars().all()}


def former_people(card: Card, allowed_ids: set[uuid.UUID]) -> list[User]:
    """The card's members and assignees who no longer have access to the board."""
    gone: dict[uuid.UUID, User] = {}
    for user in [*card.members, *card.assignees]:
        if user.id not in allowed_ids:
            gone[user.id] = user
    return sorted(gone.values(), key=lambda u: u.display_name.lower())


async def count_cards_of(board_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> int:
    """How many cards :func:`replace_cards_of` would replace."""
    result = await db.execute(
        select(func.count()).select_from(_live_cards_of(board_id, user_id).subquery())
    )
    return result.scalar_one()


async def _replace_card(
    card: Card, gone_ids: set[uuid.UUID], substitute: User, db: AsyncSession
) -> Card:
    """Archive the card and put a copy without the people in ``gone_ids`` in its place.

    The substitute takes their place as member or assignee, and becomes the
    copy's creator. Everything else is copied: dates, labels, checklists,
    every remaining person's colour and the card's position in its list. The
    send-log of due-date reminders is not, so the copy is a new card to the
    reminder job too.
    """

    def people(users: list[User]) -> list[User]:
        kept = [u for u in users if u.id not in gone_ids]
        if len(kept) < len(users) and all(u.id != substitute.id for u in kept):
            kept.append(substitute)
        return kept

    new_card = Card(
        list_id=card.list_id,
        creator_id=substitute.id,
        name=card.name,
        description=card.description,
        start_at=card.start_at,
        due_at=card.due_at,
        end_at=card.end_at,
        labels=list(card.labels),
        members=people(card.members),
        assignees=people(card.assignees),
    )
    db.add(new_card)
    await db.flush()  # assigns new_card.id before the rows below reference it

    for checklist in card.checklists:
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

    colors_result = await db.execute(select(UICardColor).where(UICardColor.card_id == card.id))
    for color in colors_result.scalars():
        if color.user_id not in gone_ids:
            db.add(UICardColor(user_id=color.user_id, card_id=new_card.id, color=color.color))

    await db.execute(
        update(UIListCardOrder)
        .where(UIListCardOrder.list_id == card.list_id)
        .values(
            card_ids=func.array_replace(UIListCardOrder.card_ids, card.id, new_card.id),
            updated_at=func.now(),
        )
    )

    card.is_archived = True
    card.replaced_by_id = new_card.id
    return new_card


async def replace_cards_of(
    board_id: uuid.UUID, removed_id: uuid.UUID, substitute: User, db: AsyncSession
) -> set[uuid.UUID]:
    """Replace every live card the removed user is on. Doesn't commit.

    Returns the ids of the lists whose cards changed.
    """
    result = await db.execute(_live_cards_of(board_id, removed_id).options(*_load_options()))
    list_ids: set[uuid.UUID] = set()
    for card in result.scalars().all():
        await _replace_card(card, {removed_id}, substitute, db)
        list_ids.add(card.list_id)
    return list_ids


async def replace_cards_with_former_people(
    board: Board, list_id: uuid.UUID, substitute: User, db: AsyncSession
) -> int:
    """Replace the list's cards that hold people who left the board. Doesn't commit.

    Used when an archived list is restored. Returns how many were replaced.
    """
    allowed_ids = await board_user_ids(board, db)
    result = await db.execute(
        select(Card)
        .options(*_load_options())
        .where(
            Card.list_id == list_id,
            Card.is_archived.is_(False),
            Card.is_deleted.is_(False),
        )
    )
    replaced = 0
    for card in result.scalars().all():
        gone = former_people(card, allowed_ids)
        if gone:
            await _replace_card(card, {u.id for u in gone}, substitute, db)
            replaced += 1
    return replaced
