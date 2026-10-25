#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the request-size limits: the 1 MiB ceiling on every request body
(src/core/body_limit.py), the avatar read, and the longest text each field
accepts (src/schemas/limits.py)."""

import pytest
import pytest_asyncio
from sqlalchemy import select

from src.core.body_limit import MAX_REQUEST_BODY_BYTES
from src.model.card import Card
from src.model.user_avatar import MAX_AVATAR_SIZE_BYTES, UserAvatar


@pytest_asyncio.fixture
async def card_path(client, auth_headers) -> str:
    """A board, a list and a card of test_user's, made through the API; the
    card's address."""
    board = await client.post("/api/v1/boards", headers=auth_headers, json={"name": "Limits"})
    board_id = board.json()["id"]
    board_list = await client.post(f"/api/v1/boards/{board_id}/lists", headers=auth_headers, json={"name": "To do"})
    list_id = board_list.json()["id"]
    card = await client.post(f"/api/v1/boards/{board_id}/lists/{list_id}/cards", headers=auth_headers,
                             json={"name": "Card"})
    assert card.status_code == 201
    return f"/api/v1/boards/{board_id}/lists/{list_id}/cards/{card.json()['id']}"


@pytest.mark.asyncio
async def test_request_limits_01(client, auth_headers, db_session_async) -> None:
    """
    Verify a body declared over 1 MiB is refused with 413 before the route
    runs, while one just under it reaches the route.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    db_session_async : AsyncSession
        Session on the test database.

    Raises
    ------
    AssertionError
        If the oversized body isn't refused with 413, or the smaller one is.
    """
    padding = " " * MAX_REQUEST_BODY_BYTES
    response = await client.post("/api/v1/boards", headers={**auth_headers, "Content-Type": "application/json"},
                                 content='{"name": "Big"}' + padding)
    assert response.status_code == 413
    assert response.json()["detail"] == "Request body too large"

    response = await client.post("/api/v1/boards", headers={**auth_headers, "Content-Type": "application/json"},
                                 content='{"name": "Fits"}' + " " * (MAX_REQUEST_BODY_BYTES - 100))
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_request_limits_02(client, auth_headers) -> None:
    """
    Verify a body sent without Content-Length (chunked) is counted as it
    arrives and refused with 413 once it passes 1 MiB.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the chunked body isn't refused with 413.
    """
    async def chunks():
        yield b'{"name": "Big"'
        for _ in range(20):
            yield b" " * (64 * 1024)
        yield b"}"

    response = await client.post("/api/v1/boards", headers={**auth_headers, "Content-Type": "application/json"},
                                 content=chunks())
    assert "content-length" not in response.request.headers
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_request_limits_03(client, auth_headers, db_session_async, test_user) -> None:
    """
    Verify an avatar over 100 KB (but under the request ceiling) is refused
    with 413 and nothing is stored.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    db_session_async : AsyncSession
        Session on the test database.
    test_user : User
        The caller.

    Raises
    ------
    AssertionError
        If the avatar is accepted or stored.
    """
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * MAX_AVATAR_SIZE_BYTES
    response = await client.put("/api/v1/users/me/avatar", headers=auth_headers,
                                files={"file": ("a.png", png, "image/png")})
    assert response.status_code == 413
    stored = await db_session_async.execute(select(UserAvatar).where(UserAvatar.user_id == test_user.id))
    assert stored.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_request_limits_04(client, auth_headers, card_path, db_session_async) -> None:
    """
    Verify a card's name and description are capped (255 and 20,000
    characters) with 422, instead of a 500 from the database or an unlimited
    description, and that the longest allowed values are kept.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    card_path : str
        The address of a card of test_user's.
    db_session_async : AsyncSession
        Session on the test database.

    Raises
    ------
    AssertionError
        If a too-long value is accepted, or the longest allowed one refused.
    """
    response = await client.patch(card_path, headers=auth_headers, json={"name": "n" * 256})
    assert response.status_code == 422
    response = await client.patch(card_path, headers=auth_headers, json={"description": "d" * 20_001})
    assert response.status_code == 422
    list_path = card_path.rsplit("/cards/", 1)[0]
    response = await client.post(f"{list_path}/cards", headers=auth_headers, json={"name": "c" * 256})
    assert response.status_code == 422

    response = await client.patch(card_path, headers=auth_headers,
                                json={"name": "n" * 255, "description": "d" * 20_000})
    assert response.status_code == 200
    card = (await db_session_async.execute(select(Card).where(Card.name == "n" * 255))).scalar_one()
    assert len(card.description) == 20_000


@pytest.mark.asyncio
async def test_request_limits_05(client, auth_headers, card_path) -> None:
    """
    Verify the other names and texts are capped with 422: board, list,
    checklist and checklist item, label, display name, and a time entry's
    note.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    card_path : str
        The address of a card of test_user's.

    Raises
    ------
    AssertionError
        If any too-long value is accepted.
    """
    board_path = card_path.split("/lists/")[0]
    board_id = board_path.rsplit("/", 1)[1]
    list_id = card_path.split("/lists/")[1].split("/")[0]
    card_id = card_path.rsplit("/", 1)[1]

    async def status(method: str, path: str, body: dict) -> int:
        return (await client.request(method, path, headers=auth_headers, json=body)).status_code

    assert await status("POST", "/api/v1/boards", {"name": "b" * 256}) == 422
    assert await status("PATCH", board_path, {"name": "b" * 256}) == 422
    assert await status("POST", f"{board_path}/lists", {"name": "l" * 256}) == 422
    assert await status("POST", f"{card_path}/checklists", {"name": "c" * 256}) == 422
    assert await status("POST", f"{board_path}/labels", {"name": "l" * 101, "color": "#FF0000"}) == 422
    assert await status("PUT", "/api/v1/users/me", {"display_name": "u" * 101}) == 422
    entry = {"board_id": board_id, "list_id": list_id, "card_id": card_id,
             "started_at": "2026-10-25T09:00:00Z", "ended_at": "2026-10-25T10:00:00Z"}
    assert await status("POST", "/api/v1/time-entries", {**entry, "comment": "c" * 2_001}) == 422

    response = await client.post(f"{card_path}/checklists", headers=auth_headers, json={"name": "Steps"})
    assert response.status_code == 201
    items_path = f"{card_path}/checklists/{response.json()['id']}/items"
    assert await status("POST", items_path, {"text": "i" * 501}) == 422
    assert await status("POST", items_path, {"text": "i" * 500}) == 201
