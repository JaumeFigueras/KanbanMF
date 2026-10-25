#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the card, list and checklist operations in src.core (create,
update, move, archive, order, add a list, add and tick checklist items),
through the routes that call them."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from src.core.security import create_access_token
from src.core.ws_manager import manager
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.card import Card
from src.model.label import Label
from src.model.ui_board_color import UIBoardColor
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_card_color import UICardColor
from src.model.ui_list_card_order import UIListCardOrder
from src.model.ui_list_color import UIListColor
from src.model.user import User


@pytest_asyncio.fixture
async def board(db_session_async, test_user: User) -> Board:
    """A board owned by test_user with two lists, "To do" and "Done", and one
    label."""
    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add(board)
    await db_session_async.flush()
    db_session_async.add_all([
        BoardList(board_id=board.id, name="To do"),
        BoardList(board_id=board.id, name="Done"),
        Label(board_id=board.id, name="Admin", color="#ff0000", position=0),
    ])
    await db_session_async.commit()
    await db_session_async.refresh(board)
    return board


async def _lists(db_session_async, board: Board) -> tuple[BoardList, BoardList]:
    result = await db_session_async.execute(
        select(BoardList).where(BoardList.board_id == board.id).order_by(BoardList.name.desc())
    )
    todo, done = result.scalars().all()
    return todo, done


async def _label(db_session_async, board: Board) -> Label:
    result = await db_session_async.execute(select(Label).where(Label.board_id == board.id))
    return result.scalar_one()


@pytest.fixture
def notifications(monkeypatch) -> list[dict]:
    """Record every WebSocket notification sent to a board's people."""
    sent: list[dict] = []

    async def _record(user_ids, message):
        sent.append(message)

    monkeypatch.setattr(manager, "notify_many", _record)
    return sent


