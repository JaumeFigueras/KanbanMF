#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for src.core.security: access tokens signed and checked with PyJWT
(which replaced the unmaintained python-jose), and password checks that never
hand bcrypt more than the 72 bytes it reads."""

import base64
import hashlib
import hmac
import json
from datetime import timedelta

import bcrypt
import jwt
import pytest
import pytest_asyncio

from src.core.config import settings
from src.core.security import create_access_token, decode_access_token, hash_password, verify_password
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity

LONG_PASSWORD = "ĉ" * 50  # 100 bytes: over bcrypt's 72


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def test_tokens_01() -> None:
    """
    Verify an access token carries its subject back, and that an expired,
    tampered, wrongly signed, unsigned ("alg": "none") or malformed token
    gives None rather than an exception.

    Raises
    ------
    AssertionError
        If a good token isn't read, or a bad one is accepted.
    """
    token = create_access_token("user-1")
    assert decode_access_token(token) == "user-1"

    assert decode_access_token(create_access_token("user-1", timedelta(seconds=-1))) is None
    header, payload, signature = token.split(".")
    forged = _b64({**jwt.decode(token, options={"verify_signature": False}), "sub": "user-2"})
    assert decode_access_token(f"{header}.{forged}.{signature}") is None
    assert decode_access_token(jwt.encode({"sub": "user-1"}, "another-key-of-at-least-32-bytes!!",
                                          algorithm="HS256")) is None
    unsigned = f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{payload}."
    assert decode_access_token(unsigned) is None
    for junk in ("", "not-a-token", "a.b.c", token + "x"):
        assert decode_access_token(junk) is None, junk


def test_tokens_02() -> None:
    """
    Verify a token is an ordinary HS256 JWT with ``sub`` and ``exp``, so one
    signed before the switch (python-jose wrote the same format) still
    verifies, and nobody is signed out by the upgrade.

    Raises
    ------
    AssertionError
        If the token's header or claims differ from what python-jose wrote.
    """
    token = create_access_token("user-1")
    assert jwt.get_unverified_header(token) == {"alg": "HS256", "typ": "JWT"}
    claims = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    assert set(claims) == {"sub", "exp"}

    # What python-jose 3.5 produced for the same claims: compact JSON, the
    # header in this order.
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=")
    body = base64.urlsafe_b64encode(b'{"sub":"user-1","exp":4102444800}').rstrip(b"=")
    signature = base64.urlsafe_b64encode(
        hmac.new(settings.secret_key.encode(), header + b"." + body, hashlib.sha256).digest()
    ).rstrip(b"=")
    assert decode_access_token(b".".join([header, body, signature]).decode()) == "user-1"


def test_tokens_03() -> None:
    """
    Verify a password over 72 bytes is checked without an exception (bcrypt
    5 raises on one): against an ordinary hash it is simply wrong, and
    against a hash bcrypt 4 made from its first 72 bytes it still matches.

    Raises
    ------
    AssertionError
        If the check raises, or gives the wrong answer.
    """
    assert verify_password(LONG_PASSWORD, hash_password("an-ordinary-password")) is False
    legacy = bcrypt.hashpw(LONG_PASSWORD.encode()[:72], bcrypt.gensalt()).decode()
    assert verify_password(LONG_PASSWORD, legacy) is True
    assert verify_password("ĉ" * 36, legacy) is True  # the same first 72 bytes
    assert verify_password("ĉ" * 35, legacy) is False


@pytest_asyncio.fixture
async def local_user(db_session_async) -> User:
    """A verified local account with an ordinary password."""
    user = User(email="long@example.com", display_name="Long", is_verified=True)
    db_session_async.add(user)
    await db_session_async.flush()
    db_session_async.add(UserIdentity(user_id=user.id, provider=AuthProvider.LOCAL,
                                      hashed_password=hash_password("an-ordinary-password")))
    await db_session_async.commit()
    return user


@pytest.mark.asyncio
async def test_tokens_04(client, local_user: User) -> None:
    """
    Verify signing in with a password over 72 bytes is an ordinary wrong
    password (401), not a server error.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    local_user : User
        A verified user with a local password.

    Raises
    ------
    AssertionError
        If the sign-in doesn't answer 401.
    """
    response = await client.post("/api/v1/auth/local/login",
                                 json={"email": local_user.email, "password": LONG_PASSWORD})
    assert response.status_code == 401
