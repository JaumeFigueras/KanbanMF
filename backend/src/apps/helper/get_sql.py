#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Utility script for inspecting and printing SQLAlchemy ORM table definitions.

This script connects to a PostgreSQL database using SQLAlchemy and prints
the SQL statements for creating ORM-mapped tables. It is primarily used for
debugging and verifying schema generation of the project's data models.

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

""" # noinspection GrammarInspection

import argparse  # pragma: no cover
import sys  # pragma: no cover

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
from src.model.user_preferences import UserPreferences
from src.model.user_identity import UserIdentity
from src.model.user_session import UserSession

def main(e: Engine):  # pragma: no cover
    """
    Print SQLAlchemy table metadata and CREATE TABLE statements.

    Parameters
    ----------
    e : Engine
        A SQLAlchemy Engine connected to the target PostgreSQL database.

    Notes
    -----
    - Prints the list of all registered tables from `Base.metadata`.
    - Prints the CREATE TABLE SQL for `DataProvider` and `Lightning` tables.
    - Additional tables may be enabled by uncommenting their respective lines.
    """

    print(Base.metadata.tables.keys())
    models = [User, UserAvatar, UserPreferences, UserIdentity, UserSession]
    # Base.metadata.create_all(e)
    for model in models:
        # for c in User.__table__.constraints:
        #     print(c)
        sql_str = CreateTable(model.__table__).compile(e, dialect=postgresql.dialect()).__str__()
        sql_str = sql_str[:-1] + "WITH (OIDS = FALSE);\n"
        for idx in model.__table__.indexes:
            sql_str += CreateIndex(idx).compile(dialect=postgresql.dialect()).__str__() + ";\n"
        sql_str += f"ALTER TABLE public.{model.__tablename__} OWNER TO kanbanmf_user;\n"
        sql_str += f"GRANT SELECT on public.{model.__tablename__} to kanbanmf_remoteuser;"
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
