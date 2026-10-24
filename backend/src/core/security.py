#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Password hashing (bcrypt), JWT access tokens, random refresh tokens and the
SHA-256 hash they are stored and looked up by."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from src.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def hash_token(token: str) -> str:
    """SHA-256 (hex) of a random token (refresh token, OAuth code or token), as
    stored.

    These are 256-bit random strings, so a fast hash is enough — bcrypt is for
    passwords, which can be guessed — and, unlike bcrypt, it lets a token be
    looked up by its hash with one indexed query.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(subject: Any, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    return jwt.encode(
        {"sub": str(subject), "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def decode_access_token(token: str) -> str | None:
    """Return the subject (user id) or None if the token is invalid/expired."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return payload.get("sub")
    except JWTError:
        return None


def generate_refresh_token() -> str:
    """Return a cryptographically secure random token (URL-safe base64)."""
    return secrets.token_urlsafe(32)
