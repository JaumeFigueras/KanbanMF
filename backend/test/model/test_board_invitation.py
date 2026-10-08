#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the BoardInvitation ORM model, covering defaults and constraints."""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.model.board import Board
from src.model.board_invitation import INVITATION_TTL, BoardInvitation
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


def _make_invitation(board: Board, **kwargs) -> BoardInvitation:
    """Return a transient BoardInvitation with sensible defaults, overridden by kwargs."""
    defaults = dict(
        board_id=board.id,
        email="guest@example.com",
        invited_by_id=board.owner_id,
        language="en",
    )
    defaults.update(kwargs)
    return BoardInvitation(**defaults)


# ---------------------------------------------------------------------------
# 01 – Table is empty at fixture start
# ---------------------------------------------------------------------------

def test_board_invitation_01(db_session: Session) -> None:
    """
    Verify the board_invitations table starts empty for every test function.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the board_invitations table is not empty at test start.
    """
    assert db_session.query(BoardInvitation).count() == 0


# ---------------------------------------------------------------------------
# 02 – Minimal creation fills id, token, created_at and expires_at
# ---------------------------------------------------------------------------

def test_board_invitation_02(db_session: Session) -> None:
    """
    Verify an invitation persists with only the required fields and gets a
    UUID, a random token and a 30-day expiry by default.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If any default is missing or the expiry isn't INVITATION_TTL ahead.
    """
    board = _make_board(db_session)
    before = datetime.now(timezone.utc)
    invitation = _make_invitation(board)
    db_session.add(invitation)
    db_session.commit()
    db_session.refresh(invitation)
    after = datetime.now(timezone.utc)

    assert isinstance(invitation.id, uuid.UUID)
    assert invitation.token and len(invitation.token) >= 32
    assert invitation.created_at is not None
    assert before + INVITATION_TTL <= invitation.expires_at <= after + INVITATION_TTL


# ---------------------------------------------------------------------------
# 03 – Tokens are unique per invitation
# ---------------------------------------------------------------------------

def test_board_invitation_03(db_session: Session) -> None:
    """
    Verify two invitations get different tokens, and a reused token is rejected.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If generated tokens collide or a duplicate token is accepted.
    """
    board = _make_board(db_session)
    first = _make_invitation(board, email="a@example.com")
    second = _make_invitation(board, email="b@example.com")
    db_session.add_all([first, second])
    db_session.commit()
    assert first.token != second.token

    db_session.add(_make_invitation(board, email="c@example.com", token=first.token))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---------------------------------------------------------------------------
# 04 – One invitation per (board, email)
# ---------------------------------------------------------------------------

def test_board_invitation_04(db_session: Session) -> None:
    """
    Verify the same e-mail can't be invited twice to the same board.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the duplicate insert does not raise an IntegrityError.
    """
    board = _make_board(db_session)
    db_session.add(_make_invitation(board))
    db_session.commit()
    db_session.add(_make_invitation(board))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---------------------------------------------------------------------------
# 05 – The same e-mail can be invited to different boards
# ---------------------------------------------------------------------------

def test_board_invitation_05(db_session: Session) -> None:
    """
    Verify the (board, email) uniqueness doesn't block inviting one address
    to several boards.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the second board's invitation can't be stored.
    """
    board = _make_board(db_session)
    other = Board(owner_id=board.owner_id, name="Other")
    db_session.add(other)
    db_session.commit()
    db_session.add_all([_make_invitation(board), _make_invitation(other)])
    db_session.commit()
    assert db_session.query(BoardInvitation).count() == 2


# ---------------------------------------------------------------------------
# 06 – E-mail must be stored lowercase
# ---------------------------------------------------------------------------

def test_board_invitation_06(db_session: Session) -> None:
    """
    Verify the CHECK constraint rejects an e-mail with uppercase letters, so
    duplicates differing only in case can't slip past the unique constraint.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If a mixed-case e-mail is accepted.
    """
    board = _make_board(db_session)
    db_session.add(_make_invitation(board, email="Guest@Example.com"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---------------------------------------------------------------------------
# 07 – Deleting the board deletes its invitations
# ---------------------------------------------------------------------------

def test_board_invitation_07(db_session: Session) -> None:
    """
    Verify invitations are removed together with their board.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If an invitation outlives its board.
    """
    board = _make_board(db_session)
    db_session.add(_make_invitation(board))
    db_session.commit()
    db_session.delete(board)
    db_session.commit()
    assert db_session.query(BoardInvitation).count() == 0


# ---------------------------------------------------------------------------
# 08 – Deleting the inviter deletes their invitations
# ---------------------------------------------------------------------------

def test_board_invitation_08(db_session: Session) -> None:
    """
    Verify invitations are removed when the inviting user is deleted.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If an invitation outlives its inviter.
    """
    board = _make_board(db_session)
    db_session.add(_make_invitation(board))
    db_session.commit()
    owner = db_session.get(User, board.owner_id)
    db_session.delete(owner)
    db_session.commit()
    assert db_session.query(BoardInvitation).count() == 0


# ---------------------------------------------------------------------------
# 09 – Required fields can't be NULL
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field", ["board_id", "email", "invited_by_id", "language"])
def test_board_invitation_09(db_session: Session, field: str) -> None:
    """
    Verify each required column rejects NULL.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.
    field : str
        Name of the column set to None.

    Raises
    ------
    AssertionError
        If the insert with a NULL required column succeeds.
    """
    board = _make_board(db_session)
    db_session.add(_make_invitation(board, **{field: None}))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
