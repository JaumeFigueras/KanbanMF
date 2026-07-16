#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re

from pydantic import BaseModel, field_validator

_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


class ColorRead(BaseModel):
    """A user's personal color choice for a board, list or card.

    color is None when the user hasn't set one — the entity renders with
    its default color in that case.
    """

    color: str | None


class ColorUpdate(BaseModel):
    color: str

    @field_validator("color")
    @classmethod
    def color_valid(cls, v: str) -> str:
        if not _COLOR_RE.match(v):
            raise ValueError("color must be a 6-digit hex code like #FF5733")
        return v.upper()


class BoardColorsRead(BaseModel):
    """Every color the current user has personally set anywhere on a board,
    in one shot — the board itself, its lists, and their cards.

    Fetched once up front so the board page can render lists/cards with
    their final color from the first paint, instead of the default color
    flashing while N per-entity color requests resolve.
    """

    board: str | None
    lists: dict[str, str]
    cards: dict[str, str]
