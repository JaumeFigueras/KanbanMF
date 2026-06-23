#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.user import User
from src.schemas.user import UserRead, UserUpdate

router = APIRouter()


@router.get("/me", response_model=UserRead)
async def get_me(current_user: User = Depends(get_current_user)) -> User:
    """Return the profile of the currently authenticated user."""
    return current_user


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
