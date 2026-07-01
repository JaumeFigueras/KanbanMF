#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from pydantic import BaseModel


class PersonRead(BaseModel):
    """A minimal user summary for display purposes (avatars, initials, name)."""

    id: uuid.UUID
    display_name: str
    initials: str | None
    has_avatar: bool

    model_config = {"from_attributes": True}
