#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from sqlalchemy.orm import DeclarativeBase

from src.model.user import User
from src.model.user_identity import UserIdentity
from src.model.user_avatar import UserAvatar
from src.model.user_session import UserSession

__all__ = ["Base", "User", "UserIdentity", "UserAvatar", "UserSession"]

class Base(DeclarativeBase):
    pass