#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class BoardCreate(BaseModel):
    name: str
    is_starred: bool = False

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Board name cannot be blank.")
        return v


class BoardRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    is_archived: bool
    is_deleted: bool
    is_starred: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BoardsResponse(BaseModel):
    owned: list[BoardRead]
    shared: list[BoardRead]
