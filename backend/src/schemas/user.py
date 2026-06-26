#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator


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
