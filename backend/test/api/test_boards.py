#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the /api/v1/boards/overdue endpoint."""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.label import Label
from src.model.ui_board_color import UIBoardColor
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_card_color import UICardColor
from src.model.ui_list_color import UIListColor
from src.model.user import User

PAST = datetime.now(timezone.utc) - timedelta(days=2)
FUTURE = datetime.now(timezone.utc) + timedelta(days=2)


async def _make_board(db, owner: User, name: str, **flags) -> BoardList:
    """Create a board with a single list and return that list."""
    board = Board(owner_id=owner.id, name=name, **flags)
    db.add(board)
    await db.flush()
    board_list = BoardList(board_id=board.id, name=f"{name} list")
    db.add(board_list)
    await db.flush()
    return board_list


@pytest_asyncio.fixture
async def other_user(db_session_async) -> User:
    """A second user, used for the shared-board and no-access cases."""
    user = User(email="other@example.com", display_name="Other User")
    db_session_async.add(user)
    await db_session_async.commit()
    await db_session_async.refresh(user)
    return user


@pytest.mark.asyncio
async def test_boards_01(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify GET /boards/overdue counts only the cards that are genuinely past
    due: a future due date, an already-ended card, an archived card, a deleted
    card and a card with no due date at all are all left out.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The board owner, and the user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the board is missing from the response or its count includes a card
        that is not overdue.
    """
    board_list = await _make_board(db_session_async, test_user, "Counted")
    db_session_async.add_all([
        Card(list_id=board_list.id, name="Overdue 1", due_at=PAST),
        Card(list_id=board_list.id, name="Overdue 2", due_at=PAST),
        Card(list_id=board_list.id, name="Not due yet", due_at=FUTURE),
        Card(list_id=board_list.id, name="Finished", due_at=PAST, end_at=PAST),
        Card(list_id=board_list.id, name="Archived", due_at=PAST, is_archived=True),
        Card(list_id=board_list.id, name="Deleted", due_at=PAST, is_deleted=True),
        Card(list_id=board_list.id, name="No due date"),
    ])
    await db_session_async.commit()

    response = await client.get("/api/v1/boards/overdue", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["board_name"] == "Counted"
    assert body[0]["overdue_count"] == 2


@pytest.mark.asyncio
async def test_boards_02(
    client,
    db_session_async,
    test_user: User,
    other_user: User,
    auth_headers: dict[str, str],
) -> None:
    """
    Verify GET /boards/overdue spans owned and shared boards but leaves out
    archived boards, archived lists and boards the user has no access to, and
    that it never returns a board with nothing overdue.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The user the request is authenticated as.
    other_user : User
        Owner of the shared board and of the board test_user cannot see.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If a board that should be hidden shows up, if the shared board is
        missing, or if the rows are not ordered by descending count.
    """
    owned = await _make_board(db_session_async, test_user, "Owned")
    archived_board = await _make_board(
        db_session_async, test_user, "Archived board", is_archived=True
    )
    archived_list = await _make_board(db_session_async, test_user, "Archived list")
    archived_list.is_archived = True
    empty = await _make_board(db_session_async, test_user, "Nothing overdue")
    shared = await _make_board(db_session_async, other_user, "Shared")
    foreign = await _make_board(db_session_async, other_user, "Not mine")

    db_session_async.add(BoardShare(board_id=shared.board_id, user_id=test_user.id))
    db_session_async.add_all([
        Card(list_id=owned.id, name="Owned overdue", due_at=PAST),
        Card(list_id=archived_board.id, name="Hidden 1", due_at=PAST),
        Card(list_id=archived_list.id, name="Hidden 2", due_at=PAST),
        Card(list_id=empty.id, name="On time", due_at=FUTURE),
        Card(list_id=shared.id, name="Shared overdue A", due_at=PAST),
        Card(list_id=shared.id, name="Shared overdue B", due_at=PAST),
        Card(list_id=foreign.id, name="Hidden 3", due_at=PAST),
    ])
    await db_session_async.commit()

    response = await client.get("/api/v1/boards/overdue", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    # Ordered by count descending, so the shared board (2) comes first.
    assert [(row["board_name"], row["overdue_count"]) for row in body] == [
        ("Shared", 2),
        ("Owned", 1),
    ]


@pytest.mark.asyncio
async def test_boards_03(client, test_user: User, auth_headers: dict[str, str]) -> None:
    """
    Verify GET /boards/overdue returns an empty list, not an error, for a user
    with no boards at all.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The user the request is authenticated as; owns no boards.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the endpoint does not answer with an empty list.
    """
    response = await client.get("/api/v1/boards/overdue", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_boards_04(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify GET /boards/overdue nests the overdue cards under their list,
    skipping lists with nothing overdue, and carries the viewer's own
    board/list/card colors plus the board's list order.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the board up.
    test_user : User
        The board owner, and the user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If a list with no overdue card is returned, if the lists or cards come
        back in the wrong order, or if any of the colors are missing.
    """
    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add(board)
    await db_session_async.flush()

    first = BoardList(board_id=board.id, name="First")
    second = BoardList(board_id=board.id, name="Second")
    on_time = BoardList(board_id=board.id, name="On time")
    db_session_async.add_all([first, second, on_time])
    await db_session_async.flush()

    label = Label(board_id=board.id, name="Urgent", color="#FF0000", position=0)
    db_session_async.add(label)
    await db_session_async.flush()

    older = Card(list_id=second.id, name="Older", due_at=PAST - timedelta(days=5))
    newer = Card(
        list_id=second.id,
        name="Newer",
        due_at=PAST,
        labels=[label],
        assignees=[test_user],
    )
    only = Card(list_id=first.id, name="Only", due_at=PAST)
    db_session_async.add_all([
        older,
        newer,
        only,
        Card(list_id=on_time.id, name="Fine", due_at=FUTURE),
    ])
    # "Second" is deliberately ordered before "First" so the response can't
    # accidentally pass by falling back to creation order.
    db_session_async.add(UIBoardListOrder(board_id=board.id, list_ids=[second.id, first.id]))
    db_session_async.add_all([
        UIBoardColor(user_id=test_user.id, board_id=board.id, color="#111111"),
        UIListColor(user_id=test_user.id, list_id=second.id, color="#222222"),
    ])
    await db_session_async.flush()
    db_session_async.add(UICardColor(user_id=test_user.id, card_id=newer.id, color="#333333"))
    await db_session_async.commit()

    response = await client.get("/api/v1/boards/overdue", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    payload = body[0]
    assert payload["overdue_count"] == 3
    assert payload["color"] == "#111111"
    assert payload["card_colors"] == {str(newer.id): "#333333"}

    assert [lst["list_name"] for lst in payload["lists"]] == ["Second", "First"]
    assert [lst["color"] for lst in payload["lists"]] == ["#222222", None]
    # Oldest due date first within a list.
    assert [c["name"] for c in payload["lists"][0]["cards"]] == ["Older", "Newer"]
    assert [c["name"] for c in payload["lists"][1]["cards"]] == ["Only"]

    # The cards carry everything their face draws, labels and people included.
    newer_payload = payload["lists"][0]["cards"][1]
    assert [lbl["name"] for lbl in newer_payload["labels"]] == ["Urgent"]
    assert [p["display_name"] for p in newer_payload["assignees"]] == ["Test User"]
