#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

from src.schemas.card import CardRead


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
    owner_display_name: str
    owner_initials: str | None
    owner_has_avatar: bool
    name: str
    is_archived: bool
    is_deleted: bool
    is_starred: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BoardUpdate(BaseModel):
    name: str | None = None
    is_archived: bool | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Board name cannot be blank.")
        return v


class BoardsResponse(BaseModel):
    owned: list[BoardRead]
    shared: list[BoardRead]


class BoardOrderRead(BaseModel):
    starred_ids: list[uuid.UUID]
    owned_ids: list[uuid.UUID]
    shared_ids: list[uuid.UUID]


class BoardOrderUpdate(BaseModel):
    starred_ids: list[uuid.UUID] | None = None
    owned_ids: list[uuid.UUID] | None = None
    shared_ids: list[uuid.UUID] | None = None


class BoardShareCreate(BaseModel):
    user_id: uuid.UUID


class OverdueListRead(BaseModel):
    """One list on the overdue-tasks page, carrying only its overdue cards.

    color is the viewer's personal color for the list (None when they haven't
    set one), so the page can paint the column exactly as the board does.
    """

    list_id: uuid.UUID
    list_name: str
    color: str | None
    cards: list[CardRead]


class OverdueBoardRead(BaseModel):
    """One board on the overdue-tasks page: its overdue cards, grouped by list.

    Only lists with at least one overdue card are included. color and
    card_colors are the viewer's own board/card colors, keyed by card id —
    same shape as :class:`src.schemas.ui_color.BoardColorsRead`.
    """

    board_id: uuid.UUID
    board_name: str
    overdue_count: int
    color: str | None
    card_colors: dict[str, str]
    lists: list[OverdueListRead]
