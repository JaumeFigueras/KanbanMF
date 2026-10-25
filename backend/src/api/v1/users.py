#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Routes for the signed-in user: profile, preferences, password, avatar,
account deletion, and the user search used by the share dialog.
"""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.core.people import compute_initials
from src.core.rate_limit import PASSWORD_CHANGE_PER_USER, USER_LOOKUP_PER_USER
from src.core.search import escape_like
from src.core.security import hash_password, verify_password
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.user import User
from src.model.user_avatar import MAX_AVATAR_SIZE_BYTES, UserAvatar
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_preferences import UserPreferences
from src.schemas.person import PersonRead
from src.schemas.user import ChangePasswordRequest, UserRead, UserUpdate, UserPreferencesUpdate

_SEARCH_RESULT_LIMIT = 10
# Something, @, something with a dot: what a complete e-mail address looks like.
_WHOLE_ADDRESS = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def _detect_mime(data: bytes) -> str | None:
    """Return MIME type by inspecting magic bytes, ignoring client-supplied Content-Type."""
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return None

router = APIRouter()


async def _build_user_read(user: User, db: AsyncSession) -> UserRead:
    """Assemble a UserRead by querying preferences and identity providers."""
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == user.id)
    )
    prefs = prefs_result.scalar_one_or_none()

    identities_result = await db.execute(
        select(UserIdentity).where(UserIdentity.user_id == user.id)
    )
    providers = [i.provider.value for i in identities_result.scalars()]

    return UserRead(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_active=user.is_active,
        is_verified=user.is_verified,
        created_at=user.created_at,
        updated_at=user.updated_at,
        language_locale=prefs.language_locale if prefs else "en",
        number_locale=prefs.number_locale if prefs else "en",
        date_format=prefs.date_format if prefs else "numeric",
        timezone=prefs.timezone if prefs else "UTC",
        initials=prefs.initials if prefs and prefs.initials else compute_initials(user.display_name),
        auth_providers=providers,
    )


@router.get("/me", response_model=UserRead)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Return the profile of the currently authenticated user."""
    return await _build_user_read(current_user, db)


@router.put("/me", response_model=UserRead)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Update the current user's display name.

    Changing the e-mail address is refused until there is a proper flow for it
    (a confirmation sent to the new address, and the password asked for). It
    used to be accepted straight away, unverified and with no e-mail sent:
    that let a stolen session take the address over, let anyone claim an
    address that isn't theirs, and now that unverified accounts can't use the
    API, it would lock the user out for good.
    """
    if body.email and body.email != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Changing the e-mail address isn't supported"
        )

    if body.display_name is not None:
        current_user.display_name = body.display_name

    await db.commit()
    await db.refresh(current_user)
    return await _build_user_read(current_user, db)


@router.put("/me/preferences", response_model=UserRead)
async def update_my_preferences(
    body: UserPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Update the current user's preferences (initials, language, number locale)."""
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == current_user.id)
    )
    prefs = prefs_result.scalar_one_or_none()
    if prefs is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preferences not found")

    if body.initials is not None:
        prefs.initials = body.initials
    if body.language_locale is not None:
        prefs.language_locale = body.language_locale
    if body.number_locale is not None:
        prefs.number_locale = body.number_locale
    if body.date_format is not None:
        prefs.date_format = body.date_format
    if body.timezone is not None:
        prefs.timezone = body.timezone

    await db.commit()
    await db.refresh(prefs)
    return await _build_user_read(current_user, db)


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_my_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Change the current user's password (local accounts only).

    Limited per user, so a stolen session can't be used to guess the current
    password at speed.
    """
    PASSWORD_CHANGE_PER_USER.hit(str(current_user.id))
    identity_result = await db.execute(
        select(UserIdentity).where(
            UserIdentity.user_id == current_user.id,
            UserIdentity.provider == AuthProvider.LOCAL,
        )
    )
    identity = identity_result.scalar_one_or_none()
    if identity is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No local account found")

    # bcrypt is slow on purpose: run it off the event loop, or every other
    # request waits for it.
    if not identity.hashed_password or not await run_in_threadpool(
        verify_password, body.old_password, identity.hashed_password
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    identity.hashed_password = await run_in_threadpool(hash_password, body.new_password)
    await db.commit()


def _avatar_response(avatar: UserAvatar, request: Request) -> Response:
    """Serve an avatar so a replaced one is never taken from the browser cache.

    The URL of a user's avatar never changes, so without this a new image
    would keep rendering as the old one. ``no-cache`` doesn't mean "don't
    store" — it means revalidate every time, and the ETag (the row's
    updated_at) turns the usual case into an empty 304.
    """
    etag = f'"{avatar.updated_at.timestamp()}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    return Response(
        content=avatar.data,
        media_type=avatar.mime_type,
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )


@router.get("/me/avatar")
async def get_my_avatar(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return the current user's avatar image, or 404 if none is stored."""
    result = await db.execute(select(UserAvatar).where(UserAvatar.user_id == current_user.id))
    avatar = result.scalar_one_or_none()
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No avatar")
    return _avatar_response(avatar, request)


