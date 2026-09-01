#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.time_entry import TimeEntry
from src.model.user import User
from src.schemas.time_entry import (
    TimeEntryCreate,
    TimeEntryRead,
    TimeEntryStart,
    TimeEntryUpdate,
)

router = APIRouter()

# A new task started within this long of the previous one ending takes that
# end as its start instead of the current time. Stopping one task and picking
# the next off a dialog takes a moment, and the minute can turn while you do
# it — a gap of a minute or two is an artefact of the clicking, not of the
# work, so it's closed rather than recorded.
_START_SNAP_WINDOW = timedelta(minutes=5)


async def _card_snapshot(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> tuple[str, str, list[dict[str, str]]]:
    """Copy the board name, card name and labels off a card the user can see.

    The copy is the whole point: what comes back is stored on the entry as
    plain values, so the entry keeps describing the work even after the card
    is renamed, relabelled, archived or deleted.
    """
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != user.id:
        share = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == user.id,
            )
        )
        if share.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    result = await db.execute(
        select(Card)
        .options(selectinload(Card.labels))
        .join(BoardList, Card.list_id == BoardList.id)
        .where(
            Card.id == card_id,
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
            BoardList.board_id == board_id,
            BoardList.is_deleted.is_(False),
        )
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")

    labels = [{"name": label.name, "color": label.color} for label in card.labels]
    return board.name, card.name, labels


async def _get_own_entry(entry_id: uuid.UUID, user: User, db: AsyncSession) -> TimeEntry:
    """Fetch one of the caller's own entries.

    Someone else's entry is reported as missing rather than forbidden —
    time entries are private, so their existence isn't disclosed either.
    """
    result = await db.execute(
        select(TimeEntry).where(TimeEntry.id == entry_id, TimeEntry.user_id == user.id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    return entry


async def _start_time_for(user: User, db: AsyncSession) -> datetime:
    """When a task starting now should be recorded as having started.

    Normally now — but if the user's last task ended no more than
    ``_START_SNAP_WINDOW`` ago, that end time, so the two meet exactly and no
    phantom gap is left between them. A previous end in the *future* (from a
    manually entered entry) is left alone: the entry it would produce would
    start before it was created.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(TimeEntry.ended_at)
        .where(TimeEntry.user_id == user.id, TimeEntry.ended_at.is_not(None))
        .order_by(TimeEntry.ended_at.desc())
        .limit(1)
    )
    previous_end = result.scalar_one_or_none()
    if previous_end is not None and timedelta(0) <= now - previous_end <= _START_SNAP_WINDOW:
        return previous_end
    return now


async def _get_running(user: User, db: AsyncSession) -> TimeEntry | None:
    result = await db.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.ended_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


@router.get("", response_model=list[TimeEntryRead])
async def list_time_entries(
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TimeEntryRead]:
    """Return the caller's time entries, most recently started first.

    ``from``/``to`` are instants (the frontend turns the year/month filters
    into a half-open range in the viewer's own timezone, so no timezone
    guessing happens here). The running entry is always included, whatever
    the filter: it belongs to the bar at the top of the page, not to the
    filtered table.
    """
    stmt = select(TimeEntry).where(TimeEntry.user_id == current_user.id)
    if date_from is not None:
        stmt = stmt.where(TimeEntry.started_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(TimeEntry.started_at < date_to)
    result = await db.execute(stmt.order_by(TimeEntry.started_at.desc()))
    entries = list(result.scalars().all())

    if date_from is not None or date_to is not None:
        running = await _get_running(current_user, db)
        if running is not None and all(e.id != running.id for e in entries):
            entries.insert(0, running)

    return [TimeEntryRead.model_validate(e) for e in entries]


@router.get("/running", response_model=TimeEntryRead | None)
async def get_running_time_entry(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryRead | None:
    """Return the entry currently being tracked, or null if none is."""
    running = await _get_running(current_user, db)
    return TimeEntryRead.model_validate(running) if running is not None else None


@router.get("/years", response_model=list[int])
async def list_time_entry_years(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[int]:
    """Return the years the caller has entries in, newest first.

    Feeds the year filter, so it only ever offers years that hold something.
    """
    result = await db.execute(
        select(extract("year", TimeEntry.started_at))
        .where(TimeEntry.user_id == current_user.id)
        .distinct()
    )
    return sorted((int(y) for y in result.scalars().all()), reverse=True)


@router.post("/start", response_model=TimeEntryRead, status_code=status.HTTP_201_CREATED)
async def start_time_entry(
    body: TimeEntryStart,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryRead:
    """Start tracking work on a card, from now.

    Refused while another entry is still running: the previous one has to be
    ended deliberately, so a stray click can't silently close it.

    The start is snapped back to the previous task's end when that was only
    moments ago — see :func:`_start_time_for`.
    """
    if await _get_running(current_user, db) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another time entry is already running.",
        )

    board_name, card_name, labels = await _card_snapshot(
        body.board_id, body.list_id, body.card_id, current_user, db
    )
    entry = TimeEntry(
        user_id=current_user.id,
        started_at=await _start_time_for(current_user, db),
        ended_at=None,
        board_name=board_name,
        card_name=card_name,
        labels=labels,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return TimeEntryRead.model_validate(entry)


@router.post("/{entry_id}/stop", response_model=TimeEntryRead)
async def stop_time_entry(
    entry_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryRead:
    """Stop the running entry, ending it now."""
    entry = await _get_own_entry(entry_id, current_user, db)
    if entry.ended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This time entry has already ended.",
        )
    entry.ended_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(entry)
    return TimeEntryRead.model_validate(entry)


@router.post("", response_model=TimeEntryRead, status_code=status.HTTP_201_CREATED)
async def create_time_entry(
    body: TimeEntryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryRead:
    """Record a stretch of work that wasn't tracked live."""
    board_name, card_name, labels = await _card_snapshot(
        body.board_id, body.list_id, body.card_id, current_user, db
    )
    entry = TimeEntry(
        user_id=current_user.id,
        started_at=body.started_at,
        ended_at=body.ended_at,
        board_name=board_name,
        card_name=card_name,
        labels=labels,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return TimeEntryRead.model_validate(entry)


@router.patch("/{entry_id}", response_model=TimeEntryRead)
async def update_time_entry(
    entry_id: uuid.UUID,
    body: TimeEntryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryRead:
    """Edit a recorded entry.

    Naming a card re-copies the snapshot from it (labels included); the
    snapshot text can also be edited on its own, which is the only way to
    fix an entry whose card no longer exists.
    """
    entry = await _get_own_entry(entry_id, current_user, db)

    # Validated before anything is assigned: a rejected edit must leave the
    # entry — and the session — exactly as it was, not carry a bad value that
    # a later flush would try to write.
    started_at = body.started_at if body.started_at is not None else entry.started_at
    ended_at = body.ended_at if body.ended_at is not None else entry.ended_at
    if ended_at is not None and ended_at <= started_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="End time must be after start time.",
        )

    if body.card_id is not None and body.list_id is not None and body.board_id is not None:
        entry.board_name, entry.card_name, entry.labels = await _card_snapshot(
            body.board_id, body.list_id, body.card_id, current_user, db
        )
    if body.board_name is not None:
        entry.board_name = body.board_name
    if body.card_name is not None:
        entry.card_name = body.card_name
    entry.started_at = started_at
    entry.ended_at = ended_at

    await db.commit()
    await db.refresh(entry)
    return TimeEntryRead.model_validate(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_time_entry(
    entry_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a time entry outright — there is no archive for these."""
    entry = await _get_own_entry(entry_id, current_user, db)
    await db.delete(entry)
    await db.commit()
