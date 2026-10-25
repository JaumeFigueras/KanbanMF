#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for lists and their order."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from src.schemas.limits import NAME_MAX_LENGTH


class BoardListCreate(BaseModel):
    name: str = Field(max_length=NAME_MAX_LENGTH)

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
    name: str | None = Field(default=None, max_length=NAME_MAX_LENGTH)
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
