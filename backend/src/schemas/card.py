#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for cards, copying a card and a list's card
order.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from src.schemas.checklist import ChecklistRead
from src.schemas.label import LabelRead
from src.schemas.limits import DESCRIPTION_MAX_LENGTH, NAME_MAX_LENGTH
from src.schemas.person import PersonRead


class CardCreate(BaseModel):
    name: str = Field(max_length=NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)
    start_at: datetime | None = None
    due_at: datetime | None = None
    end_at: datetime | None = None
    label_ids: list[uuid.UUID] = []
    member_ids: list[uuid.UUID] = []
    assignee_ids: list[uuid.UUID] = []

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


class CardCopyCreate(BaseModel):
    name: str = Field(max_length=NAME_MAX_LENGTH)
    target_board_id: uuid.UUID
    target_list_id: uuid.UUID
    # Both default to True so a plain copy stays a full copy. They exist for
    # the "promote a checklist item to a card" action, which wants the source
    # card's labels/dates/people but neither its description nor its
    # checklists — see copy_card.
    include_description: bool = True
    include_checklists: bool = True

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
    start_at: datetime | None
    due_at: datetime | None
    end_at: datetime | None
    labels: list[LabelRead]
    creator: PersonRead | None
    members: list[PersonRead]
    assignees: list[PersonRead]
    checklists: list[ChecklistRead]
    # Set on an archived card that was replaced by a copy when someone on it
    # lost access to the board; such a card can't be restored.
    replaced_by_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CardOrderRead(BaseModel):
    list_id: uuid.UUID
    card_ids: list[uuid.UUID]


class CardOrderUpdate(BaseModel):
    card_ids: list[uuid.UUID]


class CardUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)
    is_archived: bool | None = None
    start_at: datetime | None = None
    due_at: datetime | None = None
    end_at: datetime | None = None
    label_ids: list[uuid.UUID] | None = None
    member_ids: list[uuid.UUID] | None = None
    assignee_ids: list[uuid.UUID] | None = None
    list_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Card name cannot be blank.")
        return v
