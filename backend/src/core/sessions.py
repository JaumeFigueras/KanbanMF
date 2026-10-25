#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Sign-in sessions (refresh tokens): opening one, finding the one a cookie
belongs to, ending a user's other sessions, and the hourly clean-up of
expired ones.

A session is found by the SHA-256 of its refresh token, with one indexed
query. It used to be found by bcrypt-checking the cookie against every
session of every user, which took a third of a second per session and
blocked the server while it did: a single request with a made-up cookie
could stop the site for seconds.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.core.security import generate_refresh_token, hash_token
from src.model.user_session import REFRESH_TOKEN_EXPIRE_DAYS, UserSession

logger = logging.getLogger(__name__)


def open_session(user_id: uuid.UUID, db: AsyncSession) -> str:
    """Add a new session for the user to ``db`` (the caller commits) and
    return its refresh token, for the cookie."""
    token = generate_refresh_token()
    db.add(UserSession(
        user_id=user_id,
        hashed_refresh_token=hash_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    return token


async def find_session(
    token: str, db: AsyncSession, user_id: uuid.UUID | None = None
) -> UserSession | None:
    """The active, unexpired session a refresh token belongs to (of that user,
    when ``user_id`` is given), or None."""
    conditions = [
        UserSession.hashed_refresh_token == hash_token(token),
        UserSession.is_active.is_(True),
        UserSession.expires_at > datetime.now(timezone.utc),
    ]
    if user_id is not None:
        conditions.append(UserSession.user_id == user_id)
    result = await db.execute(select(UserSession).where(*conditions))
    return result.scalar_one_or_none()


async def end_other_sessions(user_id: uuid.UUID, keep: UserSession | None, db: AsyncSession) -> int:
    """Delete every session of the user except ``keep`` (the caller commits).
    Returns how many were deleted.

    Each device then stays signed in only until its access token expires (15
    minutes at most): its next refresh finds no session.
    """
    conditions = [UserSession.user_id == user_id]
    if keep is not None:
        conditions.append(UserSession.id != keep.id)
    result = await db.execute(delete(UserSession).where(*conditions))
    return result.rowcount


async def delete_expired_sessions() -> None:
    """Hourly job: delete sessions past their expiry date.

    They are already refused everywhere; this keeps the table from growing
    with every sign-in on a device that never came back.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(UserSession).where(UserSession.expires_at <= datetime.now(timezone.utc))
        )
        await db.commit()
    if result.rowcount:
        logger.info("Deleted %d expired session(s)", result.rowcount)
