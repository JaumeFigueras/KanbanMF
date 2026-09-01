#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the /api/v1/time-entries endpoints."""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete as sqlalchemy_delete, select

from src.model.board import Board
from src.model.board_list import BoardList
from src.model.card import Card
from src.model.label import Label
from src.model.time_entry import TimeEntry
from src.model.user import User


@pytest_asyncio.fixture
async def tracked_card(db_session_async, test_user: User) -> Card:
    """A labelled card on a board owned by test_user, to track time against."""
    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add(board)
    await db_session_async.flush()

    board_list = BoardList(board_id=board.id, name="List")
    label = Label(board_id=board.id, name="Urgent", color="#ff0000", position=0)
    db_session_async.add_all([board_list, label])
    await db_session_async.flush()

    card = Card(list_id=board_list.id, creator_id=test_user.id, name="Card", labels=[label])
    db_session_async.add(card)
    await db_session_async.commit()
    await db_session_async.refresh(card)
    return card


def _start_body(card: Card, board_id, list_id) -> dict:
    return {
        "board_id": str(board_id),
        "list_id": str(list_id),
        "card_id": str(card.id),
    }


async def _ids(db_session_async, card: Card) -> tuple:
    result = await db_session_async.execute(
        select(BoardList).where(BoardList.id == card.list_id)
    )
    board_list = result.scalar_one()
    return board_list.board_id, board_list.id


