#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from typing import AsyncGenerator

from fastapi import Cookie, Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.core.security import decode_access_token
from src.model.board import Board
from src.model.user import User

bearer_scheme = HTTPBearer()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session, closing it after the request."""
    async with AsyncSessionLocal() as session:
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Validate the Bearer JWT and return the authenticated User row."""
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


async def get_refresh_token_from_cookie(
    refresh_token: str | None = Cookie(default=None),
) -> str:
    """Extract the refresh token from the HTTP-only cookie."""
    if refresh_token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")
    return refresh_token


async def get_client_id(x_client_id: str | None = Header(default=None)) -> str | None:
    """Identify which frontend tab/session issued the request.

    Echoed back in WebSocket notifications as origin_client_id so the
    originating tab can tell its own change apart from one made elsewhere.
    """
    return x_client_id


def reject_if_template(board: Board, detail: str) -> None:
    """Raise 400 when ``board`` is a template.

    Templates hold only lists, so every route that would put a card, a label,
    a star or notification settings on a board calls this first. Not a FastAPI
    dependency: each router already loads the board through its own access
    check, and this runs on the result.
    """
    if board.is_template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
