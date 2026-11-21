#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the label routes: a change the cards show (rename, colour,
order, deletion) is notified to everyone on the board, and a new label goes
after the last one."""

import pytest
import pytest_asyncio
from sqlalchemy import select

from src.core.ws_manager import manager
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.label import Label
from src.model.user import User


@pytest_asyncio.fixture
async def board(db_session_async, test_user: User) -> Board:
    """A board owned by test_user, shared with one other user, with two
    labels, "Admin" and "Urgent"."""
    shared_user = User(email="shared@example.com", display_name="Shared", is_verified=True)
    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add_all([shared_user, board])
    await db_session_async.flush()
    db_session_async.add_all([
        BoardShare(board_id=board.id, user_id=shared_user.id),
        Label(board_id=board.id, name="Admin", color="#ff0000", position=0),
        Label(board_id=board.id, name="Urgent", color="#00ff00", position=1),
    ])
    await db_session_async.commit()
    await db_session_async.refresh(board)
    return board


@pytest.fixture
def sent(monkeypatch) -> list[tuple[set, dict]]:
    """Record every WebSocket notification: who it went to, and the message."""
    recorded: list[tuple[set, dict]] = []

    async def _record(user_ids, message):
        recorded.append((set(user_ids), message))

    monkeypatch.setattr(manager, "notify_many", _record)
    return recorded


async def _labels(db_session_async, board: Board) -> list[Label]:
    result = await db_session_async.execute(select(Label).where(Label.board_id == board.id).order_by(Label.name))
    return list(result.scalars().all())


async def _everyone(db_session_async, board: Board) -> set:
    result = await db_session_async.execute(select(BoardShare.user_id).where(BoardShare.board_id == board.id))
    return {board.owner_id, *result.scalars().all()}


@pytest.mark.asyncio
async def test_labels_01(
    client, db_session_async, board: Board, auth_headers: dict[str, str], sent: list[tuple[set, dict]]
) -> None:
    """
    Verify renaming or recolouring a label, reordering the labels and deleting
    one each notify everyone on the board, with the tab that made the change.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    board : Board
        The board with two labels, shared with one user.
    auth_headers : dict[str, str]
        Authorization header for the board's owner.
    sent : list[tuple[set, dict]]
        The notifications sent, with their recipients.

    Raises
    ------
    AssertionError
        If a change isn't notified exactly once, to the owner and the shared
        user, as labels_changed for the board from the tab that made it.
    """
    admin, urgent = await _labels(db_session_async, board)
    everyone = await _everyone(db_session_async, board)
    headers = {**auth_headers, "X-Client-Id": "tab-1"}
    url = f"/api/v1/boards/{board.id}/labels"
    expected = {"type": "labels_changed", "board_id": str(board.id), "list_id": None, "origin_client_id": "tab-1"}

    response = await client.patch(f"{url}/{admin.id}", headers=headers, json={"name": "Paperwork"})
    assert response.status_code == 200
    response = await client.patch(f"{url}/{admin.id}", headers=headers, json={"color": "#0000ff"})
    assert response.status_code == 200
    response = await client.put(f"{url}/order", headers=headers, json={"label_ids": [str(urgent.id), str(admin.id)]})
    assert response.status_code == 200
    response = await client.delete(f"{url}/{urgent.id}", headers=headers)
    assert response.status_code == 204

    assert sent == [(everyone, expected)] * 4


@pytest.mark.asyncio
async def test_labels_02(
    client, db_session_async, board: Board, auth_headers: dict[str, str], sent: list[tuple[set, dict]]
) -> None:
    """
    Verify creating a label, which is on no card yet, and a refused change
    notify nobody.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    board : Board
        The board with two labels, shared with one user.
    auth_headers : dict[str, str]
        Authorization header for the board's owner.
    sent : list[tuple[set, dict]]
        The notifications sent, with their recipients.

    Raises
    ------
    AssertionError
        If any of these requests sends a notification.
    """
    admin, _ = await _labels(db_session_async, board)
    url = f"/api/v1/boards/{board.id}/labels"
    missing = "00000000-0000-0000-0000-000000000000"

    response = await client.post(url, headers=auth_headers, json={"name": "Later", "color": "#123456"})
    assert response.status_code == 201
    response = await client.patch(f"{url}/{missing}", headers=auth_headers, json={"name": "Nobody"})
    assert response.status_code == 404
    response = await client.put(f"{url}/order", headers=auth_headers, json={"label_ids": [str(admin.id)]})
    assert response.status_code == 422
    response = await client.delete(f"{url}/{missing}", headers=auth_headers)
    assert response.status_code == 404

    assert sent == []


@pytest.mark.asyncio
async def test_labels_03(client, db_session_async, board: Board, auth_headers: dict[str, str]) -> None:
    """
    Verify a label created after a deletion goes after the last one, and the
    first label on a board without any gets position 0: deleting doesn't
    renumber the rest, so "how many there are" would be a position already in
    use.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    board : Board
        The board with two labels, "Admin" (position 0) and "Urgent" (1).
    auth_headers : dict[str, str]
        Authorization header for the board's owner.

    Raises
    ------
    AssertionError
        If the new label shares a position with another, or isn't listed
        last.
    """
    admin, urgent = await _labels(db_session_async, board)
    url = f"/api/v1/boards/{board.id}/labels"

    assert (await client.delete(f"{url}/{admin.id}", headers=auth_headers)).status_code == 204
    later = await client.post(url, headers=auth_headers, json={"name": "Later", "color": "#123456"})
    assert later.status_code == 201
    listed = (await client.get(url, headers=auth_headers)).json()
    assert [(lbl["name"], lbl["position"]) for lbl in listed] == [("Urgent", 1), ("Later", 2)]

    for label_id in (urgent.id, later.json()["id"]):
        assert (await client.delete(f"{url}/{label_id}", headers=auth_headers)).status_code == 204
    first = await client.post(url, headers=auth_headers, json={"name": "First", "color": "#654321"})
    assert first.status_code == 201
    assert first.json()["position"] == 0
