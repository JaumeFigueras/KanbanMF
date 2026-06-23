#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_db
from src.core.config import settings
from src.core.security import create_access_token, generate_refresh_token, hash_password
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_session import REFRESH_TOKEN_EXPIRE_DAYS, UserSession
from src.schemas.auth import TokenResponse

router = APIRouter()

_REFRESH_COOKIE = "refresh_token"
_GOOGLE_SCOPES = "openid email profile"


@router.get("/")
async def google_login() -> RedirectResponse:
    """Redirect the browser to Google's OAuth 2.0 consent screen."""
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": _GOOGLE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
    }
    return RedirectResponse(url=f"{settings.google_auth_url}?{urlencode(params)}")


@router.get("/callback", response_model=TokenResponse)
async def google_callback(
    code: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Handle Google's OAuth callback.

    Steps:
    1. Exchange the authorization code for tokens.
    2. Fetch the user's Google profile (email, name, sub).
    3. Look up or create the User row (matched on email).
    4. Look up or create a UserIdentity(google) with the provider tokens.
    5. Create a UserSession (refresh token rotation).
    6. Return JWT access token + set refresh cookie, then redirect to frontend.
    """
    # --- 1. Exchange code for tokens ---
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            settings.google_token_url,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if token_response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to exchange Google token")

    token_data = token_response.json()
    google_access_token: str = token_data["access_token"]
    google_refresh_token: str | None = token_data.get("refresh_token")

    # --- 2. Fetch Google user profile ---
    async with httpx.AsyncClient() as client:
        profile_response = await client.get(
            settings.google_userinfo_url,
            headers={"Authorization": f"Bearer {google_access_token}"},
        )
    if profile_response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to fetch Google profile")

    profile = profile_response.json()
    google_sub: str = profile["sub"]
    email: str = profile["email"]
    display_name: str = profile.get("name", email.split("@")[0])

    # --- 3. Upsert User ---
    user_result = await db.execute(select(User).where(User.email == email))
    user = user_result.scalar_one_or_none()
    if user is None:
        user = User(email=email, display_name=display_name, is_active=True, is_verified=True)
        db.add(user)
        await db.flush()
    else:
        # Merge: Google always verifies the email
        user.is_verified = True

    # --- 4. Upsert UserIdentity(google) ---
    identity_result = await db.execute(
        select(UserIdentity).where(
            UserIdentity.user_id == user.id,
            UserIdentity.provider == AuthProvider.GOOGLE,
        )
    )
    identity = identity_result.scalar_one_or_none()
    if identity is None:
        identity = UserIdentity(
            user_id=user.id,
            provider=AuthProvider.GOOGLE,
            provider_user_id=google_sub,
            access_token=google_access_token,
            refresh_token=google_refresh_token,
        )
        db.add(identity)
    else:
        identity.access_token = google_access_token
        if google_refresh_token:
            identity.refresh_token = google_refresh_token

    # --- 5. Create session ---
    plain_refresh = generate_refresh_token()
    session = UserSession(
        user_id=user.id,
        hashed_refresh_token=hash_password(plain_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.commit()

    # --- 6. Return tokens ---
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=plain_refresh,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )
    return TokenResponse(access_token=create_access_token(str(user.id)))
