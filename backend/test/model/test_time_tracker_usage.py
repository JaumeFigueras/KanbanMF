#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the TimeTrackerBoardUsage and TimeTrackerListUsage ORM models."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.model.board import Board
from src.model.board_list import BoardList
from src.model.time_tracker_board_usage import TimeTrackerBoardUsage
from src.model.time_tracker_list_usage import TimeTrackerListUsage
from src.model.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_board_with_list(db_session: Session) -> tuple[Board, BoardList]:
    """Persist and return a board, with its owner, and one list on it."""
    owner = User(email="owner@example.com", display_name="Owner")
    db_session.add(owner)
    db_session.flush()
    board = Board(owner_id=owner.id, name="Board")
    db_session.add(board)
    db_session.flush()
    board_list = BoardList(board_id=board.id, name="List")
    db_session.add(board_list)
    db_session.commit()
    return board, board_list


def _usages(board: Board, board_list: BoardList) -> tuple[TimeTrackerBoardUsage, TimeTrackerListUsage]:
    """Return transient board and list usage rows for the board's owner."""
    now = datetime.now(timezone.utc)
    return (
        TimeTrackerBoardUsage(user_id=board.owner_id, board_id=board.id, usage_count=3, computed_at=now),
        TimeTrackerListUsage(user_id=board.owner_id, list_id=board_list.id, usage_count=2, computed_at=now),
    )


# ---------------------------------------------------------------------------
# 01 – Rows persist with their counts
# ---------------------------------------------------------------------------

def test_time_tracker_usage_01(db_session: Session) -> None:
    """
    Verify a board and a list usage row persist with their counts.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the stored counts differ from the ones written.
    """
    board, board_list = _make_board_with_list(db_session)
    db_session.add_all(_usages(board, board_list))
    db_session.commit()
    assert db_session.get(TimeTrackerBoardUsage, (board.owner_id, board.id)).usage_count == 3
    assert db_session.get(TimeTrackerListUsage, (board.owner_id, board_list.id)).usage_count == 2


# ---------------------------------------------------------------------------
# 02 – One row per (user, board) and per (user, list)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("model_index", [0, 1])
def test_time_tracker_usage_02(db_session: Session, model_index: int) -> None:
    """
    Verify the primary key allows a single row per user and board (or list).

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.
    model_index : int
        0 for the board usage table, 1 for the list usage table.

    Raises
    ------
    AssertionError
        If the duplicate insert does not raise an IntegrityError.
    """
    board, board_list = _make_board_with_list(db_session)
    first = _usages(board, board_list)[model_index]
    duplicate = _usages(board, board_list)[model_index]
    db_session.add(first)
    db_session.commit()
    # Detached, so the session sends a second INSERT instead of merging the
    # duplicate into the row it already tracks.
    db_session.expunge(first)
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---------------------------------------------------------------------------
# 03 – Deleting the board removes its usage rows (and its lists')
# ---------------------------------------------------------------------------

def test_time_tracker_usage_03(db_session: Session) -> None:
    """
    Verify the foreign keys cascade: deleting a board drops its usage row,
    and its lists' usage rows with the lists.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If a usage row survives the board's deletion.
    """
    board, board_list = _make_board_with_list(db_session)
    db_session.add_all(_usages(board, board_list))
    db_session.commit()

    db_session.delete(board)
    db_session.commit()
    db_session.expunge_all()

    assert db_session.query(TimeTrackerBoardUsage).count() == 0
    assert db_session.query(TimeTrackerListUsage).count() == 0