@pytest.mark.asyncio
async def test_card_operations_01(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str],
    notifications: list[dict],
) -> None:
    """
    Verify creating a card makes the creator a member, keeps only the labels
    and people of the board, and notifies the board's people.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner, who creates the card.
    board : Board
        The board the card is created on.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    notifications : list[dict]
        The WebSocket notifications sent during the test.

    Raises
    ------
    AssertionError
        If the card's members, labels or assignees aren't the expected ones,
        or no card_created notification names its list.
    """
    todo, _ = await _lists(db_session_async, board)
    label = await _label(db_session_async, board)
    stranger = User(email="stranger@example.com", display_name="Stranger", is_verified=True)
    other_board = Board(owner_id=test_user.id, name="Other")
    db_session_async.add_all([stranger, other_board])
    await db_session_async.flush()
    other_label = Label(board_id=other_board.id, name="Elsewhere", color="#00ff00", position=0)
    db_session_async.add(other_label)
    await db_session_async.commit()

    response = await client.post(
        f"/api/v1/boards/{board.id}/lists/{todo.id}/cards",
        headers=auth_headers,
        json={
            "name": "  Renew passport ",
            "label_ids": [str(label.id), str(other_label.id)],
            "assignee_ids": [str(test_user.id), str(stranger.id)],
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Renew passport"
    assert body["list_id"] == str(todo.id)
    assert [m["id"] for m in body["members"]] == [str(test_user.id)]
    assert [a["id"] for a in body["assignees"]] == [str(test_user.id)]
    assert [lbl["id"] for lbl in body["labels"]] == [str(label.id)]
    assert body["creator"]["id"] == str(test_user.id)
    assert {"type": "card_created", "board_id": str(board.id), "list_id": str(todo.id),
            "origin_client_id": None} in notifications


@pytest.mark.asyncio
async def test_card_operations_02(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str]
) -> None:
    """
    Verify a card can't be created on a template, on a board the user has no
    access to, or in a list of another board.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The owner of the board and the template.
    board : Board
        A board of test_user's, named with a list of another board.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If any of the three requests isn't refused with 400, 403 and 404.
    """
    template = Board(owner_id=test_user.id, name="Template", is_template=True)
    owner = User(email="owner@example.com", display_name="Owner", is_verified=True)
    db_session_async.add_all([template, owner])
    await db_session_async.flush()
    foreign = Board(owner_id=owner.id, name="Not yours")
    db_session_async.add(foreign)
    await db_session_async.flush()
    template_list = BoardList(board_id=template.id, name="List")
    foreign_list = BoardList(board_id=foreign.id, name="List")
    db_session_async.add_all([template_list, foreign_list])
    await db_session_async.commit()

    response = await client.post(
        f"/api/v1/boards/{template.id}/lists/{template_list.id}/cards",
        headers=auth_headers, json={"name": "Card"},
    )
    assert response.status_code == 400

    response = await client.post(
        f"/api/v1/boards/{foreign.id}/lists/{foreign_list.id}/cards",
        headers=auth_headers, json={"name": "Card"},
    )
    assert response.status_code == 403

    response = await client.post(
        f"/api/v1/boards/{board.id}/lists/{template_list.id}/cards",
        headers=auth_headers, json={"name": "Card"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_card_operations_03(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str],
    notifications: list[dict],
) -> None:
    """
    Verify updating a card changes only the fields sent, an explicit null
    clears a date, and moving it notifies both lists.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner.
    board : Board
        The board holding the card.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    notifications : list[dict]
        The WebSocket notifications sent during the test.

    Raises
    ------
    AssertionError
        If a field not sent changed, the due date wasn't cleared, the card
        didn't move, or the update/move notifications are missing.
    """
    todo, done = await _lists(db_session_async, board)
    card = Card(
        list_id=todo.id, creator_id=test_user.id, name="Card", description="Keep me",
        due_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session_async.add(card)
    await db_session_async.commit()

    response = await client.patch(
        f"/api/v1/boards/{board.id}/lists/{todo.id}/cards/{card.id}",
        headers=auth_headers,
        json={"name": "Renamed", "due_at": None, "list_id": str(done.id)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed"
    assert body["description"] == "Keep me"
    assert body["due_at"] is None
    assert body["list_id"] == str(done.id)
    sent = {(n["type"], n["list_id"]) for n in notifications}
    assert {
        ("card_updated", str(todo.id)), ("card_updated", str(done.id)),
        ("card_moved", str(todo.id)), ("card_moved", str(done.id)),
    } <= sent


@pytest.mark.asyncio
async def test_card_operations_04(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str]
) -> None:
    """
    Verify a start date after the end date is refused, and a card can be
    archived and restored.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner.
    board : Board
        The board holding the card.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the bad dates are accepted, or archiving/restoring doesn't flip
        is_archived.
    """
    todo, _ = await _lists(db_session_async, board)
    card = Card(list_id=todo.id, creator_id=test_user.id, name="Card")
    db_session_async.add(card)
    await db_session_async.commit()
    url = f"/api/v1/boards/{board.id}/lists/{todo.id}/cards/{card.id}"
    now = datetime.now(timezone.utc)

    response = await client.patch(url, headers=auth_headers, json={
        "start_at": now.isoformat(), "end_at": (now - timedelta(days=1)).isoformat(),
    })
    assert response.status_code == 422

    response = await client.patch(url, headers=auth_headers, json={"is_archived": True})
    assert response.status_code == 200
    assert response.json()["is_archived"] is True

    response = await client.patch(url, headers=auth_headers, json={"is_archived": False})
    assert response.status_code == 200
    assert response.json()["is_archived"] is False


@pytest.mark.asyncio
async def test_card_operations_05(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str]
) -> None:
    """
    Verify a list's card order is stored, and refused when it names a card of
    another list.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner.
    board : Board
        The board holding the cards.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the order isn't stored as sent, or a foreign card is accepted.
    """
    todo, done = await _lists(db_session_async, board)
    first = Card(list_id=todo.id, creator_id=test_user.id, name="First")
    second = Card(list_id=todo.id, creator_id=test_user.id, name="Second")
    elsewhere = Card(list_id=done.id, creator_id=test_user.id, name="Elsewhere")
    db_session_async.add_all([first, second, elsewhere])
    await db_session_async.commit()
    url = f"/api/v1/boards/{board.id}/lists/{todo.id}/cards/order"

    response = await client.put(url, headers=auth_headers, json={"card_ids": [str(second.id), str(first.id)]})
    assert response.status_code == 200
    stored = await db_session_async.execute(
        select(UIListCardOrder.card_ids).where(UIListCardOrder.list_id == todo.id)
    )
    assert stored.scalar_one() == [second.id, first.id]

    response = await client.put(url, headers=auth_headers, json={"card_ids": [str(elsewhere.id)]})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_card_operations_06(
    client, db_session_async, board: Board, auth_headers: dict[str, str],
    notifications: list[dict],
) -> None:
    """
    Verify a new list is appended to the board's list order and notified.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    board : Board
        The board the lists are added to.
    auth_headers : dict[str, str]
        Authorization header for the board's owner.
    notifications : list[dict]
        The WebSocket notifications sent during the test.

    Raises
    ------
    AssertionError
        If the lists aren't in the board's order in the order they were created, or no
        list_created notification was sent.
    """
    url = f"/api/v1/boards/{board.id}/lists"
    first = await client.post(url, headers=auth_headers, json={"name": "Backlog"})
    second = await client.post(url, headers=auth_headers, json={"name": "Later"})

    assert first.status_code == 201 and second.status_code == 201
    stored = await db_session_async.execute(
        select(UIBoardListOrder.list_ids).where(UIBoardListOrder.board_id == board.id)
    )
    assert stored.scalar_one() == [uuid.UUID(first.json()["id"]), uuid.UUID(second.json()["id"])]
    assert [n["type"] for n in notifications] == ["list_created", "list_created"]


@pytest.mark.asyncio
async def test_card_operations_07(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str]
) -> None:
    """
    Verify checklists and their items are appended in order, and an item can
    be ticked.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner.
    board : Board
        The board holding the card.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If a position is wrong, or ticking the item doesn't mark it done.
    """
    todo, _ = await _lists(db_session_async, board)
    card = Card(list_id=todo.id, creator_id=test_user.id, name="Card")
    db_session_async.add(card)
    await db_session_async.commit()
    url = f"/api/v1/boards/{board.id}/lists/{todo.id}/cards/{card.id}/checklists"

    first = await client.post(url, headers=auth_headers, json={"name": "Papers"})
    second = await client.post(url, headers=auth_headers, json={"name": "Errands"})
    assert first.status_code == 201
    assert (first.json()["position"], second.json()["position"]) == (0, 1)

    items_url = f"{url}/{first.json()['id']}/items"
    photos = await client.post(items_url, headers=auth_headers, json={"text": "Photos"})
    form = await client.post(items_url, headers=auth_headers, json={"text": "Form"})
    assert photos.status_code == 201
    assert (photos.json()["position"], form.json()["position"]) == (0, 1)
    assert photos.json()["is_done"] is False

    response = await client.patch(
        f"{items_url}/{photos.json()['id']}", headers=auth_headers, json={"is_done": True}
    )
    assert response.status_code == 200
    assert response.json()["is_done"] is True
    assert response.json()["text"] == "Photos"


@pytest.mark.asyncio
async def test_card_operations_08(
    client, db_session_async, test_user: User, board: Board
) -> None:
    """
    Verify a user the board isn't shared with can't add a checklist to its
    cards, and a card named under the wrong list isn't found.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner.
    board : Board
        The board holding the card.

    Raises
    ------
    AssertionError
        If the outsider gets anything but 403, or the wrong list anything but
        404.
    """
    todo, done = await _lists(db_session_async, board)
    card = Card(list_id=todo.id, creator_id=test_user.id, name="Card")
    outsider = User(email="outsider@example.com", display_name="Outsider", is_verified=True)
    db_session_async.add_all([card, outsider])
    await db_session_async.commit()

    response = await client.post(
        f"/api/v1/boards/{board.id}/lists/{todo.id}/cards/{card.id}/checklists",
        headers={"Authorization": f"Bearer {create_access_token(outsider.id)}"},
        json={"name": "Mine now"},
    )
    assert response.status_code == 403

    response = await client.post(
        f"/api/v1/boards/{board.id}/lists/{done.id}/cards/{card.id}/checklists",
        headers={"Authorization": f"Bearer {create_access_token(test_user.id)}"},
        json={"name": "Wrong list"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_card_operations_09(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str]
) -> None:
    """
    Verify a new card takes its creator's color for the list, not someone
    else's, and a card in a list without one gets no color.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner, who creates the cards.
    board : Board
        The board the cards are created on.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the card in "To do" hasn't exactly test_user's list color, or the
        card in "Done" has any color.
    """
    todo, done = await _lists(db_session_async, board)
    other = User(email="other@example.com", display_name="Other", is_verified=True)
    db_session_async.add(other)
    await db_session_async.flush()
    db_session_async.add_all([
        UIListColor(user_id=test_user.id, list_id=todo.id, color="#2e7d32"),
        UIListColor(user_id=other.id, list_id=todo.id, color="#c62828"),
    ])
    await db_session_async.commit()

    colored = await client.post(
        f"/api/v1/boards/{board.id}/lists/{todo.id}/cards", headers=auth_headers, json={"name": "Green"}
    )
    plain = await client.post(
        f"/api/v1/boards/{board.id}/lists/{done.id}/cards", headers=auth_headers, json={"name": "Plain"}
    )
    assert colored.status_code == plain.status_code == 201

    result = await db_session_async.execute(select(UICardColor.card_id, UICardColor.user_id, UICardColor.color))
    assert result.all() == [(uuid.UUID(colored.json()["id"]), test_user.id, "#2e7d32")]


@pytest.mark.asyncio
async def test_card_operations_10(
    client, db_session_async, test_user: User, board: Board, auth_headers: dict[str, str]
) -> None:
    """
    Verify a new list takes its creator's color for the board, and a list on
    a board without one gets no color.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The board's owner, who adds the lists.
    board : Board
        The board with a color.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the list on the colored board hasn't test_user's board color, or
        the list on the other board has any color.
    """
    plain_board = Board(owner_id=test_user.id, name="Plain")
    db_session_async.add_all([plain_board, UIBoardColor(user_id=test_user.id, board_id=board.id, color="#1565c0")])
    await db_session_async.commit()

    colored = await client.post(f"/api/v1/boards/{board.id}/lists", headers=auth_headers, json={"name": "Blue"})
    plain = await client.post(f"/api/v1/boards/{plain_board.id}/lists", headers=auth_headers, json={"name": "Plain"})
    assert colored.status_code == plain.status_code == 201

    result = await db_session_async.execute(select(UIListColor.list_id, UIListColor.user_id, UIListColor.color))
    assert result.all() == [(uuid.UUID(colored.json()["id"]), test_user.id, "#1565c0")]
