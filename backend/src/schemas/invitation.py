#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, field_validator


class BoardInvitationCreate(BaseModel):
    email: EmailStr
    # Language of the invitation e-mail. The dialog defaults it to the
    # sender's own language.
    language: Literal["en", "ca"] = "en"

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class BoardInvitationRead(BaseModel):
    """A pending invitation, as the board owner sees it in the share dialog."""

    id: uuid.UUID
    email: str
    language: str
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


class InvitationPreview(BaseModel):
    """What the sign-up page shows for an invitation link, before any login."""

    email: str
    board_name: str
    inviter_name: str
