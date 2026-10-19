#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for GET/PUT /api/v1/boards/{board_id}/notifications and the
weekday filter in the hourly due-date job."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core import notifications
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_notification_settings import BoardNotificationSettings, weekdays_to_mask
from src.model.card import Card
from src.model.card_assignee import CardAssignee
from src.model.user import User


def _settings_body(**overrides) -> dict:
    """Return a valid PUT body, overridden by kwargs."""
    body = {
        "is_enabled": True,
        "notify_hour": 9,
        "notify_weekdays": [1, 2, 3, 4, 5],
        "offset_days": [-1, 0],
        "overdue_repeat_after_days": None,
    }
    body.update(overrides)
    return body


async def _make_board(db, owner: User) -> Board:
    """Persist and return a board owned by owner."""
    board = Board(owner_id=owner.id, name="Board")
    db.add(board)
    await db.commit()
    return board


@pytest.mark.asyncio
async def test_board_notifications_01(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify GET returns workdays only (Monday-Friday) when the user has not
    saved any settings for the board yet.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the board up.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the default weekdays are not [1, 2, 3, 4, 5].
    """
    board = await _make_board(db_session_async, test_user)

    response = await client.get(f"/api/v1/boards/{board.id}/notifications", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["notify_weekdays"] == [1, 2, 3, 4, 5]


@pytest.mark.asyncio
async def test_board_notifications_02(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify the weekdays saved with PUT are stored as a bitmask and read back
    sorted and deduplicated by both PUT and a following GET, and that a
    second PUT replaces them.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to check the stored row.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the response or the stored bitmask differ from what was sent.
    """
    board = await _make_board(db_session_async, test_user)
    url = f"/api/v1/boards/{board.id}/notifications"

    response = await client.put(url, json=_settings_body(notify_weekdays=[7, 1, 6, 1]), headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["notify_weekdays"] == [1, 6, 7]

    response = await client.get(url, headers=auth_headers)
    assert response.json()["notify_weekdays"] == [1, 6, 7]

    settings = await db_session_async.get(BoardNotificationSettings, (board.id, test_user.id))
    assert settings.notify_weekdays == 0b1100001
    # The app shares this session in tests; drop the cached row so the next
    # PUT's read-back sees its own upsert rather than this stale object.
    db_session_async.expunge(settings)

    response = await client.put(url, json=_settings_body(notify_weekdays=[3]), headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["notify_weekdays"] == [3]


@pytest.mark.asyncio
@pytest.mark.parametrize("weekdays", [[], [0], [8]])
async def test_board_notifications_03(
    client, db_session_async, test_user: User, auth_headers: dict[str, str], weekdays: list[int]
) -> None:
    """
    Verify PUT refuses an empty selection or a day outside 1..7 with 422.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the board up.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.
    weekdays : list[int]
        An invalid notify_weekdays value.

    Raises
    ------
    AssertionError
        If the request is not rejected with 422.
    """
    board = await _make_board(db_session_async, test_user)

    response = await client.put(
        f"/api/v1/boards/{board.id}/notifications",
        json=_settings_body(notify_weekdays=weekdays),
        headers=auth_headers,
    )

    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("today_selected", [True, False])
async def test_board_notifications_04(
    db_session_async, test_user: User, monkeypatch, today_selected: bool
) -> None:
    """
    Verify the hourly job sends a due reminder only when today's weekday is
    among the user's notify_weekdays, and skips it otherwise.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session against the test database. Its engine also backs the session
        factory the job is given in place of the real AsyncSessionLocal.
    test_user : User
        Owner of the board, assignee of the card and the only recipient.
    monkeypatch : pytest.MonkeyPatch
        Swaps the job's session factory and e-mail sender for test doubles.
    today_selected : bool
        Whether the settings include today's weekday or every day but today.

    Raises
    ------
    AssertionError
        If a reminder is sent on an unselected day, or missing on a
        selected one.
    """
    # No preferences row, so the job reads the hour and weekday in UTC.
    now = datetime.now(timezone.utc)
    today = now.isoweekday()
    weekdays = [today] if today_selected else [d for d in range(1, 8) if d != today]

    board = await _make_board(db_session_async, test_user)
    board_list = BoardList(board_id=board.id, name="List")
    db_session_async.add(board_list)
    await db_session_async.flush()
    card = Card(list_id=board_list.id, name="Card", due_at=now - timedelta(days=1))
    db_session_async.add(card)
    await db_session_async.flush()
    db_session_async.add(CardAssignee(card_id=card.id, user_id=test_user.id))
    db_session_async.add(BoardNotificationSettings(
        board_id=board.id,
        user_id=test_user.id,
        is_enabled=True,
        notify_hour=now.hour,
        notify_weekdays=weekdays_to_mask(weekdays),
        overdue_repeat_after_days=0,
    ))
    await db_session_async.commit()

    sent: list[str] = []

    async def _fake_send(**kwargs) -> None:
        sent.append(kwargs["card_name"])

    monkeypatch.setattr(notifications, "send_due_date_reminder_email", _fake_send)
    monkeypatch.setattr(
        notifications,
        "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )

    await notifications.send_due_date_notifications()

    assert sent == (["Card"] if today_selected else [])
