#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class BoardListCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("List name cannot be blank.")
        return v


class BoardListRead(BaseModel):
    id: uuid.UUID
    board_id: uuid.UUID
    name: str
    is_archived: bool
    is_deleted: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BoardListUpdate(BaseModel):
    name: str | None = None
    is_archived: bool | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("List name cannot be blank.")
        return v


class BoardListOrderRead(BaseModel):
    board_id: uuid.UUID
    list_ids: list[uuid.UUID]


class BoardListOrderUpdate(BaseModel):
    list_ids: list[uuid.UUID]
