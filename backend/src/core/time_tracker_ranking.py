#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Nightly rebuild of the time tracker's per-user board and list usage ranking.

The time tracker's card picker lists the boards and lists a user tracks time
on most often first. That ranking lives in TimeTrackerBoardUsage and
TimeTrackerListUsage, which this job empties and refills from the time
entries of the last USAGE_WINDOW_DAYS days, every night at 02:00 (wired up
in src.core.scheduler) — so the ranking follows recent work and old habits
fade out. Everything is per user: each user's ranking is counted from their
own entries only.

Entries only count when their board or list still exists: the usage tables
have foreign keys to them, and a ranking row for something deleted would
have nothing to rank anyway.

Like the notification job, this runs on its own AsyncSessionLocal session
rather than a request-scoped one.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, exists, func, insert, literal, select

from src.core.database import AsyncSessionLocal
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.time_entry import TimeEntry
from src.model.time_tracker_board_usage import TimeTrackerBoardUsage
from src.model.time_tracker_list_usage import TimeTrackerListUsage

logger = logging.getLogger(__name__)

USAGE_WINDOW_DAYS = 90


async def rebuild_time_tracker_ranking() -> None:
    """Replace every user's board and list usage counts with fresh ones.

    One transaction: the old ranking stays visible until the new one is
    committed, and a failure leaves the old one in place.
    """
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=USAGE_WINDOW_DAYS)

    board_counts = (
        select(TimeEntry.user_id, TimeEntry.board_id, func.count(), literal(now))
        .join(Board, Board.id == TimeEntry.board_id)
        .where(TimeEntry.started_at >= since)
        .group_by(TimeEntry.user_id, TimeEntry.board_id)
    )
    list_counts = (
        select(TimeEntry.user_id, TimeEntry.list_id, func.count(), literal(now))
        .join(BoardList, BoardList.id == TimeEntry.list_id)
        .where(TimeEntry.started_at >= since)
        .group_by(TimeEntry.user_id, TimeEntry.list_id)
    )

    async with AsyncSessionLocal() as db:
        await db.execute(delete(TimeTrackerBoardUsage))
        await db.execute(delete(TimeTrackerListUsage))
        await db.execute(
            insert(TimeTrackerBoardUsage).from_select(
                ["user_id", "board_id", "usage_count", "computed_at"], board_counts
            )
        )
        await db.execute(
            insert(TimeTrackerListUsage).from_select(
                ["user_id", "list_id", "usage_count", "computed_at"], list_counts
            )
        )
        await db.commit()


async def ensure_time_tracker_ranking() -> None:
    """Build the ranking now if it has never been built.

    Run once when the app starts, so a fresh deploy (or a database restored
    without these tables' rows) doesn't have to wait for the next 02:00.
    Checks the board table only: the list ranking is always rebuilt with it.
    """
    async with AsyncSessionLocal() as db:
        built = await db.scalar(select(exists().select_from(TimeTrackerBoardUsage)))
    if not built:
        logger.info("Time tracker usage ranking is empty; building it now")
        await rebuild_time_tracker_ranking()
