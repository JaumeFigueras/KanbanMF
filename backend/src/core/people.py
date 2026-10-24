#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The short summary of a person shown on boards and cards: display name,
initials and whether they have an avatar.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.model.user import User
from src.model.user_avatar import UserAvatar
from src.model.user_preferences import UserPreferences
from src.schemas.person import PersonRead


def compute_initials(display_name: str) -> str:
    """Return up to 3 uppercase initials derived from display_name words."""
    return "".join(w[0].upper() for w in display_name.split() if w)[:3]


async def people_by_id(
    user_ids: set[uuid.UUID], db: AsyncSession
) -> dict[uuid.UUID, PersonRead]:
    """Batch-resolve user ids to PersonRead summaries (display name, initials,
    whether they have an avatar) for creator/members/assignees."""
    if not user_ids:
        return {}
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users = list(users_result.scalars().all())

    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id.in_(user_ids))
    )
    prefs_by_id = {p.user_id: p for p in prefs_result.scalars()}

    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id.in_(user_ids))
    )
    avatar_ids = set(avatar_result.scalars().all())

    return {
        user.id: PersonRead(
            id=user.id,
            display_name=user.display_name,
            initials=(
                prefs_by_id[user.id].initials
                if user.id in prefs_by_id and prefs_by_id[user.id].initials
                else compute_initials(user.display_name)
            ),
            has_avatar=user.id in avatar_ids,
        )
        for user in users
    }
