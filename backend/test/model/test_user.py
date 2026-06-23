#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the User ORM model, covering all valid states and constraints."""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete as sql_delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.model.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(**kwargs) -> User:
    """Return a transient User with sensible defaults, overridden by kwargs."""
    defaults = dict(
        email="user@example.com",
        display_name="Test User",
    )
    defaults.update(kwargs)
    return User(**defaults)


# ---------------------------------------------------------------------------
# 01 – Table is empty at fixture start
# ---------------------------------------------------------------------------

def test_user_01(db_session: Session) -> None:
    """
    Verify the users table starts empty for every test function.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the users table is not empty at test start.
    """
    assert db_session.query(User).count() == 0


# ---------------------------------------------------------------------------
# 02 – Minimal creation: only required fields
# ---------------------------------------------------------------------------

def test_user_02(db_session: Session) -> None:
    """
    Verify a User can be persisted with only the two required fields.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the user cannot be added or retrieved.
    """
    user = _make_user()
    db_session.add(user)
    db_session.commit()
    assert db_session.query(User).count() == 1


# ---------------------------------------------------------------------------
# 03 – Auto-generated UUID primary key
# ---------------------------------------------------------------------------

def test_user_03(db_session: Session) -> None:
    """
    Verify that a UUID primary key is auto-assigned on insert.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the id is None after commit or is not a valid UUID.
    """
    user = _make_user()
    db_session.add(user)
    db_session.commit()
    assert user.id is not None
    assert isinstance(user.id, uuid.UUID)


# ---------------------------------------------------------------------------
# 04 – Default state: active and unverified (newly registered local user)
# ---------------------------------------------------------------------------

def test_user_04(db_session: Session) -> None:
    """
    Verify the default state is active=True and is_verified=False.

    This is the expected state of a user who has just registered via the local
    provider and has not yet confirmed their email address.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If defaults differ from the expected values.
    """
    user = _make_user()
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.is_active is True
    assert user.is_verified is False


# ---------------------------------------------------------------------------
# 05 – State: active and verified (local user who confirmed email / OAuth user)
# ---------------------------------------------------------------------------

def test_user_05(db_session: Session) -> None:
    """
    Verify a user can be persisted in the active + verified state.

    This is the normal state of a fully onboarded user (email confirmed or
    signed in via Google OAuth, which auto-verifies).

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the stored flags do not match.
    """
    user = _make_user(is_active=True, is_verified=True)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.is_active is True
    assert user.is_verified is True


# ---------------------------------------------------------------------------
# 06 – State: inactive and verified (account deactivated after verification)
# ---------------------------------------------------------------------------

def test_user_06(db_session: Session) -> None:
    """
    Verify a user can be persisted in the inactive + verified state.

    This represents an account that was previously active and email-verified
    but has since been deactivated (e.g., by an admin or on user request).

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the stored flags do not match.
    """
    user = _make_user(is_active=False, is_verified=True)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.is_active is False
    assert user.is_verified is True


# ---------------------------------------------------------------------------
# 07 – State: inactive and unverified (deactivated before email confirmation)
# ---------------------------------------------------------------------------

def test_user_07(db_session: Session) -> None:
    """
    Verify a user can be persisted in the inactive + unverified state.

    This is an edge case where a user was deactivated before completing email
    verification (e.g., spam detection during sign-up).

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the stored flags do not match.
    """
    user = _make_user(is_active=False, is_verified=False)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.is_active is False
    assert user.is_verified is False


# ---------------------------------------------------------------------------
# 08 – Timestamps are populated by the database on insert
# ---------------------------------------------------------------------------

def test_user_08(db_session: Session) -> None:
    """
    Verify that created_at and updated_at are set by the server on insert.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If either timestamp is None or not a datetime after commit.
    """
    user = _make_user()
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert isinstance(user.created_at, datetime)
    assert isinstance(user.updated_at, datetime)


# ---------------------------------------------------------------------------
# 09 – Email uniqueness constraint
# ---------------------------------------------------------------------------

