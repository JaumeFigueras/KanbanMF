#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for labels and their order. Colours must be
``#RRGGBB`` and are stored upper-case.
"""

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from src.schemas.limits import LABEL_NAME_MAX_LENGTH

_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


def _validate_color(v: str) -> str:
    if not _COLOR_RE.match(v):
        raise ValueError("color must be a 6-digit hex code like #FF5733")
    return v.upper()


class LabelCreate(BaseModel):
    name: str = Field(max_length=LABEL_NAME_MAX_LENGTH)
    color: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("color")
    @classmethod
    def color_valid(cls, v: str) -> str:
        return _validate_color(v)


class LabelRead(BaseModel):
    id: uuid.UUID
    board_id: uuid.UUID
    name: str
    color: str
    position: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LabelUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=LABEL_NAME_MAX_LENGTH)
    color: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("name must not be empty")
        return v.strip() if v else v

    @field_validator("color")
    @classmethod
    def color_valid(cls, v: str | None) -> str | None:
        return _validate_color(v) if v is not None else v


class LabelOrderUpdate(BaseModel):
    label_ids: list[uuid.UUID]
