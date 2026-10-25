#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""E-mail and password accounts: registration, verification, login, logout
and refresh-token rotation.

The refresh token travels only in an HTTP-only cookie and is stored only as its
SHA-256 in ``UserSession`` (see :mod:`src.core.sessions`); every refresh
deletes the session it used and issues a new one. Passwords are bcrypt
hashes, checked in a worker thread: bcrypt takes about a third of a second on
purpose, and run on the event loop it would stall every other request.
"""

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from starlette.concurrency import run_in_threadpool
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db, get_refresh_token_from_cookie
from src.core.email import send_account_exists_email, send_verification_email
from src.core.invitations import accept_pending_invitations
from src.core.rate_limit import LOGIN_PER_ACCOUNT, LOGIN_PER_IP, REGISTER_PER_IP, client_ip
from src.core.security import create_access_token, hash_password, verify_password
from src.core.sessions import find_session, open_session
from src.model.board_invitation import BoardInvitation
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_preferences import UserPreferences
from src.model.user_session import REFRESH_TOKEN_EXPIRE_DAYS
from src.schemas.auth import LoginRequest, RegisterRequest, RegisterResponse, TokenResponse, VerifyEmailRequest

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


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)) -> RegisterResponse:
    """Create a new local account, or tell the address's owner it has one.

    The reply is the same whether or not the address already has an account
    — 201 and "check your email" — and so is the work behind it (one bcrypt
    hash, one e-mail), so neither the answer nor its timing tells a stranger
    who uses the server. It used to be a 409. What happened goes by e-mail,
    which only the address's owner reads:

    - **no account**: the account is created unverified and the verification
      link sent;
    - **an unverified account whose link has expired**: nobody proved the
      address within 24 hours, so this registration takes the account over —
      new name, password, language and link. Otherwise anyone could keep an
      address from ever registering by signing it up first;
    - **any other account** (verified, or waiting for a link that still
      works): nothing changes, and the e-mail says an account already exists
      (:func:`~src.core.email.send_account_exists_email`). A pending
      registration can't be replaced while its link works, or a second
      sign-up could swap in its own password before the owner clicks.

    An invitation token for another address is still refused (400/422): that
    reveals nothing about accounts. Nothing to sign in with is returned: the
    account can't be used until the address is verified, or anyone could act
    in the name of an address they don't own.

    Limited per IP address, since every registration e-mails whatever
    address was typed (:mod:`src.core.rate_limit`).
    """
    REGISTER_PER_IP.hit(client_ip(request))

    if body.invitation_token is not None:
        invitation_result = await db.execute(
            select(BoardInvitation.email).where(
                BoardInvitation.token == body.invitation_token,
                BoardInvitation.expires_at > datetime.now(timezone.utc),
            )
        )
        invited_email = invitation_result.scalar_one_or_none()
        if invited_email is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired invitation")
        if invited_email != body.email.lower():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The e-mail doesn't match the invitation",
            )

    lang = body.language if body.language in _LOCALE_MAP else "en"
    # Hashed whichever way it goes, so every answer takes bcrypt's time.
    hashed_password = await run_in_threadpool(hash_password, body.password)

    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    identity = None
    if user is not None:
        identity = (await db.execute(
            select(UserIdentity).where(UserIdentity.user_id == user.id, UserIdentity.provider == AuthProvider.LOCAL)
        )).scalar_one_or_none()
        pending = (
            not user.is_verified
            and identity is not None
            and identity.verification_token_expiry is not None
            and identity.verification_token_expiry > datetime.now(timezone.utc)
        )
        if user.is_verified or pending:
            await send_account_exists_email(email=user.email, pending=pending, language=lang)
            return RegisterResponse(email=body.email)

    verification_token = secrets.token_urlsafe(32)
    expiry = datetime.now(timezone.utc) + timedelta(hours=24)
    language_locale, number_locale = _LOCALE_MAP[lang]
    if user is None:
        user = User(email=body.email, display_name=body.display_name, is_active=True, is_verified=False)
        db.add(user)
        await db.flush()  # populate user.id before referencing it
    else:
        # An unverified account nobody verified in time: start it over.
        user.display_name = body.display_name
        await db.execute(delete(UserPreferences).where(UserPreferences.user_id == user.id))
    if identity is None:
        identity = UserIdentity(user_id=user.id, provider=AuthProvider.LOCAL)
        db.add(identity)
    identity.hashed_password = hashed_password
    identity.verification_token = verification_token
    identity.verification_token_expiry = expiry
    db.add(UserPreferences(user_id=user.id, language_locale=language_locale, number_locale=number_locale))

    await db.commit()

    await send_verification_email(
        email=body.email,
        display_name=body.display_name,
        token=verification_token,
        language=lang,
    )

    return RegisterResponse(email=body.email)


# A bcrypt hash of a random password nobody knows, at hash_password's cost
# (bcrypt's default, 12 rounds). Sign-in checks the password against it when
# the address has no local password, so an unknown address takes as long to
# refuse as a wrong password does.
_DUMMY_PASSWORD_HASH = "$2b$12$GxmRs0Bk6LQ2ShbYIQ3S0.2qkCEd4BJg5WjyCBDIt6f48oTKNPbFm"


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Authenticate with email + password.

    Steps:

    1. Look up the User and their local UserIdentity.
    2. Verify the password — against a dummy hash when there is no local
       password, so the answer takes the same time and an address without an
       account can't be told from a wrong password. (It used to answer at
       once, which gave accounts away.)
    3. Create a UserSession (refresh token stored hashed).
    4. Return JWT access token + set refresh token as HTTP-only cookie.

    "Disabled" and "not verified" are only said after the right password.

    Attempts are limited per IP address and per account before anything is
    looked up (:mod:`src.core.rate_limit`), so guessing a password costs the
    guesser time, not the server bcrypt work.
    """
    LOGIN_PER_IP.hit(client_ip(request))
    LOGIN_PER_ACCOUNT.hit(body.email.lower())
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    identity = None
    if user:
        identity_result = await db.execute(
            select(UserIdentity).where(
                UserIdentity.user_id == user.id,
                UserIdentity.provider == AuthProvider.LOCAL,
            )
        )
        identity = identity_result.scalar_one_or_none()

    stored_hash = identity.hashed_password if identity is not None and identity.hashed_password else None
    password_ok = await run_in_threadpool(verify_password, body.password, stored_hash or _DUMMY_PASSWORD_HASH)
    if user is None or stored_hash is None or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    if not user.is_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email not verified")

    plain_refresh = open_session(user.id, db)
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
    session = await find_session(refresh_token, db, user_id=current_user.id)
    if session is not None:
        await db.delete(session)
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

    1. Find the active, unexpired session the cookie belongs to, by the
       token's SHA-256 (one indexed query).
    2. Delete the old session (token rotation — prevents replay attacks).
    3. Issue a new session with a fresh refresh token.
    4. Return new access token + set new refresh cookie.
    """
    matched = await find_session(refresh_token, db)
    if matched is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user_id = matched.user_id
    await db.delete(matched)
    plain_refresh = open_session(user_id, db)
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
    4. Share every board the address has a pending invitation to.
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

    await accept_pending_invitations(db, user)
