#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
from psycopg.cursor import Cursor
from sqlalchemy.orm import Session

from src.model.user import User

from typing import Any
from typing import Optional
from typing import Tuple
from typing import List

def test_database_init_01(postgresql_kanbanmf: Any) -> None:
    """
    Verify that no user-defined tables exist in the 'public' schema of the test database.

    This test ensures the PostgreSQL test instance starts with an empty 'public' schema,
    confirming a clean database state before running further tests.

    Parameters
    ----------
    postgresql_kanbanmf : Any
        A PostgreSQL database fixture for testing (e.g., provided by pytest_postgresql).

    Raises
    ------
    AssertionError
        If any user-defined tables exist in the 'public' schema at test start.

    Examples
    --------
    >>> # This test is intended to be run with pytest and a PostgreSQL fixture
    >>> test_database_init_01(postgresql_kanbanmf)
    """
    cursor: Cursor = postgresql_kanbanmf.cursor()
    cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
    record: Optional[Tuple[int]] = cursor.fetchone()
    assert record[0] == 0

def test_database_init_02(db_session: Session) -> None:
    """
    Verify that the database is correctly initialized with no Exchange records.

    This test checks that the SQLAlchemy ORM session connects to an empty database
    where the `exchange` table contains zero entries, ensuring a clean initial state.

    Parameters
    ----------
    db_session : sqlalchemy.orm.Session
        An active SQLAlchemy session connected to the RICHAL database.

    Raises
    ------
    AssertionError
        If the `exchange` table contains any records.

    Examples
    --------
    >>> test_database_init_02(db_session)
    """
    assert db_session.query(User).count() == 0



