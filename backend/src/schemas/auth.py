#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for registration, login, token refresh and
e-mail verification.
"""

from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    display_name: str
    password: str
    language: str = "en"
    # Token from a board invitation link (/signup?invite=...). Only checked
    # against the e-mail being registered: the board itself is shared once
    # that address is verified, whether or not the token was sent.
    invitation_token: str | None = None


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
