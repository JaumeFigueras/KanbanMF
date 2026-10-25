#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for GET /api/v1/users/search, the share dialog's lookahead: names
only among the people the caller works with, e-mail addresses only whole,
and never a way to list who has an account."""

import pytest
import pytest_asyncio

from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.user import User


@pytest_asyncio.fixture
async def people(db_session_async, test_user: User) -> dict[str, User]:
    """Around test_user ("Test User"):

    - Ann, on test_user's board;
    - Bob, who owns a board shared with test_user;
    - Carol, also on Bob's board;
    - Dora, only on a board test_user deleted;
    - Zed, a stranger at zed@company.com;
    - Una (unverified) and Ina (inactive), both on test_user's board.
    """
    def user(name: str, **kw) -> User:
        first = name.split()[0].lower()
        return User(email=f"{first}@company.com", display_name=name, is_verified=True, **kw)

    people = {
        "ann": user("Ann Smith"), "bob": user("Bob Smith"), "carol": user("Carol Smith"),
        "dora": user("Dora Smith"), "zed": user("Zed Smith"),
        "una": User(email="una@company.com", display_name="Una Smith", is_verified=False),
        "ina": user("Ina Smith", is_active=False),
    }
    db_session_async.add_all(people.values())
    await db_session_async.flush()
    mine = Board(owner_id=test_user.id, name="Mine")
    bobs = Board(owner_id=people["bob"].id, name="Bob's")
    gone = Board(owner_id=test_user.id, name="Gone", is_deleted=True)
    db_session_async.add_all([mine, bobs, gone])
    await db_session_async.flush()
    db_session_async.add_all([
        BoardShare(board_id=mine.id, user_id=people["ann"].id),
        BoardShare(board_id=mine.id, user_id=people["una"].id),
        BoardShare(board_id=mine.id, user_id=people["ina"].id),
        BoardShare(board_id=bobs.id, user_id=test_user.id),
        BoardShare(board_id=bobs.id, user_id=people["carol"].id),
        BoardShare(board_id=gone.id, user_id=people["dora"].id),
    ])
    await db_session_async.commit()
    return people


async def _names(client, headers, q: str) -> list[str]:
    response = await client.get("/api/v1/users/search", params={"q": q}, headers=headers)
    assert response.status_code == 200
    return [p["display_name"] for p in response.json()]


@pytest.mark.asyncio
async def test_users_search_01(client, auth_headers, people) -> None:
    """
    Verify a name finds the people the caller works with — on the caller's
    boards, owners of boards shared with them, and others on those boards —
    and no one else.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    people : dict[str, User]
        The people around test_user.

    Raises
    ------
    AssertionError
        If a colleague is missing, or a stranger, an unverified or inactive
        user, someone only on a deleted board, or the caller shows up.
    """
    assert await _names(client, auth_headers, "smith") == ["Ann Smith", "Bob Smith", "Carol Smith"]
    assert await _names(client, auth_headers, "Test") == []


@pytest.mark.asyncio
async def test_users_search_02(client, auth_headers, people) -> None:
    """
    Verify a stranger is found only by their whole e-mail address, in any
    case — never by name, by part of the address, or by its domain.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    people : dict[str, User]
        The people around test_user.

    Raises
    ------
    AssertionError
        If the stranger can be found by anything but the whole address.
    """
    assert await _names(client, auth_headers, "ZED@Company.com") == ["Zed Smith"]
    for q in ("Zed", "zed@", "@company.com", "company", "zed@company.co"):
        assert await _names(client, auth_headers, q) == [], q


@pytest.mark.asyncio
async def test_users_search_03(client, auth_headers, people) -> None:
    """
    Verify unverified and inactive accounts are never found, not even by
    their whole address, and a one-letter term matches no names.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    people : dict[str, User]
        The people around test_user.

    Raises
    ------
    AssertionError
        If an unusable account or a one-letter match comes back.
    """
    assert await _names(client, auth_headers, "una@company.com") == []
    assert await _names(client, auth_headers, "ina@company.com") == []
    assert await _names(client, auth_headers, "a") == []


@pytest.mark.asyncio
async def test_users_search_04(client, auth_headers, people) -> None:
    """
    Verify % and _ are plain characters, not wildcards: they used to list
    every account.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    people : dict[str, User]
        The people around test_user.

    Raises
    ------
    AssertionError
        If a wildcard matches anyone.
    """
    for q in ("%", "%%", "__", "_%_"):
        assert await _names(client, auth_headers, q) == [], q
