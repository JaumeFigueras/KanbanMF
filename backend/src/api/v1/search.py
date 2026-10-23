#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Route for searching cards: across every board you can see, within one
board, in one board's archive, or across your archived boards.
"""

import unicodedata
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.api.v1.boards import _check_board_access, group_cards_by_board
from src.api.v1.cards import _card_load_options
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.card_label import CardLabel
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.label import Label
from src.model.ui_board_color import UIBoardColor
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user import User
from src.schemas.board import SearchBoardMatch, SearchBoardRead, SearchResults

router = APIRouter()

# The most cards one search returns; SearchResults.truncated says when more
# matched.
SEARCH_LIMIT = 200


def _escape_like(word: str) -> str:
    """Escape LIKE's wildcards, so ``%`` and ``_`` in a search match themselves."""
    return word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _contains(column, word: str):
    """SQL condition: the column holds the word, ignoring case and accents."""
    pattern = f"%{_escape_like(word)}%"
    return func.unaccent(column).ilike(func.unaccent(pattern), escape="\\")


def _card_matches(word: str):
    """SQL condition: the word is in one of the card's searched fields."""
    return or_(
        _contains(Card.name, word),
        _contains(Card.description, word),
        exists().where(Checklist.card_id == Card.id, _contains(Checklist.name, word)),
        exists().where(
            ChecklistItem.checklist_id == Checklist.id,
            Checklist.card_id == Card.id,
            _contains(ChecklistItem.text, word),
        ),
        exists().where(
            CardLabel.card_id == Card.id,
            Label.id == CardLabel.label_id,
            _contains(Label.name, word),
        ),
    )


def _fold(text: str) -> str:
    """Lowercase and strip accents, close enough to unaccent() + ILIKE to tell
    which field a word was found in."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _matched_in(card: Card, words: list[str]) -> list[str]:
    """Which of the card's fields hold at least one of the words."""
    fields = {
        "name": [card.name],
        "description": [card.description or ""],
        "checklist": [cl.name for cl in card.checklists]
        + [item.text for cl in card.checklists for item in cl.items],
        "label": [lbl.name for lbl in card.labels],
    }
    folded_words = [_fold(w) for w in words]
    return [
        field
        for field, texts in fields.items()
        if any(w in _fold(text) for text in texts for w in folded_words)
    ]


@router.get("", response_model=SearchResults)
async def search(
    q: str = Query(min_length=2, max_length=200),
    board_id: uuid.UUID | None = None,
    archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResults:
    """Find the cards that hold every word of ``q`` in their name,
    description, checklists (names and items) or label names, ignoring case
    and accents.

    Where it looks depends on ``board_id`` and ``archived``:

    - neither: the live cards of every live board the user can see;
    - ``board_id``: the live cards of that board;
    - ``board_id`` and ``archived``: that board's archive — archived cards,
      and the cards of archived lists;
    - ``archived`` alone: every card of the user's own archived boards,
      archived or not (an archived board is only ever shown to its owner).

    Without ``board_id``, the boards whose name holds every word come back
    too, in ``matching_boards``. Cards are grouped by board (most matches
    first) and list (in the board's order), each list's cards in their
    custom order. At most :data:`SEARCH_LIMIT` cards come back, the most
    recently changed first; ``truncated`` says when more matched.
    """
    words = q.split()
    if board_id is not None:
        await _check_board_access(board_id, current_user, db)

    board_scope = [Board.is_deleted.is_(False)]
    if archived and board_id is None:
        board_scope += [Board.owner_id == current_user.id, Board.is_archived.is_(True)]
    else:
        board_scope.append(or_(Board.owner_id == current_user.id, BoardShare.user_id.isnot(None)))
        if board_id is None:
            board_scope.append(Board.is_archived.is_(False))
        else:
            board_scope.append(Board.id == board_id)

    card_scope = [BoardList.is_deleted.is_(False), Card.is_deleted.is_(False)]
    if not archived:
        card_scope += [BoardList.is_archived.is_(False), Card.is_archived.is_(False)]
    elif board_id is not None:
        card_scope.append(or_(Card.is_archived.is_(True), BoardList.is_archived.is_(True)))

    result = await db.execute(
        select(Card, BoardList)
        .options(*_card_load_options())
        .join(BoardList, Card.list_id == BoardList.id)
        .join(Board, BoardList.board_id == Board.id)
        .outerjoin(
            BoardShare,
            (BoardShare.board_id == Board.id) & (BoardShare.user_id == current_user.id),
        )
        .where(
            *board_scope,
            Board.is_template.is_(False),  # templates hold no cards anyway
            *card_scope,
            *(_card_matches(w) for w in words),
        )
        .order_by(Card.updated_at.desc(), Card.id)
        .limit(SEARCH_LIMIT + 1)
    )
    rows = list(result.all())
    truncated = len(rows) > SEARCH_LIMIT
    rows = rows[:SEARCH_LIMIT]

    # Each list's cards in its custom order; cards missing from it (never
    # dragged, or archived) after the ordered ones, oldest first.
    list_ids = {board_list.id for _, board_list in rows}
    order_result = await db.execute(
        select(UIListCardOrder.list_id, UIListCardOrder.card_ids).where(
            UIListCardOrder.list_id.in_(list_ids)
        )
    )
    position = {
        card_id: index
        for row in order_result.all()
        for index, card_id in enumerate(row.card_ids)
    }
    rows.sort(key=lambda row: (position.get(row[0].id, len(position)), row[0].created_at))

    grouped = await group_cards_by_board(rows, current_user, db)
    cards_by_id = {card.id: card for card, _ in rows}
    boards = [
        SearchBoardRead(
            **board.model_dump(),
            match_count=sum(len(lst.cards) for lst in board.lists),
            matched_in={
                str(card.id): _matched_in(cards_by_id[card.id], words)
                for lst in board.lists
                for card in lst.cards
            },
        )
        for board in grouped
    ]
    boards.sort(key=lambda b: (-b.match_count, b.board_name.lower()))

    matching_boards: list[SearchBoardMatch] = []
    if board_id is None:
        boards_result = await db.execute(
            select(Board, UIBoardColor.color)
            .outerjoin(
                BoardShare,
                (BoardShare.board_id == Board.id) & (BoardShare.user_id == current_user.id),
            )
            .outerjoin(
                UIBoardColor,
                and_(UIBoardColor.board_id == Board.id, UIBoardColor.user_id == current_user.id),
            )
            # Templates are on the boards page too, so their names count here.
            .where(*board_scope, *(_contains(Board.name, w) for w in words))
            .order_by(func.lower(Board.name))
        )
        matching_boards = [
            SearchBoardMatch(board_id=board.id, board_name=board.name, color=color)
            for board, color in boards_result.all()
        ]

    return SearchResults(boards=boards, matching_boards=matching_boards, truncated=truncated)
