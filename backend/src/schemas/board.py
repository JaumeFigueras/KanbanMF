#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for boards, templates, board order, sharing and
the overdue-tasks page.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator

from src.schemas.card import CardRead


class BoardCreate(BaseModel):
    name: str
    is_starred: bool = False
    is_template: bool = False
    # Template whose lists (and the creating user's own colors) are copied
    # into the new board. Only for normal boards: a template isn't built from
    # another template — duplicate it instead.
    template_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Board name cannot be blank.")
        return v

    @model_validator(mode="after")
    def template_flags_consistent(self) -> "BoardCreate":
        if self.is_template and self.is_starred:
            raise ValueError("A template cannot be starred.")
        if self.is_template and self.template_id is not None:
            raise ValueError("A template cannot be created from another template.")
        return self


class BoardRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    owner_display_name: str
    owner_initials: str | None
    owner_has_avatar: bool
    name: str
    is_archived: bool
    is_deleted: bool
    is_template: bool
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
    """The boards page: normal boards split by ownership, plus every template.

    templates holds owned and shared templates together, since both are shown
    in the same section; owner_id tells them apart.
    """

    owned: list[BoardRead]
    shared: list[BoardRead]
    templates: list[BoardRead]


class BoardOrderRead(BaseModel):
    starred_ids: list[uuid.UUID]
    owned_ids: list[uuid.UUID]
    shared_ids: list[uuid.UUID]
    template_ids: list[uuid.UUID]


class BoardOrderUpdate(BaseModel):
    starred_ids: list[uuid.UUID] | None = None
    owned_ids: list[uuid.UUID] | None = None
    shared_ids: list[uuid.UUID] | None = None
    template_ids: list[uuid.UUID] | None = None


class TemplateDuplicate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Template name cannot be blank.")
        return v


class BoardShareCreate(BaseModel):
    user_id: uuid.UUID


class BoardShareImpact(BaseModel):
    """What removing someone from a board will do: how many of its cards
    they are on, which will be archived and replaced by copies without them."""

    card_count: int


class ListCardsRead(BaseModel):
    """One list on a page that gathers cards from many boards (overdue tasks,
    search results), carrying only the cards that page is about.

    color is the viewer's personal color for the list (None when they haven't
    set one), so the page can paint the column exactly as the board does.
    """

    list_id: uuid.UUID
    list_name: str
    color: str | None
    cards: list[CardRead]


class BoardCardsRead(BaseModel):
    """One board on such a page: its cards, grouped by list.

    Only lists with at least one of the cards are included. color and
    card_colors are the viewer's own board/card colors, keyed by card id —
    same shape as :class:`src.schemas.ui_color.BoardColorsRead`.
    """

    board_id: uuid.UUID
    board_name: str
    color: str | None
    card_colors: dict[str, str]
    lists: list[ListCardsRead]


class OverdueBoardRead(BoardCardsRead):
    """One board on the overdue-tasks page."""

    overdue_count: int


class SearchBoardRead(BoardCardsRead):
    """One board in the search results.

    matched_in says, per card id, which of the searched fields matched:
    ``name``, ``description``, ``checklist`` or ``label``.
    """

    match_count: int
    matched_in: dict[str, list[str]]


class SearchBoardMatch(BaseModel):
    """A board whose name matches the search."""

    board_id: uuid.UUID
    board_name: str
    color: str | None


class SearchResults(BaseModel):
    """The answer to a search: the matching cards, grouped by board and list,
    and the boards whose name matches. truncated is set when more cards
    matched than the limit returned."""

    boards: list[SearchBoardRead]
    matching_boards: list[SearchBoardMatch]
    truncated: bool
