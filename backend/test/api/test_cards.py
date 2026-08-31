#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the /api/v1/boards/{board}/lists/{list}/cards copy endpoint."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.model.board import Board
from src.model.board_list import BoardList
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.label import Label
from src.model.ui_card_color import UICardColor
from src.model.user import User


@pytest_asyncio.fixture
async def source_card(db_session_async, test_user: User) -> Card:
    """A fully populated card to copy from: description, all three dates, a
    label, a member, an assignee, a per-user color and one checklist with two
    items — everything `copy_card` can carry across."""
    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add(board)
    await db_session_async.flush()

    board_list = BoardList(board_id=board.id, name="List")
    label = Label(board_id=board.id, name="Label", color="#ff0000", position=0)
    db_session_async.add_all([board_list, label])
    await db_session_async.flush()

    now = datetime.now(timezone.utc)
    card = Card(
        list_id=board_list.id,
        creator_id=test_user.id,
        name="Source",
        description="Source description",
        start_at=now,
        due_at=now + timedelta(days=1),
        end_at=now + timedelta(days=2),
        labels=[label],
        members=[test_user],
        assignees=[test_user],
    )
    db_session_async.add(card)
    await db_session_async.flush()

    checklist = Checklist(card_id=card.id, name="Checklist", position=0)
    db_session_async.add(checklist)
    await db_session_async.flush()
    db_session_async.add_all([
        ChecklistItem(checklist_id=checklist.id, text="First", is_done=False, position=0),
        ChecklistItem(checklist_id=checklist.id, text="Second", is_done=True, position=1),
    ])
    db_session_async.add(UICardColor(user_id=test_user.id, card_id=card.id, color="#00ff00"))

    await db_session_async.commit()
    await db_session_async.refresh(card)
    return card


async def _fetch_checklists(db_session_async, card_id: uuid.UUID) -> list[Checklist]:
    result = await db_session_async.execute(
        select(Checklist)
        .options(selectinload(Checklist.items))
        .where(Checklist.card_id == card_id)
    )
    return list(result.scalars().all())


@pytest.mark.asyncio
async def test_cards_01(
    client, db_session_async, source_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify POST .../copy carries the whole card across by default — the
    description and the checklists included — when neither include flag is
    sent.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to read back the copy.
    source_card : Card
        The fully populated card being copied.
    auth_headers : dict[str, str]
        Authorization header for the card's owner.

    Raises
    ------
    AssertionError
        If the copy is missing the description, the checklists, or any of the
        labels/dates/people/color the source card carried.
    """
    board_list = await db_session_async.get(BoardList, source_card.list_id)

    response = await client.post(
        f"/api/v1/boards/{board_list.board_id}/lists/{board_list.id}"
        f"/cards/{source_card.id}/copy",
        headers=auth_headers,
        json={
            "name": "Full copy",
            "target_board_id": str(board_list.board_id),
            "target_list_id": str(board_list.id),
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Full copy"
    assert body["description"] == "Source description"
    assert body["start_at"] is not None
    assert body["due_at"] is not None
    assert body["end_at"] is not None
    assert len(body["labels"]) == 1
    assert len(body["members"]) == 1
    assert len(body["assignees"]) == 1

    checklists = await _fetch_checklists(db_session_async, uuid.UUID(body["id"]))
    assert len(checklists) == 1
    assert {item.text for item in checklists[0].items} == {"First", "Second"}

    color = await db_session_async.execute(
        select(UICardColor.color).where(UICardColor.card_id == uuid.UUID(body["id"]))
    )
    assert color.scalar_one_or_none() == "#00ff00"


@pytest.mark.asyncio
async def test_cards_02(
    client, db_session_async, source_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify POST .../copy with include_description and include_checklists both
    false produces the card the "extract a checklist item" action wants: the
    source card's labels, dates, people and color, but an empty description
    and no checklists of its own.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to read back the copy.
    source_card : Card
        The fully populated card being copied.
    auth_headers : dict[str, str]
        Authorization header for the card's owner.

    Raises
    ------
    AssertionError
        If the new card keeps the description or the checklists, or if it
        drops any of the labels/dates/people/color it should have inherited.
    """
    board_list = await db_session_async.get(BoardList, source_card.list_id)

    response = await client.post(
        f"/api/v1/boards/{board_list.board_id}/lists/{board_list.id}"
        f"/cards/{source_card.id}/copy",
        headers=auth_headers,
        json={
            "name": "First",
            "target_board_id": str(board_list.board_id),
            "target_list_id": str(board_list.id),
            "include_description": False,
            "include_checklists": False,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "First"
    assert body["description"] is None

    # Everything else still comes across.
    assert body["start_at"] is not None
    assert body["due_at"] is not None
    assert body["end_at"] is not None
    assert len(body["labels"]) == 1
    assert len(body["members"]) == 1
    assert len(body["assignees"]) == 1

    assert await _fetch_checklists(db_session_async, uuid.UUID(body["id"])) == []

    color = await db_session_async.execute(
        select(UICardColor.color).where(UICardColor.card_id == uuid.UUID(body["id"]))
    )
    assert color.scalar_one_or_none() == "#00ff00"


@pytest.mark.asyncio
async def test_cards_03(
    client, db_session_async, source_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify an extract-style copy leaves the source card untouched — its own
    description and checklist survive intact.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to re-read the source.
    source_card : Card
        The fully populated card being copied.
    auth_headers : dict[str, str]
        Authorization header for the card's owner.

    Raises
    ------
    AssertionError
        If the source card lost its description or its checklist items.
    """
    board_list = await db_session_async.get(BoardList, source_card.list_id)

    response = await client.post(
        f"/api/v1/boards/{board_list.board_id}/lists/{board_list.id}"
        f"/cards/{source_card.id}/copy",
        headers=auth_headers,
        json={
            "name": "First",
            "target_board_id": str(board_list.board_id),
            "target_list_id": str(board_list.id),
            "include_description": False,
            "include_checklists": False,
        },
    )
    assert response.status_code == 201

    await db_session_async.refresh(source_card)
    assert source_card.description == "Source description"

    checklists = await _fetch_checklists(db_session_async, source_card.id)
    assert len(checklists) == 1
    assert len(checklists[0].items) == 2
