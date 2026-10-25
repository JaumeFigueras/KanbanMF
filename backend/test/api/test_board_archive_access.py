#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests that archiving a board takes it away from the people it is shared
with — through the API, not only in the frontend — until the owner restores
it, while the owner keeps it."""

from types import SimpleNamespace

import pytest
import pytest_asyncio

from src.core.security import create_access_token
from src.model.user import User


@pytest_asyncio.fixture
async def shared(client, db_session_async, test_user: User) -> SimpleNamespace:
    """A board of Olga's, with a list, a card and a label, shared with
    test_user. Made through the API, as Olga."""
    olga = User(email="olga@example.com", display_name="Olga", is_verified=True)
    db_session_async.add(olga)
    await db_session_async.commit()
    owner = {"Authorization": f"Bearer {create_access_token(olga.id)}"}

    board = (await client.post("/api/v1/boards", headers=owner, json={"name": "Plans"})).json()
    path = f"/api/v1/boards/{board['id']}"
    board_list = (await client.post(f"{path}/lists", headers=owner, json={"name": "To do"})).json()
    card = (await client.post(f"{path}/lists/{board_list['id']}/cards", headers=owner, json={"name": "Trip"})).json()
    label = (await client.post(f"{path}/labels", headers=owner, json={"name": "Urgent", "color": "#FF0000"})).json()
    response = await client.post(f"{path}/shares", headers=owner, json={"user_id": str(test_user.id)})
    assert response.status_code == 201
    return SimpleNamespace(
        owner=owner, path=path, board_id=board["id"], list_id=board_list["id"], card_id=card["id"],
        label_id=label["id"],
        card_path=f"{path}/lists/{board_list['id']}/cards/{card['id']}",
    )


def _requests(s: SimpleNamespace) -> list[tuple[str, str, dict | None]]:
    """What someone the board is shared with can do: read it and change it.
    (Labels are the owner's to manage, so creating one isn't here.)"""
    entry = {"board_id": s.board_id, "list_id": s.list_id, "card_id": s.card_id,
             "started_at": "2026-10-25T09:00:00Z", "ended_at": "2026-10-25T10:00:00Z"}
    return [
        ("GET", s.path, None),
        ("GET", f"{s.path}/lists", None),
        ("GET", f"{s.path}/lists/{s.list_id}/cards", None),
        ("GET", f"{s.path}/labels", None),
        ("GET", f"{s.path}/members", None),
        ("GET", f"{s.path}/colors", None),
        ("GET", f"/api/v1/search?q=Trip&board_id={s.board_id}", None),
        ("POST", f"{s.path}/lists", {"name": "Sneaky"}),
        ("POST", f"{s.path}/lists/{s.list_id}/cards", {"name": "Sneaky"}),
        ("PATCH", s.card_path, {"name": "Renamed"}),
        ("POST", f"{s.card_path}/checklists", {"name": "Steps"}),
        ("POST", f"{s.path}/star", None),
        ("PUT", f"{s.path}/color", {"color": "#123456"}),
        ("POST", "/api/v1/time-entries", entry),
    ]


async def _statuses(client, headers, s: SimpleNamespace) -> dict[str, int]:
    statuses = {}
    for method, path, body in _requests(s):
        response = await client.request(method, path, headers=headers, json=body)
        statuses[f"{method} {path}"] = response.status_code
    return statuses


@pytest.mark.asyncio
async def test_board_archive_access_01(client, auth_headers, shared: SimpleNamespace) -> None:
    """
    Verify a shared user can use the board while it is live, gets 403 for
    every read and change once the owner archives it, and gets it back when
    the owner restores it.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user, whom the board is shared with.
    shared : SimpleNamespace
        The shared board and its contents.

    Raises
    ------
    AssertionError
        If any request on the archived board succeeds for the shared user,
        or the live board refuses them.
    """
    live = await _statuses(client, auth_headers, shared)
    assert all(code < 300 for code in live.values()), {k: v for k, v in live.items() if v >= 300}

    response = await client.patch(shared.path, headers=shared.owner, json={"is_archived": True})
    assert response.status_code == 200
    archived = await _statuses(client, auth_headers, shared)
    assert all(code == 403 for code in archived.values()), archived

    response = await client.patch(shared.path, headers=shared.owner, json={"is_archived": False})
    assert response.status_code == 200
    response = await client.get(shared.path, headers=auth_headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_board_archive_access_02(client, auth_headers, shared: SimpleNamespace) -> None:
    """
    Verify the owner can still open an archived board and its contents, and
    that the board leaves the shared user's boards page.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user, whom the board is shared with.
    shared : SimpleNamespace
        The shared board and its contents.

    Raises
    ------
    AssertionError
        If the owner is refused, or the shared user still lists the board.
    """
    await client.patch(shared.path, headers=shared.owner, json={"is_archived": True})

    for path in (shared.path, f"{shared.path}/lists", f"{shared.path}/lists/{shared.list_id}/cards"):
        assert (await client.get(path, headers=shared.owner)).status_code == 200, path
    response = await client.get(shared.path, headers=shared.owner)
    assert response.json()["is_archived"] is True

    boards = (await client.get("/api/v1/boards", headers=auth_headers)).json()
    assert shared.board_id not in [b["id"] for b in boards["shared"]]
