#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the nightly time tracker usage ranking job (src/core/time_tracker_ranking.py)."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core import time_tracker_ranking
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.time_entry import TimeEntry
from src.model.time_tracker_board_usage import TimeTrackerBoardUsage
from src.model.time_tracker_list_usage import TimeTrackerListUsage
from src.model.user import User


@pytest.fixture
def use_test_db(db_session_async, monkeypatch) -> None:
    """Point the job's session factory at the test database."""
    monkeypatch.setattr(
        time_tracker_ranking,
        "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )


async def _board_with_list(db, owner: User, name: str) -> tuple[Board, BoardList]:
    """Persist and return a board owned by owner with one list."""
    board = Board(owner_id=owner.id, name=name)
    db.add(board)
    await db.flush()
    board_list = BoardList(board_id=board.id, name=f"{name} list")
    db.add(board_list)
    await db.flush()
    return board, board_list


def _entry(user: User, board_id, list_id, days_ago: int) -> TimeEntry:
    """A finished one-hour entry that started `days_ago` days ago."""
    start = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return TimeEntry(
        user_id=user.id, started_at=start, ended_at=start + timedelta(hours=1),
        board_id=board_id, list_id=list_id, board_name="Board", card_name="Card", labels=[],
    )


async def _counts(db, model, column) -> dict:
    """{(user_id, board_or_list_id): usage_count} for every row of a usage table."""
    result = await db.execute(select(model.user_id, column, model.usage_count))
    return {(u, i): c for u, i, c in result.all()}


@pytest.mark.asyncio
async def test_time_tracker_ranking_01(db_session_async, test_user: User, use_test_db) -> None:
    """
    Verify the rebuild counts each user's own entries per board and per list
    within the 90-day window, and ignores entries outside it, entries with no
    board or list, and ids of boards or lists that no longer exist.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session against the test database, used to set up and read back.
    test_user : User
        One of the two users whose entries are counted.
    use_test_db : None
        Points the job at the test database.

    Raises
    ------
    AssertionError
        If any count differs from the expected per-user tallies.
    """
    other = User(email="other@example.com", display_name="Other", is_verified=True)
    db_session_async.add(other)
    await db_session_async.flush()
    work, work_list = await _board_with_list(db_session_async, test_user, "Work")
    home, home_list = await _board_with_list(db_session_async, test_user, "Home")
    gone = uuid.uuid4()

    db_session_async.add_all([
        _entry(test_user, work.id, work_list.id, 1),
        _entry(test_user, work.id, work_list.id, 89),
        _entry(test_user, work.id, None, 2),           # before list ids were recorded
        _entry(test_user, home.id, home_list.id, 3),
        _entry(test_user, home.id, home_list.id, 91),  # outside the window
        _entry(test_user, None, None, 1),              # no board recorded at all
        _entry(test_user, gone, gone, 1),              # board and list since deleted
        _entry(other, work.id, work_list.id, 1),       # someone else's usage
    ])
    await db_session_async.commit()

    await time_tracker_ranking.rebuild_time_tracker_ranking()

    assert await _counts(db_session_async, TimeTrackerBoardUsage, TimeTrackerBoardUsage.board_id) == {
        (test_user.id, work.id): 3,
        (test_user.id, home.id): 1,
        (other.id, work.id): 1,
    }
    assert await _counts(db_session_async, TimeTrackerListUsage, TimeTrackerListUsage.list_id) == {
        (test_user.id, work_list.id): 2,
        (test_user.id, home_list.id): 1,
        (other.id, work_list.id): 1,
    }


@pytest.mark.asyncio
async def test_time_tracker_ranking_02(db_session_async, test_user: User, use_test_db) -> None:
    """
    Verify a rebuild replaces the previous ranking instead of adding to it:
    stale rows disappear and counts are recomputed, not accumulated.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session against the test database, used to set up and read back.
    test_user : User
        Owner of the boards and entries.
    use_test_db : None
        Points the job at the test database.

    Raises
    ------
    AssertionError
        If a stale row survives or a count is doubled.
    """
    work, work_list = await _board_with_list(db_session_async, test_user, "Work")
    stale, _ = await _board_with_list(db_session_async, test_user, "Stale")
    db_session_async.add(_entry(test_user, work.id, work_list.id, 1))
    db_session_async.add(TimeTrackerBoardUsage(
        user_id=test_user.id, board_id=stale.id, usage_count=50, computed_at=datetime.now(timezone.utc),
    ))
    await db_session_async.commit()

    await time_tracker_ranking.rebuild_time_tracker_ranking()
    await time_tracker_ranking.rebuild_time_tracker_ranking()

    assert await _counts(db_session_async, TimeTrackerBoardUsage, TimeTrackerBoardUsage.board_id) == {
        (test_user.id, work.id): 1,
    }


@pytest.mark.asyncio
async def test_time_tracker_ranking_03(db_session_async, test_user: User, use_test_db) -> None:
    """
    Verify the startup check builds the ranking when it's empty and leaves an
    existing ranking alone until the nightly rebuild.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session against the test database, used to set up and read back.
    test_user : User
        Owner of the board and entries.
    use_test_db : None
        Points the job at the test database.

    Raises
    ------
    AssertionError
        If the empty ranking isn't built, or a built one is rebuilt.
    """
    work, work_list = await _board_with_list(db_session_async, test_user, "Work")
    db_session_async.add(_entry(test_user, work.id, work_list.id, 1))
    await db_session_async.commit()

    await time_tracker_ranking.ensure_time_tracker_ranking()
    built = {(test_user.id, work.id): 1}
    assert await _counts(db_session_async, TimeTrackerBoardUsage, TimeTrackerBoardUsage.board_id) == built

    # A new entry only shows up after the next full rebuild, not on another
    # startup check.
    db_session_async.add(_entry(test_user, work.id, work_list.id, 2))
    await db_session_async.commit()
    await time_tracker_ranking.ensure_time_tracker_ranking()
    assert await _counts(db_session_async, TimeTrackerBoardUsage, TimeTrackerBoardUsage.board_id) == built
