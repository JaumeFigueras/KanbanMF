#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Route for searching cards: across every board you can see, within one
board, in one board's archive, or across your archived boards.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.core.search import search_cards
from src.model.user import User
from src.schemas.board import SearchResults

router = APIRouter()


@router.get("", response_model=SearchResults)
async def search(
    q: str = Query(min_length=2, max_length=200),
    board_id: uuid.UUID | None = None,
    archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResults:
    """Find the cards that hold every word of ``q``; see
    :func:`src.core.search.search_cards` for the fields searched and the
    scopes ``board_id`` and ``archived`` choose."""
    return await search_cards(q, board_id, archived, current_user, db)