@router.put("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def upload_my_avatar(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Upload or replace the current user's avatar (JPEG, PNG, WebP or GIF, max 100 KB).

    At most one byte more than the limit is read, so an oversized file is
    refused without being loaded. (The whole request was already capped at
    1 MiB, by Apache and by :mod:`src.core.body_limit`.) MIME type is
    determined from magic bytes, not from the client-supplied Content-Type.
    """
    data = await file.read(MAX_AVATAR_SIZE_BYTES + 1)

    if len(data) > MAX_AVATAR_SIZE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds 100 KB limit")

    mime_type = _detect_mime(data)
    if mime_type is None or mime_type not in _ALLOWED_MIME:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only JPEG, PNG, WebP and GIF images are accepted")

    existing = await db.execute(select(UserAvatar).where(UserAvatar.user_id == current_user.id))
    avatar = existing.scalar_one_or_none()
    if avatar is None:
        db.add(UserAvatar(user_id=current_user.id, data=data, mime_type=mime_type))
    else:
        avatar.data = data
        avatar.mime_type = mime_type

    await db.commit()


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete the current user's avatar."""
    result = await db.execute(select(UserAvatar).where(UserAvatar.user_id == current_user.id))
    avatar = result.scalar_one_or_none()
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No avatar")
    await db.delete(avatar)
    await db.commit()


@router.get("/search", response_model=list[PersonRead])
async def search_users(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PersonRead]:
    """Find people to share a board with: at most 10 active, verified users,
    never the caller.

    Two ways to match, so that the search can't be used to explore who has an
    account:

    - by **name**, only among the people the caller already works with —
      anyone on a board the caller owns or that is shared with them — and
      with at least two characters;
    - by **e-mail**, only the whole address (any case): someone who knows
      the address can share with its owner, but nobody can list accounts by
      typing ``@company.com`` or a few letters.

    It used to match any part of any account's name or e-mail address, which
    let anyone signed in find out who uses the server. A search that looks
    like a whole address counts towards a per-user limit
    (:mod:`src.core.rate_limit`), so a list of addresses can't be checked one
    after another; over it, ``429``.
    """
    term = q.strip()
    if not term:
        return []
    if _WHOLE_ADDRESS.match(term):
        USER_LOOKUP_PER_USER.hit(str(current_user.id))

    my_boards = select(Board.id).where(
        Board.is_deleted.is_(False),
        or_(
            Board.owner_id == current_user.id,
            Board.id.in_(select(BoardShare.board_id).where(BoardShare.user_id == current_user.id)),
        ),
    )
    colleagues = select(Board.owner_id).where(Board.id.in_(my_boards)).union(
        select(BoardShare.user_id).where(BoardShare.board_id.in_(my_boards))
    )
    matches = [func.lower(User.email) == term.lower()]
    if len(term) >= 2:
        matches.append(
            and_(
                User.id.in_(colleagues),
                User.display_name.ilike(f"%{escape_like(term)}%", escape="\\"),
            )
        )

    result = await db.execute(
        select(User)
        .where(
            User.id != current_user.id,
            User.is_active.is_(True),
            User.is_verified.is_(True),
            or_(*matches),
        )
        .order_by(User.display_name.asc())
        .limit(_SEARCH_RESULT_LIMIT)
    )
    users = list(result.scalars().all())
    if not users:
        return []

    user_ids = [u.id for u in users]
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id.in_(user_ids))
    )
    prefs_by_id = {p.user_id: p for p in prefs_result.scalars()}

    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id.in_(user_ids))
    )
    avatar_ids = set(avatar_result.scalars().all())

    return [
        PersonRead(
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
    ]


@router.get("/{user_id}/avatar")
async def get_user_avatar(
    user_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return any user's avatar image. No authentication required — avatars are public."""
    result = await db.execute(select(UserAvatar).where(UserAvatar.user_id == user_id))
    avatar = result.scalar_one_or_none()
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No avatar")
    return _avatar_response(avatar, request)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Permanently delete the current user account and all related data.

    Cascade deletes on the DB handle identities, sessions, avatar, and preferences.
    """
    await db.delete(current_user)
    await db.commit()
