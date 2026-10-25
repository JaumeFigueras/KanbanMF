#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for registration, login, token refresh and
e-mail verification.
"""

from pydantic import BaseModel, EmailStr, Field, field_validator

from src.schemas.limits import DISPLAY_NAME_MAX_LENGTH, LOCALE_MAX_LENGTH

# bcrypt only reads the first 72 bytes of a password (and bcrypt 5 refuses
# longer ones), so that is the ceiling; 8 characters is the usual floor.
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_BYTES = 72


def check_password(value: str) -> str:
    """The password rule, shared by registration and password change."""
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"The password must be at least {PASSWORD_MIN_LENGTH} characters long.")
    if len(value.encode()) > PASSWORD_MAX_BYTES:
        raise ValueError(f"The password must be at most {PASSWORD_MAX_BYTES} bytes long.")
    return value


class RegisterRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(max_length=DISPLAY_NAME_MAX_LENGTH)
    password: str
    language: str = Field(default="en", max_length=LOCALE_MAX_LENGTH)
    # Token from a board invitation link (/signup?invite=...). Only checked
    # against the e-mail being registered: the board itself is shared once
    # that address is verified, whether or not the token was sent.
    invitation_token: str | None = None

    @field_validator("password")
    @classmethod
    def password_rule(cls, v: str) -> str:
        return check_password(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterResponse(BaseModel):
    """The account was created; the verification e-mail went to ``email``.
    No token: the account can't be used until the address is verified."""

    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class VerifyEmailRequest(BaseModel):
    token: str
