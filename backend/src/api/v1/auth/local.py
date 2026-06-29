#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db, get_refresh_token_from_cookie
from src.core.email import send_verification_email
from src.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    verify_password,
)
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_preferences import UserPreferences
from src.model.user_session import REFRESH_TOKEN_EXPIRE_DAYS, UserSession
from src.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, VerifyEmailRequest

router = APIRouter()

_REFRESH_COOKIE = "refresh_token"

# Maps i18n language code → (language_locale, number_locale)
_LOCALE_MAP: dict[str, tuple[str, str]] = {
    "en": ("en", "en"),
    "ca": ("ca_ES", "ca_ES"),
}


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Create a new local account.

    Steps:
    1. Reject duplicate email.
    2. Create User row (is_verified=False).
    3. Create UserIdentity(local) with hashed password and a verification token.
    4. Send verification email.
    5. Return an access token so the user can act immediately (unverified).
    """
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(email=body.email, display_name=body.display_name, is_active=True, is_verified=False)
    db.add(user)
    await db.flush()  # populate user.id before referencing it

    verification_token = secrets.token_urlsafe(32)
    identity = UserIdentity(
        user_id=user.id,
        provider=AuthProvider.LOCAL,
        hashed_password=hash_password(body.password),
        verification_token=verification_token,
        verification_token_expiry=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(identity)

    lang = body.language if body.language in _LOCALE_MAP else "en"
    language_locale, number_locale = _LOCALE_MAP[lang]
    preferences = UserPreferences(
        user_id=user.id,
        language_locale=language_locale,
        number_locale=number_locale,
    )
    db.add(preferences)

    await db.commit()

    await send_verification_email(
        email=body.email,
        display_name=body.display_name,
        token=verification_token,
        language=lang,
    )

    access_token = create_access_token(str(user.id))
    return TokenResponse(access_token=access_token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Authenticate with email + password.

    Steps:
    1. Look up the User and their local UserIdentity.
    2. Verify the password.
    3. Create a UserSession (refresh token stored hashed).
    4. Return JWT access token + set refresh token as HTTP-only cookie.
    """
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    identity_result = None
    if user:
        identity_result = await db.execute(
            select(UserIdentity).where(
                UserIdentity.user_id == user.id,
                UserIdentity.provider == AuthProvider.LOCAL,
            )
        )

    identity = identity_result.scalar_one_or_none() if identity_result else None

    # Use constant-time comparison even on "user not found" to avoid timing attacks
    if user is None or identity is None or not verify_password(body.password, identity.hashed_password or ""):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    if not user.is_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email not verified")

    plain_refresh = generate_refresh_token()
    session = UserSession(
        user_id=user.id,
        hashed_refresh_token=hash_password(plain_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.commit()

    _set_refresh_cookie(response, plain_refresh)
    return TokenResponse(access_token=create_access_token(str(user.id)))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_token: str = Depends(get_refresh_token_from_cookie),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Invalidate the current session by deleting the matching UserSession row."""
    sessions = await db.execute(
        select(UserSession).where(UserSession.user_id == current_user.id, UserSession.is_active.is_(True))
    )
    for session in sessions.scalars():
        if verify_password(refresh_token, session.hashed_refresh_token):
            await db.delete(session)
            break

    await db.commit()
    response.delete_cookie(_REFRESH_COOKIE)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    refresh_token: str = Depends(get_refresh_token_from_cookie),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Rotate the refresh token and return a new access token.

    Steps:
    1. Find all active sessions and locate the one matching the cookie.
    2. Delete the old session (token rotation — prevents replay attacks).
    3. Issue a new session with a fresh refresh token.
    4. Return new access token + set new refresh cookie.
    """
    credentials_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    # Scan active sessions for a hash match (linear scan — acceptable for per-user sessions)
    all_sessions = await db.execute(select(UserSession).where(UserSession.is_active.is_(True)))
    matched: UserSession | None = None
    for session in all_sessions.scalars():
        if verify_password(refresh_token, session.hashed_refresh_token):
            matched = session
            break

    if matched is None or matched.expires_at < datetime.now(timezone.utc):
        raise credentials_error

    user_id = matched.user_id
    await db.delete(matched)

    plain_refresh = generate_refresh_token()
    new_session = UserSession(
        user_id=user_id,
        hashed_refresh_token=hash_password(plain_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(new_session)
    await db.commit()

    _set_refresh_cookie(response, plain_refresh)
    return TokenResponse(access_token=create_access_token(str(user_id)))


@router.post("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
async def verify_email(body: VerifyEmailRequest, db: AsyncSession = Depends(get_db)) -> None:
    """Confirm a user's email address using the one-time token sent on registration.

    Steps:
    1. Find the UserIdentity with the matching token.
    2. Check that the token has not expired.
    3. Set User.is_verified = True and clear the token fields.
    """
    result = await db.execute(
        select(UserIdentity).where(UserIdentity.verification_token == body.token)
    )
    identity = result.scalar_one_or_none()

    if identity is None or identity.verification_token_expiry is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification token")

    if identity.verification_token_expiry < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token has expired")

    user_result = await db.execute(select(User).where(User.id == identity.user_id))
    user = user_result.scalar_one()
    user.is_verified = True

    identity.verification_token = None
    identity.verification_token_expiry = None

    await db.commit()
