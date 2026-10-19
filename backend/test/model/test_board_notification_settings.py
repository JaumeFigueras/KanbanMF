#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the BoardNotificationSettings ORM model, covering the notify_weekdays default and constraint."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.model.board import Board
from src.model.board_notification_settings import BoardNotificationSettings
from src.model.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_board(db_session: Session) -> Board:
    """Persist and return a board with its owner."""
    owner = User(email="owner@example.com", display_name="Owner")
    db_session.add(owner)
    db_session.flush()
    board = Board(owner_id=owner.id, name="Board")
    db_session.add(board)
    db_session.commit()
    return board


# ---------------------------------------------------------------------------
# 01 – ORM default is Monday-Friday
# ---------------------------------------------------------------------------

def test_board_notification_settings_01(db_session: Session) -> None:
    """
    Verify a settings row created through the ORM without notify_weekdays
    gets Monday-Friday (bitmask 31).

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If notify_weekdays is not 31 after commit.
    """
    board = _make_board(db_session)
    settings = BoardNotificationSettings(board_id=board.id, user_id=board.owner_id)
    db_session.add(settings)
    db_session.commit()
    db_session.refresh(settings)
    assert settings.notify_weekdays == 31


# ---------------------------------------------------------------------------
# 02 – Server-side default is Monday-Friday
# ---------------------------------------------------------------------------

def test_board_notification_settings_02(db_session: Session) -> None:
    """
    Verify a row inserted with raw SQL that omits notify_weekdays gets the
    database-level default of Monday-Friday (bitmask 31).

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the stored notify_weekdays is not 31.
    """
    board = _make_board(db_session)
    db_session.execute(
        text("INSERT INTO board_notification_settings (board_id, user_id) VALUES (:b, :u)"),
        {"b": board.id, "u": board.owner_id},
    )
    db_session.commit()
    value = db_session.execute(
        text("SELECT notify_weekdays FROM board_notification_settings WHERE board_id = :b"),
        {"b": board.id},
    ).scalar_one()
    assert value == 31


# ---------------------------------------------------------------------------
# 03 – Boundary values 1 (Monday only) and 127 (every day) are accepted
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("weekdays", [1, 127])
def test_board_notification_settings_03(db_session: Session, weekdays: int) -> None:
    """
    Verify notify_weekdays accepts the smallest (1) and largest (127) valid masks.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.
    weekdays : int
        Bitmask to store.

    Raises
    ------
    AssertionError
        If the stored value differs from the one written.
    """
    board = _make_board(db_session)
    settings = BoardNotificationSettings(board_id=board.id, user_id=board.owner_id, notify_weekdays=weekdays)
    db_session.add(settings)
    db_session.commit()
    db_session.refresh(settings)
    assert settings.notify_weekdays == weekdays


# ---------------------------------------------------------------------------
# 04 – No days selected (0) or out-of-range masks are rejected
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("weekdays", [0, 128, -1])
def test_board_notification_settings_04(db_session: Session, weekdays: int) -> None:
    """
    Verify the CHECK constraint rejects an empty selection and masks outside 1..127.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.
    weekdays : int
        Invalid bitmask to store.

    Raises
    ------
    AssertionError
        If the insert does not raise an IntegrityError.
    """
    board = _make_board(db_session)
    db_session.add(BoardNotificationSettings(board_id=board.id, user_id=board.owner_id, notify_weekdays=weekdays))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
