#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.core.security import hash_password, verify_password
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_preferences import UserPreferences
from src.schemas.user import ChangePasswordRequest, UserRead, UserUpdate, UserPreferencesUpdate

router = APIRouter()


def _compute_initials(display_name: str) -> str:
    """Return up to 3 uppercase initials derived from display_name words."""
    return "".join(w[0].upper() for w in display_name.split() if w)[:3]


@router.get("/me", response_model=UserRead)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Return the profile of the currently authenticated user."""
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == current_user.id)
    )
    prefs = prefs_result.scalar_one_or_none()
    return UserRead(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.display_name,
        is_active=current_user.is_active,
        is_verified=current_user.is_verified,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
        language_locale=prefs.language_locale if prefs else "en",
        initials=prefs.initials if prefs and prefs.initials else _compute_initials(current_user.display_name),
    )


@router.put("/me", response_model=UserRead)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Update the current user's display name and/or email.

    Changing the email resets is_verified to False and requires re-verification.
    """
    if body.email and body.email != current_user.email:
        # Ensure the new email is not already taken
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
    return current_user


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

    await db.commit()
    await db.refresh(prefs)

    return UserRead(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.display_name,
        is_active=current_user.is_active,
        is_verified=current_user.is_verified,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
        language_locale=prefs.language_locale,
        initials=prefs.initials if prefs.initials else _compute_initials(current_user.display_name),
    )


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
