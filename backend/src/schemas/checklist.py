#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class ChecklistItemCreate(BaseModel):
    text: str
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
    text: str | None = None
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
    name: str

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
    name: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Checklist name cannot be blank.")
        return v
