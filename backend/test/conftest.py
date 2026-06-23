#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import tempfile
import pytest

from pytest_postgresql import factories
from pathlib import Path
from sqlalchemy import text
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import NullPool

from src.model import Base

test_folder: Path = Path(__file__).parent
socket_dir: tempfile.TemporaryDirectory = tempfile.TemporaryDirectory()
postgresql_proc_kanbanmf = factories.postgresql_proc(port=None, unixsocketdir=socket_dir.name, dbname='test')
postgresql_kanbanmf = factories.postgresql('postgresql_proc_kanbanmf')

@pytest.fixture(scope='function')
def db_session(postgresql_kanbanmf):
    """Session for SQLAlchemy."""
    connection = f'postgresql+psycopg://{postgresql_kanbanmf.info.user}:@{postgresql_kanbanmf.info.host}:{postgresql_kanbanmf.info.port}/{postgresql_kanbanmf.info.dbname}'
    engine = create_engine(connection, echo=False, poolclass=NullPool)
    session = scoped_session(sessionmaker(bind=engine))
    # Build the database tables
    sql_filenames = [
        str(test_folder) + '/database_init.sql',
        str(test_folder.parent) + '/src/model/sql/users.sql',
    ]
    for sql_filename in sql_filenames:
        with open(sql_filename, 'r') as sql_file:
            sql = text(sql_file.read())
            session.execute(sql)

    yield session

    # Clean up: drop all tables and commit
    for tbl in reversed(Base.metadata.sorted_tables):
       tbl.delete()
    session.commit()
    # Clear the scoped_session and dispose engine
    session.close()
    engine.dispose()

"""
Configuration of the database.

The setup creates a temporary database with the full schema but without any data that will be added as necessary in the 
fixtures. Uses a initialization file to simulate the real users: 'richal_user' and 'richal_remoteuser' and then the 
SQL files stored in the data model
"""

pytest_plugins = [
    # 'test.fixtures.xxx',
]

"""
Configuration of the fixtures.

Sets up the fixtures for the database population, FMP API responses
"""