@pytest.mark.asyncio
async def test_time_entries_01(
    client, db_session_async, tracked_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify POST /start copies the board name, card name and labels onto the
    entry, and that the copy survives renaming and relabelling the card.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session used to mutate the card behind the API's back.
    tracked_card : Card
        The card being tracked.
    auth_headers : dict[str, str]
        Bearer token header for the card's owner.
    """
    board_id, list_id = await _ids(db_session_async, tracked_card)
    r = await client.post(
        "/api/v1/time-entries/start",
        json=_start_body(tracked_card, board_id, list_id),
        headers=auth_headers,
    )
    assert r.status_code == 201
    entry = r.json()
    assert entry["board_name"] == "Board"
    assert entry["card_name"] == "Card"
    assert entry["labels"] == [{"name": "Urgent", "color": "#ff0000"}]
    assert entry["ended_at"] is None

    # The snapshot is a copy: changing the card must not change the record.
    tracked_card.name = "Renamed"
    tracked_card.labels = []
    await db_session_async.commit()

    r = await client.get("/api/v1/time-entries", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()[0]["card_name"] == "Card"
    assert r.json()[0]["labels"] == [{"name": "Urgent", "color": "#ff0000"}]


@pytest.mark.asyncio
async def test_time_entries_02(
    client, db_session_async, tracked_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify a second /start is refused while one entry is still running, and
    that stopping the first one frees the slot.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session used to resolve the card's board and list ids.
    tracked_card : Card
        The card being tracked.
    auth_headers : dict[str, str]
        Bearer token header for the card's owner.
    """
    board_id, list_id = await _ids(db_session_async, tracked_card)
    body = _start_body(tracked_card, board_id, list_id)

    first = await client.post("/api/v1/time-entries/start", json=body, headers=auth_headers)
    assert first.status_code == 201

    second = await client.post("/api/v1/time-entries/start", json=body, headers=auth_headers)
    assert second.status_code == 409

    entry_id = first.json()["id"]
    stopped = await client.post(f"/api/v1/time-entries/{entry_id}/stop", headers=auth_headers)
    assert stopped.status_code == 200
    assert stopped.json()["ended_at"] is not None

    # Already ended: stopping it again is a conflict, not a silent no-op.
    again = await client.post(f"/api/v1/time-entries/{entry_id}/stop", headers=auth_headers)
    assert again.status_code == 409

    third = await client.post("/api/v1/time-entries/start", json=body, headers=auth_headers)
    assert third.status_code == 201


@pytest.mark.asyncio
async def test_time_entries_03(
    client, db_session_async, tracked_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify a manually recorded entry is created, that end must be after
    start, and that the from/to filter bounds the listing.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session used to resolve the card's board and list ids.
    tracked_card : Card
        The card the entries are recorded against.
    auth_headers : dict[str, str]
        Bearer token header for the card's owner.
    """
    board_id, list_id = await _ids(db_session_async, tracked_card)
    body = _start_body(tracked_card, board_id, list_id)

    january = datetime(2026, 1, 10, 9, 0, tzinfo=timezone.utc)
    r = await client.post(
        "/api/v1/time-entries",
        json={**body, "started_at": january.isoformat(),
              "ended_at": (january + timedelta(hours=2)).isoformat()},
        headers=auth_headers,
    )
    assert r.status_code == 201

    february = datetime(2026, 2, 10, 9, 0, tzinfo=timezone.utc)
    r = await client.post(
        "/api/v1/time-entries",
        json={**body, "started_at": february.isoformat(),
              "ended_at": (february + timedelta(hours=1)).isoformat()},
        headers=auth_headers,
    )
    assert r.status_code == 201

    backwards = await client.post(
        "/api/v1/time-entries",
        json={**body, "started_at": february.isoformat(),
              "ended_at": january.isoformat()},
        headers=auth_headers,
    )
    assert backwards.status_code == 422

    r = await client.get(
        "/api/v1/time-entries",
        params={"from": "2026-01-01T00:00:00+00:00", "to": "2026-02-01T00:00:00+00:00"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    # Compared as instants: Postgres hands timestamptz back in the server's
    # own timezone, which need not be UTC.
    returned = [datetime.fromisoformat(e["started_at"]) for e in r.json()]
    assert returned == [january]

    r = await client.get("/api/v1/time-entries/years", headers=auth_headers)
    assert r.json() == [2026]


@pytest.mark.asyncio
async def test_time_entries_04(
    client, db_session_async, tracked_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify an entry can be edited and deleted, and that a card whose board
    the caller cannot see is refused as a snapshot source.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session used to create the other user's board.
    tracked_card : Card
        The card the entry is recorded against.
    auth_headers : dict[str, str]
        Bearer token header for the card's owner.
    """
    board_id, list_id = await _ids(db_session_async, tracked_card)
    start = datetime(2026, 3, 1, 8, 0, tzinfo=timezone.utc)
    created = await client.post(
        "/api/v1/time-entries",
        json={"board_id": str(board_id), "list_id": str(list_id), "card_id": str(tracked_card.id),
              "started_at": start.isoformat(), "ended_at": (start + timedelta(hours=1)).isoformat()},
        headers=auth_headers,
    )
    entry_id = created.json()["id"]

    # The snapshot text is editable on its own — the only way to fix an entry
    # whose card has since been deleted.
    r = await client.patch(
        f"/api/v1/time-entries/{entry_id}",
        json={"card_name": "Corrected", "ended_at": (start + timedelta(hours=3)).isoformat()},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["card_name"] == "Corrected"

    r = await client.patch(
        f"/api/v1/time-entries/{entry_id}",
        json={"ended_at": (start - timedelta(hours=1)).isoformat()},
        headers=auth_headers,
    )
    assert r.status_code == 422

    # A board the caller has no access to can't be used as a snapshot source.
    other = User(email="other@example.com", display_name="Other")
    db_session_async.add(other)
    await db_session_async.flush()
    other_board = Board(owner_id=other.id, name="Theirs")
    db_session_async.add(other_board)
    await db_session_async.flush()
    other_list = BoardList(board_id=other_board.id, name="List")
    db_session_async.add(other_list)
    await db_session_async.flush()
    other_card = Card(list_id=other_list.id, creator_id=other.id, name="Theirs")
    db_session_async.add(other_card)
    await db_session_async.commit()

    r = await client.post(
        "/api/v1/time-entries/start",
        json={"board_id": str(other_board.id), "list_id": str(other_list.id),
              "card_id": str(other_card.id)},
        headers=auth_headers,
    )
    assert r.status_code == 403

    r = await client.delete(f"/api/v1/time-entries/{entry_id}", headers=auth_headers)
    assert r.status_code == 204
    remaining = await db_session_async.execute(select(TimeEntry))
    assert remaining.scalars().all() == []


@pytest.mark.asyncio
async def test_time_entries_05(
    client, db_session_async, tracked_card: Card, auth_headers: dict[str, str]
) -> None:
    """
    Verify a task started just after the previous one ended takes that end as
    its start, so no phantom gap is left behind, and that a real break, a
    first-ever task and a future end time are all left alone.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session used to plant the preceding entry with a chosen end time.
    tracked_card : Card
        The card being tracked.
    auth_headers : dict[str, str]
        Bearer token header for the card's owner.
    """
    board_id, list_id = await _ids(db_session_async, tracked_card)
    body = _start_body(tracked_card, board_id, list_id)

    async def _previous(ended_ago: timedelta) -> datetime:
        """Replace the user's history with one entry ending `ended_ago` from now."""
        await db_session_async.execute(sqlalchemy_delete(TimeEntry))
        end = datetime.now(timezone.utc) - ended_ago
        db_session_async.add(TimeEntry(
            user_id=tracked_card.creator_id,
            started_at=end - timedelta(hours=1),
            ended_at=end,
            board_name="Board",
            card_name="Previous",
            labels=[],
        ))
        await db_session_async.commit()
        return end

    async def _start_and_stop() -> datetime:
        r = await client.post("/api/v1/time-entries/start", json=body, headers=auth_headers)
        assert r.status_code == 201
        started = datetime.fromisoformat(r.json()["started_at"])
        await client.post(f"/api/v1/time-entries/{r.json()['id']}/stop", headers=auth_headers)
        return started

    # A minute-old gap is an artefact of the clicking: closed.
    end = await _previous(timedelta(minutes=1))
    assert await _start_and_stop() == end

    # Just inside the five-minute window (not exactly on it: the clock moves
    # between planting the entry and the request, so an exact boundary test
    # would race).
    end = await _previous(timedelta(minutes=4, seconds=50))
    assert await _start_and_stop() == end

    # Just outside it: recorded as it happened.
    end = await _previous(timedelta(minutes=5, seconds=30))
    assert await _start_and_stop() > end + timedelta(minutes=5)

    # A real break is a real break.
    end = await _previous(timedelta(minutes=30))
    assert await _start_and_stop() > end + timedelta(minutes=29)

    # An entry whose end lies in the future (manually recorded) must not drag
    # the new task's start backwards — or forwards.
    end = await _previous(timedelta(minutes=-10))
    started = await _start_and_stop()
    assert started < end

    # Nothing to snap to on the very first task.
    await db_session_async.execute(sqlalchemy_delete(TimeEntry))
    await db_session_async.commit()
    before = datetime.now(timezone.utc)
    assert await _start_and_stop() >= before
