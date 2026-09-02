#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator


def _blank_comment_is_none(v: str | None) -> str | None:
    """Store a note that's only whitespace as no note at all.

    Keeps "" and NULL from both meaning "no comment" in the table, and makes
    clearing the field from the edit dialog — which sends whatever is in the
    box — do the obvious thing.
    """
    if v is not None:
        v = v.strip()
    return v or None


class TimeEntryLabel(BaseModel):
    """One label as it looked when the entry was recorded.

    A copy, not a reference: the label it came from may since have been
    renamed, recoloured or deleted.
    """

    name: str
    color: str


class TimeEntryStart(BaseModel):
    """Body of the "start tracking this card" call.

    The ids are only read to take the snapshot — nothing about them is
    stored on the entry.
    """

    board_id: uuid.UUID
    list_id: uuid.UUID
    card_id: uuid.UUID
    comment: str | None = None

    _normalise_comment = field_validator("comment")(_blank_comment_is_none)


class TimeEntryCreate(BaseModel):
    """Body for recording a stretch of work that wasn't tracked live."""

    board_id: uuid.UUID
    list_id: uuid.UUID
    card_id: uuid.UUID
    started_at: datetime
    ended_at: datetime
    comment: str | None = None

    _normalise_comment = field_validator("comment")(_blank_comment_is_none)

    @model_validator(mode="after")
    def check_time_order(self) -> "TimeEntryCreate":
        if self.ended_at <= self.started_at:
            raise ValueError("End time must be after start time.")
        return self


class TimeEntryUpdate(BaseModel):
    """Body for editing a recorded entry.

    Every field is optional. The snapshot text is editable on its own so an
    entry whose card has since been deleted can still be corrected; passing
    board_id/list_id/card_id instead re-copies the snapshot from that card,
    labels included.

    An omitted ``comment`` leaves the note alone; a blank one clears it —
    that's the only way to remove a note, since there's no distinguishing a
    blank note from no note.
    """

    started_at: datetime | None = None
    ended_at: datetime | None = None
    board_name: str | None = None
    card_name: str | None = None
    board_id: uuid.UUID | None = None
    list_id: uuid.UUID | None = None
    card_id: uuid.UUID | None = None
    comment: str | None = None

    _normalise_comment = field_validator("comment")(_blank_comment_is_none)

    @field_validator("board_name", "card_name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Name cannot be blank.")
        return v

    @model_validator(mode="after")
    def check_card_reference(self) -> "TimeEntryUpdate":
        ids = (self.board_id, self.list_id, self.card_id)
        if any(i is not None for i in ids) and not all(i is not None for i in ids):
            raise ValueError("board_id, list_id and card_id must be given together.")
        return self


class TimeEntryRead(BaseModel):
    id: uuid.UUID
    started_at: datetime
    # None while the entry is the one currently running.
    ended_at: datetime | None
    board_name: str
    card_name: str
    labels: list[TimeEntryLabel]
    comment: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
