#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The declarative base every ORM model inherits from."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for every model. ``src/model/__init__.py`` imports all
    of them, so ``Base.metadata`` describes the whole schema (Alembic relies on
    that)."""
