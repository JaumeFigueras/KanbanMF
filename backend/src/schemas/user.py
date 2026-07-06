#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from zoneinfo import available_timezones

from pydantic import BaseModel, EmailStr, field_validator

from src.model.user_preferences import DateFormat


class UserRead(BaseModel):
    """Public user profile returned by the API."""

    id: uuid.UUID
    email: str
    display_name: str
    is_active: bool
    is_verified: bool
    created_at: datetime
    updated_at: datetime
    language_locale: str = "en"
    number_locale: str = "en"
    date_format: DateFormat = DateFormat.NUMERIC
    timezone: str = "UTC"
    initials: str | None = None
    auth_providers: list[str] = []

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    """Allowed fields a user can change about themselves."""

    display_name: str | None = None
    email: EmailStr | None = None

    @field_validator("display_name")
    @classmethod
    def display_name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("display_name cannot be blank")
        return v


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UserPreferencesUpdate(BaseModel):
    """Allowed preference fields a user can change."""

    initials: str | None = None
    language_locale: str | None = None
    number_locale: str | None = None
    date_format: DateFormat | None = None
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in available_timezones():
            raise ValueError("timezone must be a valid IANA timezone name")
        return v

    @field_validator("initials")
    @classmethod
    def initials_valid(cls, v: str | None) -> str | None:
        if v is None:
            return v
        stripped = v.strip()
        if not stripped:
            raise ValueError("initials cannot be blank")
        if len(stripped) > 3:
            raise ValueError("initials must be 3 characters or fewer")
        if not stripped.isalnum():
            raise ValueError("initials must contain only letters or digits")
        return stripped.upper()
