#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.core.security import hash_password, verify_password
from src.model.user import User
from src.model.user_avatar import MAX_AVATAR_SIZE_BYTES, UserAvatar
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_preferences import UserPreferences
from src.schemas.user import ChangePasswordRequest, UserRead, UserUpdate, UserPreferencesUpdate

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


def _compute_initials(display_name: str) -> str:
    """Return up to 3 uppercase initials derived from display_name words."""
    return "".join(w[0].upper() for w in display_name.split() if w)[:3]


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
        initials=prefs.initials if prefs and prefs.initials else _compute_initials(user.display_name),
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
    """Update the current user's display name and/or email.

    Changing the email resets is_verified to False and requires re-verification.
    """
    if body.email and body.email != current_user.email:
        conflict = await db.execute(select(User).where(User.email == body.email))
        if conflict.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
        current_user.email = body.email
        current_user.is_verified = False
        # TODO: send verification email to the new address

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

    await db.commit()
    await db.refresh(prefs)
    return await _build_user_read(current_user, db)


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_my_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Change the current user's password (local accounts only)."""
    identity_result = await db.execute(
        select(UserIdentity).where(
            UserIdentity.user_id == current_user.id,
            UserIdentity.provider == AuthProvider.LOCAL,
        )
    )
    identity = identity_result.scalar_one_or_none()
    if identity is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No local account found")

    if not verify_password(body.old_password, identity.hashed_password or ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    identity.hashed_password = hash_password(body.new_password)
    await db.commit()


@router.get("/me/avatar")
async def get_my_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return the current user's avatar image, or 404 if none is stored."""
    result = await db.execute(select(UserAvatar).where(UserAvatar.user_id == current_user.id))
    avatar = result.scalar_one_or_none()
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No avatar")
    return Response(content=avatar.data, media_type=avatar.mime_type)


@router.put("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def upload_my_avatar(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Upload or replace the current user's avatar (JPEG, PNG, WebP or GIF, max 100 KB).

    The file is read entirely into memory — no temporary files are created.
    MIME type is determined from magic bytes, not from the client-supplied Content-Type.
    """
    data = await file.read()

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


@router.get("/{user_id}/avatar")
async def get_user_avatar(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return any user's avatar image. No authentication required — avatars are public."""
    result = await db.execute(select(UserAvatar).where(UserAvatar.user_id == user_id))
    avatar = result.scalar_one_or_none()
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No avatar")
    return Response(content=avatar.data, media_type=avatar.mime_type)


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
