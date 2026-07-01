#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class CardCreate(BaseModel):
    name: str
    description: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Card name cannot be blank.")
        return v


class CardRead(BaseModel):
    id: uuid.UUID
    list_id: uuid.UUID
    name: str
    description: str | None
    is_archived: bool
    is_deleted: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_archived: bool | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Card name cannot be blank.")
        return v