def test_user_09(db_session: Session) -> None:
    """
    Verify that inserting two users with the same email raises IntegrityError.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the duplicate insert does not raise an IntegrityError.
    """
    db_session.add(_make_user(email="dup@example.com"))
    db_session.commit()
    db_session.add(_make_user(email="dup@example.com", display_name="Other"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---------------------------------------------------------------------------
# 10 – Multiple users with distinct emails
# ---------------------------------------------------------------------------

def test_user_10(db_session: Session) -> None:
    """
    Verify that multiple users can coexist when each has a unique email.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the count of stored users does not equal the number inserted.
    """
    emails = ["alice@example.com", "bob@example.com", "carol@example.com"]
    for email in emails:
        db_session.add(_make_user(email=email, display_name=email.split("@")[0].capitalize()))
    db_session.commit()
    assert db_session.query(User).count() == len(emails)


# ---------------------------------------------------------------------------
# 11 – Retrieve by email
# ---------------------------------------------------------------------------

def test_user_11(db_session: Session) -> None:
    """
    Verify a user can be queried by their unique email address.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the retrieved user is None or has an unexpected display_name.
    """
    db_session.add(_make_user(email="find@example.com", display_name="Find Me"))
    db_session.commit()
    found = db_session.query(User).filter_by(email="find@example.com").one_or_none()
    assert found is not None
    assert found.display_name == "Find Me"


# ---------------------------------------------------------------------------
# 12 – Retrieve by id
# ---------------------------------------------------------------------------

def test_user_12(db_session: Session) -> None:
    """
    Verify a user can be retrieved by their UUID primary key.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the retrieved user is None or the email does not match.
    """
    user = _make_user(email="byid@example.com")
    db_session.add(user)
    db_session.commit()
    retrieved = db_session.get(User, user.id)
    assert retrieved is not None
    assert retrieved.email == "byid@example.com"


# ---------------------------------------------------------------------------
# 13 – Update email
# ---------------------------------------------------------------------------

def test_user_13(db_session: Session) -> None:
    """
    Verify that a user's email can be updated and the change is persisted.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the email in the database does not reflect the update.
    """
    user = _make_user(email="old@example.com")
    db_session.add(user)
    db_session.commit()
    user.email = "new@example.com"
    db_session.commit()
    db_session.refresh(user)
    assert user.email == "new@example.com"


# ---------------------------------------------------------------------------
# 14 – Update display_name
# ---------------------------------------------------------------------------

def test_user_14(db_session: Session) -> None:
    """
    Verify that a user's display_name can be updated and persisted.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the display_name in the database does not reflect the update.
    """
    user = _make_user()
    db_session.add(user)
    db_session.commit()
    user.display_name = "Updated Name"
    db_session.commit()
    db_session.refresh(user)
    assert user.display_name == "Updated Name"


# ---------------------------------------------------------------------------
# 15 – Deactivate a user (is_active False)
# ---------------------------------------------------------------------------

def test_user_15(db_session: Session) -> None:
    """
    Verify that a user account can be deactivated by setting is_active=False.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If is_active is not False after the update is committed.
    """
    user = _make_user(is_active=True)
    db_session.add(user)
    db_session.commit()
    user.is_active = False
    db_session.commit()
    db_session.refresh(user)
    assert user.is_active is False


# ---------------------------------------------------------------------------
# 16 – Verify a user (is_verified True)
# ---------------------------------------------------------------------------

def test_user_16(db_session: Session) -> None:
    """
    Verify that is_verified can be set to True after initial creation.

    This simulates the email verification step for a local account.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If is_verified is not True after the update is committed.
    """
    user = _make_user(is_verified=False)
    db_session.add(user)
    db_session.commit()
    user.is_verified = True
    db_session.commit()
    db_session.refresh(user)
    assert user.is_verified is True


# ---------------------------------------------------------------------------
# 17 – Re-unverify after email change
# ---------------------------------------------------------------------------

def test_user_17(db_session: Session) -> None:
    """
    Verify that is_verified can be reset to False after an email change.

    When a local user changes their email address, the verification flag must
    be cleared and they must re-verify the new address.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If is_verified is not False after being reset.
    """
    user = _make_user(is_verified=True)
    db_session.add(user)
    db_session.commit()
    user.email = "newemail@example.com"
    user.is_verified = False
    db_session.commit()
    db_session.refresh(user)
    assert user.is_verified is False
    assert user.email == "newemail@example.com"


# ---------------------------------------------------------------------------
# 18 – Delete a user
# ---------------------------------------------------------------------------

def test_user_18(db_session: Session) -> None:
    """
    Verify that a user row can be deleted from the database.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the user is still present in the database after deletion.
    """
    user = _make_user()
    db_session.add(user)
    db_session.commit()
    # Use a direct DELETE to avoid ORM cascade loading related tables
    # that are not present in the single-table test fixture.
    db_session.execute(sql_delete(User).where(User.id == user.id))
    db_session.commit()
    assert db_session.query(User).count() == 0


# ---------------------------------------------------------------------------
# 19 – __repr__ format
# ---------------------------------------------------------------------------

def test_user_19(db_session: Session) -> None:
    """
    Verify the __repr__ string contains the id and email of the user.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the repr string does not contain the expected substrings.
    """
    user = _make_user(email="repr@example.com")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    r = repr(user)
    assert "repr@example.com" in r
    assert str(user.id) in r


# ---------------------------------------------------------------------------
# 20 – id is unique across multiple users
# ---------------------------------------------------------------------------

def test_user_20(db_session: Session) -> None:
    """
    Verify that each user receives a distinct UUID primary key.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If any two users share the same id.
    """
    users = [
        _make_user(email=f"unique{i}@example.com", display_name=f"User {i}")
        for i in range(5)
    ]
    for u in users:
        db_session.add(u)
    db_session.commit()
    ids = [u.id for u in db_session.query(User).all()]
    assert len(ids) == len(set(ids))
