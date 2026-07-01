#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator

from src.schemas.label import LabelRead


class CardCreate(BaseModel):
    name: str
    description: str | None = None
    start_at: datetime | None = None
    due_at: datetime | None = None
    end_at: datetime | None = None
    label_ids: list[uuid.UUID] = []

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Card name cannot be blank.")
        return v

    @model_validator(mode="after")
    def check_date_order(self) -> "CardCreate":
        if self.start_at is not None and self.end_at is not None and self.start_at > self.end_at:
            raise ValueError("Start date cannot be after end date.")
        return self


class CardRead(BaseModel):
    id: uuid.UUID
    list_id: uuid.UUID
    name: str
    description: str | None
    is_archived: bool
    is_deleted: bool
    start_at: datetime | None
    due_at: datetime | None
    end_at: datetime | None
    labels: list[LabelRead]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_archived: bool | None = None
    start_at: datetime | None = None
    due_at: datetime | None = None
    end_at: datetime | None = None
    label_ids: list[uuid.UUID] | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Card name cannot be blank.")
        return v
