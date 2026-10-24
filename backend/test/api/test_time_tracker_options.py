#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the time tracker's ordered board and list choices:
GET /api/v1/time-entries/boards and GET /api/v1/time-entries/boards/{board_id}/lists."""

from datetime import datetime, timezone

import pytest

from src.core.security import create_access_token
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.time_tracker_board_usage import TimeTrackerBoardUsage
from src.model.time_tracker_list_usage import TimeTrackerListUsage
from src.model.user import User


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _other_user(db) -> User:
    """Persist and return a second user."""
    other = User(email="other@example.com", display_name="Other", is_verified=True)
    db.add(other)
    await db.flush()
    return other


@pytest.mark.asyncio
async def test_time_tracker_options_01(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify GET /time-entries/boards returns the caller's own and shared live
    boards, most used first, ties and unused boards in case-insensitive
    alphabetical order, and leaves out archived, deleted, template and
    unrelated boards.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the boards returned, their order or their counts differ.
    """
    other = await _other_user(db_session_async)
    boards = {
        name: Board(owner_id=owner.id, name=name, **flags)
        for name, owner, flags in [
            ("zeta", test_user, {}),
            ("Alpha", test_user, {}),
            ("beta", test_user, {}),
            ("Gamma", test_user, {}),
            ("Shared", other, {}),
            ("Unshared", other, {}),
            ("Archived", test_user, {"is_archived": True}),
            ("Deleted", test_user, {"is_deleted": True}),
            ("Template", test_user, {"is_template": True}),
        ]
    }
    db_session_async.add_all(boards.values())
    await db_session_async.flush()
    db_session_async.add(BoardShare(board_id=boards["Shared"].id, user_id=test_user.id))
    db_session_async.add_all([
        TimeTrackerBoardUsage(user_id=test_user.id, board_id=boards[n].id, usage_count=c, computed_at=_now())
        for n, c in [("zeta", 5), ("Shared", 5), ("Gamma", 2), ("Archived", 9)]
    ])
    # Someone else's usage must not affect the caller's order.
    db_session_async.add(TimeTrackerBoardUsage(
        user_id=other.id, board_id=boards["beta"].id, usage_count=100, computed_at=_now(),
    ))
    await db_session_async.commit()

    response = await client.get("/api/v1/time-entries/boards", headers=auth_headers)

    assert response.status_code == 200
    assert [(b["name"], b["usage_count"]) for b in response.json()] == [
        ("Shared", 5), ("zeta", 5), ("Gamma", 2), ("Alpha", 0), ("beta", 0),
    ]
    assert response.json()[0]["id"] == str(boards["Shared"].id)


@pytest.mark.asyncio
async def test_time_tracker_options_02(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify GET /time-entries/boards/{board_id}/lists returns the board's live
    lists ordered by the caller's usage, then alphabetically, and leaves out
    archived and deleted lists.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the lists up.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the lists returned, their order or their counts differ.
    """
    other = await _other_user(db_session_async)
    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add(board)
    await db_session_async.flush()
    lists = {
        name: BoardList(board_id=board.id, name=name, **flags)
        for name, flags in [
            ("To do", {}),
            ("doing", {}),
            ("Done", {}),
            ("Archived", {"is_archived": True}),
            ("Deleted", {"is_deleted": True}),
        ]
    }
    db_session_async.add_all(lists.values())
    await db_session_async.flush()
    db_session_async.add_all([
        TimeTrackerListUsage(user_id=test_user.id, list_id=lists["Done"].id, usage_count=4, computed_at=_now()),
        TimeTrackerListUsage(user_id=other.id, list_id=lists["To do"].id, usage_count=50, computed_at=_now()),
    ])
    await db_session_async.commit()

    response = await client.get(f"/api/v1/time-entries/boards/{board.id}/lists", headers=auth_headers)

    assert response.status_code == 200
    assert [(lst["name"], lst["usage_count"]) for lst in response.json()] == [
        ("Done", 4), ("doing", 0), ("To do", 0),
    ]


@pytest.mark.asyncio
async def test_time_tracker_options_03(client, db_session_async, test_user: User) -> None:
    """
    Verify a shared user can read a board's lists, a user without access gets
    403, and an unknown or deleted board gets 404.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        Owner of the boards.

    Raises
    ------
    AssertionError
        If any request gets a different status code.
    """
    shared_with = await _other_user(db_session_async)
    outsider = User(email="outsider@example.com", display_name="Outsider", is_verified=True)
    board = Board(owner_id=test_user.id, name="Board")
    deleted = Board(owner_id=test_user.id, name="Deleted", is_deleted=True)
    db_session_async.add_all([outsider, board, deleted])
    await db_session_async.flush()
    db_session_async.add(BoardShare(board_id=board.id, user_id=shared_with.id))
    await db_session_async.commit()

    def headers(user: User) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user.id)}"}

    url = "/api/v1/time-entries/boards/{}/lists"
    assert (await client.get(url.format(board.id), headers=headers(shared_with))).status_code == 200
    assert (await client.get(url.format(board.id), headers=headers(outsider))).status_code == 403
    assert (await client.get(url.format(deleted.id), headers=headers(test_user))).status_code == 404
    assert (await client.get(url.format(outsider.id), headers=headers(test_user))).status_code == 404


@pytest.mark.asyncio
async def test_time_tracker_options_04(client) -> None:
    """
    Verify both endpoints require authentication.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If an unauthenticated request is not refused with 401.
    """
    assert (await client.get("/api/v1/time-entries/boards")).status_code == 401
    board_id = "00000000-0000-0000-0000-000000000000"
    assert (await client.get(f"/api/v1/time-entries/boards/{board_id}/lists")).status_code == 401
