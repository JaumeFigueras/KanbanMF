#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Utility script for inspecting and printing SQLAlchemy ORM table definitions.

This script connects to a PostgreSQL database using SQLAlchemy and prints
the SQL statements for creating ORM-mapped tables and their associated
PostgreSQL enum types. It is primarily used for debugging and verifying
schema generation of the project's data models.

Usage
-----
Run from the command line with the required connection arguments:

.. code-block:: bash

    python3 get_sql.py --host localhost --port 5432 --database testdb --username user --password pass

Named Arguments
---------------
| :code:`-H, --host`: Hostname of the PostgreSQL database cluster.
| :code:`-p, --port`: Port number of the PostgreSQL database cluster.
| :code:`-d, --database`: Name of the target database.
| :code:`-u, --username`: Database username for authentication.
| :code:`-w, --password`: Password for authentication.

Models list
-----------
Each entry in ``models`` is either a single ORM model class or a list where
the last element is the ORM model class and all preceding elements are Python
``enum.Enum`` subclasses whose ``CREATE TYPE`` statements must be emitted
first. All entries in a list are written to the same ``.sql`` file (named
after the model's table).

""" # noinspection GrammarInspection

import argparse  # pragma: no cover
import enum  # pragma: no cover
import sys  # pragma: no cover
from typing import Union  # pragma: no cover

from sqlalchemy import create_engine  # pragma: no cover
from sqlalchemy import URL  # pragma: no cover
from sqlalchemy import Engine  # pragma: no cover
from sqlalchemy.exc import SQLAlchemyError  # pragma: no cover
from sqlalchemy.schema import CreateTable  # pragma: no cover
from sqlalchemy.schema import CreateIndex  # pragma: no cover
from sqlalchemy.dialects import postgresql

from src.model import Base  # pragma: no cover
from src.model.user import User
from src.model.user_avatar import UserAvatar
from src.model.user_preferences import UserPreferences, DateFormat
from src.model.user_identity import UserIdentity, AuthProvider
from src.model.user_session import UserSession
from src.model.board import Board
from src.model.board_share import BoardShare

# Each entry is either an ORM model class or a list of [EnumClass, ..., OrmModelClass].
# When a list is given, the enum CREATE TYPE statements are written before the table DDL,
# and everything is saved to the same file (named after the model's tablename).
Entry = Union[type, list[type]]


def _enum_to_sql(enum_class: type) -> str:  # pragma: no cover
    type_name = enum_class.__name__.lower()
    values = ", ".join(f"'{e.value}'" for e in enum_class)
    return f"CREATE TYPE {type_name} AS ENUM ({values});\n"


def main(e: Engine):  # pragma: no cover
    """
    Print SQLAlchemy table metadata and CREATE TABLE statements.

    Parameters
    ----------
    e : Engine
        A SQLAlchemy Engine connected to the target PostgreSQL database.
    """
    print(Base.metadata.tables.keys())

    models: list[Entry] = [
        User,
        UserAvatar,
        [DateFormat, UserPreferences],
        [AuthProvider, UserIdentity],
        UserSession,
        Board,
        BoardShare,
    ]

    for entry in models:
        if isinstance(entry, list):
            *enum_classes, model = entry
        else:
            enum_classes, model = [], entry

        sql_str = ""
        for enum_class in enum_classes:
            sql_str += _enum_to_sql(enum_class)

        table_sql = CreateTable(model.__table__).compile(e, dialect=postgresql.dialect()).__str__()
        table_sql = table_sql[:-1] + "WITH (OIDS = FALSE);\n"
        for idx in model.__table__.indexes:
            table_sql += CreateIndex(idx).compile(dialect=postgresql.dialect()).__str__() + ";\n"
        table_sql += f"ALTER TABLE public.{model.__tablename__} OWNER TO kanbanmf_user;\n"
        table_sql += f"GRANT SELECT on public.{model.__tablename__} to kanbanmf_remoteuser;"

        sql_str += table_sql
        print(sql_str)
        with open(f"./src/model/sql/{model.__tablename__}.sql", "w") as file:
            file.write(sql_str)

if __name__ == "__main__":  # pragma: no cover
    # Config the program arguments
    parser = argparse.ArgumentParser()
    parser.add_argument('-H', '--host', help='Host name were the database cluster is located', required=True)
    parser.add_argument('-p', '--port', type=int, help='Database cluster port', required=True)
    parser.add_argument('-d', '--database', help='Database name', required=True)
    parser.add_argument('-u', '--username', help='Database username', required=True)
    parser.add_argument('-w', '--password', help='Database password', required=True)
    args = parser.parse_args()

    database_url = URL.create('postgresql+psycopg', username=args.username, password=args.password, host=args.host,
                              port=args.port, database=args.database)

    try:
        engine = create_engine(database_url)
    except SQLAlchemyError as ex:
        print(ex)
        sys.exit(-1)

    main(engine)
