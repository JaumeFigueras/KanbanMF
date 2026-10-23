#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Sign-in with Google (OAuth 2.0 authorization code flow).

``/auth/google/`` sends the browser to Google's consent screen; the callback
finds or creates the user by e-mail address (so a Google sign-in and a local
account with the same address are one user), opens a session, turns pending
invitations into shares and redirects to the frontend with the refresh
cookie set.

The flow is bound to the browser that started it with the OAuth ``state``
parameter: ``/auth/google/`` sends Google a random value and keeps a copy in a
short-lived HTTP-only cookie, and the callback refuses to sign anyone in unless
the two match. Without it, anyone could send a victim a callback link carrying
the attacker's own authorization code and sign the victim in to the
attacker's account (login CSRF).
"""

import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_db
from src.core.config import settings
from src.core.invitations import accept_pending_invitations
from src.core.security import generate_refresh_token, hash_password
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_preferences import UserPreferences
from src.model.user_session import REFRESH_TOKEN_EXPIRE_DAYS, UserSession

router = APIRouter()

_REFRESH_COOKIE = "refresh_token"
_GOOGLE_SCOPES = "openid email profile"

# The OAuth state cookie only has to outlive one visit to Google's consent
# screen, and only ever needs to reach the two routes in this module.
_STATE_COOKIE = "google_oauth_state"
_STATE_COOKIE_PATH = "/api/v1/auth/google"
_STATE_MAX_AGE_SECONDS = 10 * 60


@router.get("/")
async def google_login() -> RedirectResponse:
    """Redirect the browser to Google's OAuth 2.0 consent screen, with a fresh
    ``state`` that the callback will check against the state cookie set here."""
    state = secrets.token_urlsafe(32)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": _GOOGLE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    redirect = RedirectResponse(url=f"{settings.google_auth_url}?{urlencode(params)}")
    # SameSite=Lax still sends the cookie on the callback, which is a
    # top-level GET navigation coming back from accounts.google.com.
    redirect.set_cookie(
        key=_STATE_COOKIE,
        value=state,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=_STATE_MAX_AGE_SECONDS,
        path=_STATE_COOKIE_PATH,
    )
    return redirect


@router.get("/callback")
async def google_callback(
    code: str,
    state: str | None = None,
    google_oauth_state: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Handle Google's OAuth callback.

    Steps:

    0. Check that ``state`` matches the state cookie set by ``/auth/google/``
       in this same browser; refuse with 400 otherwise, before talking to
       Google at all.
    1. Exchange the authorization code for tokens.
    2. Fetch the user's Google profile (email, name, sub).
    3. Look up or create the User row (matched on email).
    4. Look up or create a UserIdentity(google) with the provider tokens,
       and ensure a UserPreferences row exists (backfilled if missing).
    5. Create a UserSession (refresh token rotation), then share every
       board the address has a pending invitation to.
    6. Set the refresh cookie and redirect to the frontend — the SPA's own
       startup check (apiFetch a protected endpoint, refresh via the cookie
       on 401) picks up the new session from there, same as a page reload.
    """
    # --- 0. The callback must come back to the browser that started the flow.
    # Compared as bytes: compare_digest refuses non-ASCII str with a TypeError.
    if not state or not google_oauth_state or not secrets.compare_digest(
        state.encode(), google_oauth_state.encode()
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state")

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

    # --- 4b. Ensure UserPreferences exists — local registration always
    # creates one, but a Google signup previously didn't, which left the
    # user unable to save preferences (404 "Preferences not found").
    # on_conflict_do_nothing also backfills the row for any account created
    # before this fix, the next time they log in via Google.
    await db.execute(
        pg_insert(UserPreferences)
        .values(user_id=user.id, language_locale="en", number_locale="en")
        .on_conflict_do_nothing(index_elements=["user_id"])
    )

    # --- 5. Create session ---
    plain_refresh = generate_refresh_token()
    session = UserSession(
        user_id=user.id,
        hashed_refresh_token=hash_password(plain_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.commit()

    # --- 5b. Google has verified the address, so pending invitations to it
    # can become shares straight away.
    await accept_pending_invitations(db, user)

    # --- 6. Set cookie on the redirect itself — a returned Response
    # instance is passed through as-is, so cookies set on the injected
    # `response` dependency wouldn't make it into the final reply.
    redirect = RedirectResponse(url=settings.frontend_url)
    redirect.set_cookie(
        key=_REFRESH_COOKIE,
        value=plain_refresh,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )
    # The state is single-use: drop it so the same callback URL can't be
    # replayed in this browser.
    redirect.delete_cookie(_STATE_COOKIE, path=_STATE_COOKIE_PATH, secure=True, httponly=True, samesite="lax")
    return redirect
