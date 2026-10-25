#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests that the read-only debugging user, ``kanbanmf_remoteuser``, can read
the data but not the tables holding credentials — both as the schema files
grant it and with the production recipe in SETUP.md."""

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.model import Base

CREDENTIAL_TABLES = {"user_identities", "user_sessions", "oauth_tokens", "oauth_authorization_codes"}


def _unreadable(db_session: Session) -> set[str]:
    """The tables of the schema the remote user can't SELECT from."""
    tables = db_session.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).scalars().all()
    return {
        table for table in tables
        if not db_session.execute(
            text("SELECT has_table_privilege('kanbanmf_remoteuser', :table, 'SELECT')"), {"table": f"public.{table}"}
        ).scalar()
    }


def test_remote_user_01(db_session: Session) -> None:
    """
    Verify the schema files grant the remote user SELECT on every table but
    the four that hold credentials.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If a credential table is readable, or another table isn't.
    """
    assert _unreadable(db_session) == CREDENTIAL_TABLES
    assert CREDENTIAL_TABLES <= set(Base.metadata.tables)


def test_remote_user_02(db_session: Session) -> None:
    """
    Verify the GRANT/REVOKE recipe in SETUP.md, run on a database where the
    remote user can read nothing yet, gives the same result.

    Parameters
    ----------
    db_session : Session
        SQLAlchemy session connected to a clean test database.

    Raises
    ------
    AssertionError
        If the recipe leaves a credential table readable, or another table
        unreadable.
    """
    db_session.execute(text("REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM kanbanmf_remoteuser"))
    assert _unreadable(db_session) == set(Base.metadata.tables)

    db_session.execute(text("GRANT CONNECT ON DATABASE test TO kanbanmf_remoteuser"))
    db_session.execute(text("GRANT USAGE ON SCHEMA public TO kanbanmf_remoteuser"))
    db_session.execute(text("GRANT SELECT ON ALL TABLES IN SCHEMA public TO kanbanmf_remoteuser"))
    db_session.execute(text(
        "REVOKE SELECT ON user_identities, user_sessions, oauth_tokens, oauth_authorization_codes "
        "FROM kanbanmf_remoteuser"
    ))
    assert _unreadable(db_session) == CREDENTIAL_TABLES
    db_session.rollback()
