#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for checklists, their items and their order."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from src.schemas.limits import CHECKLIST_ITEM_MAX_LENGTH, NAME_MAX_LENGTH


class ChecklistItemCreate(BaseModel):
    text: str = Field(max_length=CHECKLIST_ITEM_MAX_LENGTH)
    is_done: bool = False

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Checklist item text cannot be blank.")
        return v


class ChecklistItemRead(BaseModel):
    id: uuid.UUID
    checklist_id: uuid.UUID
    text: str
    is_done: bool
    position: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChecklistItemUpdate(BaseModel):
    text: str | None = Field(default=None, max_length=CHECKLIST_ITEM_MAX_LENGTH)
    is_done: bool | None = None

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Checklist item text cannot be blank.")
        return v


class ChecklistCreate(BaseModel):
    name: str = Field(max_length=NAME_MAX_LENGTH)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Checklist name cannot be blank.")
        return v


class ChecklistRead(BaseModel):
    id: uuid.UUID
    card_id: uuid.UUID
    name: str
    position: int
    items: list[ChecklistItemRead]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChecklistUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=NAME_MAX_LENGTH)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Checklist name cannot be blank.")
        return v


class ChecklistOrderUpdate(BaseModel):
    checklist_ids: list[uuid.UUID]


class ChecklistItemOrderUpdate(BaseModel):
    item_ids: list[uuid.UUID]
