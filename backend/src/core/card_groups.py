#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Cards gathered from several boards, grouped by board and list the way the
overdue-tasks and search pages show them, and the overdue cards themselves.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.cards import card_load_options, card_people_ids, card_to_read
from src.core.people import people_by_id
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.ui_board_color import UIBoardColor
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_card_color import UICardColor
from src.model.ui_list_color import UIListColor
from src.model.user import User
from src.schemas.board import BoardCardsRead, ListCardsRead, OverdueBoardRead


async def group_cards_by_board(
    rows: list[tuple[Card, BoardList]], current_user: User, db: AsyncSession
) -> list[BoardCardsRead]:
    """Group (card, list) rows by board and list, the way the overdue-tasks and
    search pages show them.

    Cards keep the order of ``rows`` within their list, and lists follow the
    board's own list order. The viewer's personal board/list/card colors ride
    along so the page can paint the columns exactly as the board itself does.
    Cards must come with :func:`src.core.cards.card_load_options` loaded.
    """
    if not rows:
        return []

    # board id -> list id -> its cards, both dicts kept in insertion order,
    # so each list's cards come out in the order of the rows.
    by_board: dict[uuid.UUID, dict[uuid.UUID, list[Card]]] = {}
    lists_by_id: dict[uuid.UUID, BoardList] = {}
    for card, board_list in rows:
        lists_by_id[board_list.id] = board_list
        by_board.setdefault(board_list.board_id, {}).setdefault(board_list.id, []).append(card)

    board_ids = list(by_board)
    board_names_result = await db.execute(
        select(Board.id, Board.name).where(Board.id.in_(board_ids))
    )
    board_names = {row.id: row.name for row in board_names_result.all()}

    people_ids: set[uuid.UUID] = set()
    for card, _ in rows:
        people_ids |= card_people_ids(card)
    people = await people_by_id(people_ids, db)

    # The viewer's own colors, in three batched queries rather than one per
    # entity — mirrors the board page's /boards/{id}/colors.
    board_colors_result = await db.execute(
        select(UIBoardColor.board_id, UIBoardColor.color).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id.in_(board_ids),
        )
    )
    board_colors = {row.board_id: row.color for row in board_colors_result.all()}

    list_colors_result = await db.execute(
        select(UIListColor.list_id, UIListColor.color).where(
            UIListColor.user_id == current_user.id,
            UIListColor.list_id.in_(list(lists_by_id)),
        )
    )
    list_colors = {row.list_id: row.color for row in list_colors_result.all()}

    card_colors_result = await db.execute(
        select(UICardColor.card_id, UICardColor.color).where(
            UICardColor.user_id == current_user.id,
            UICardColor.card_id.in_([card.id for card, _ in rows]),
        )
    )
    card_colors = {row.card_id: row.color for row in card_colors_result.all()}

    order_result = await db.execute(
        select(UIBoardListOrder.board_id, UIBoardListOrder.list_ids).where(
            UIBoardListOrder.board_id.in_(board_ids)
        )
    )
    list_order = {row.board_id: row.list_ids for row in order_result.all()}

    boards: list[BoardCardsRead] = []
    for board_id, cards_by_list in by_board.items():
        # Follow the board's own list order; a list missing from it (older
        # board, an archived list, or a row never written) falls in after
        # the ordered ones.
        ordered_ids = [lid for lid in list_order.get(board_id, []) if lid in cards_by_list]
        ordered_ids += [lid for lid in cards_by_list if lid not in ordered_ids]

        boards.append(
            BoardCardsRead(
                board_id=board_id,
                board_name=board_names.get(board_id, ""),
                color=board_colors.get(board_id),
                card_colors={
                    str(card.id): card_colors[card.id]
                    for cards in cards_by_list.values()
                    for card in cards
                    if card.id in card_colors
                },
                lists=[
                    ListCardsRead(
                        list_id=list_id,
                        list_name=lists_by_id[list_id].name,
                        color=list_colors.get(list_id),
                        cards=[card_to_read(c, people) for c in cards_by_list[list_id]],
                    )
                    for list_id in ordered_ids
                ],
            )
        )
    return boards


async def overdue_boards(current_user: User, db: AsyncSession) -> list[OverdueBoardRead]:
    """Return every overdue card the user can see, grouped by board and list.

    A card counts as overdue when its due date has passed and it has no end
    date — the same "still open, past due" rule the reminder e-mails use (see
    :mod:`src.core.notifications`). Archived and deleted boards, lists and
    cards are all left out, as are templates and boards and lists with
    nothing overdue.

    Boards come back ordered by how many overdue cards they hold (most first),
    lists in the board's own list order, and cards oldest due date first. The
    viewer's personal board/list/card colors ride along so the page can paint
    the columns exactly as the board itself does.
    """
    result = await db.execute(
        select(Card, BoardList)
        .options(*card_load_options())
        .join(BoardList, Card.list_id == BoardList.id)
        .join(Board, BoardList.board_id == Board.id)
        .outerjoin(
            BoardShare,
            (BoardShare.board_id == Board.id) & (BoardShare.user_id == current_user.id),
        )
        .where(
            or_(Board.owner_id == current_user.id, BoardShare.user_id.isnot(None)),
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
            Board.is_template.is_(False),
            BoardList.is_deleted.is_(False),
            BoardList.is_archived.is_(False),
            Card.is_deleted.is_(False),
            Card.is_archived.is_(False),
            Card.due_at.isnot(None),
            Card.due_at < datetime.now(timezone.utc),
            Card.end_at.is_(None),
        )
        .order_by(Card.due_at)
    )
    grouped = await group_cards_by_board(list(result.all()), current_user, db)
    boards = [
        OverdueBoardRead(
            **board.model_dump(),
            overdue_count=sum(len(lst.cards) for lst in board.lists),
        )
        for board in grouped
    ]
    boards.sort(key=lambda b: (-b.overdue_count, b.board_name))
    return boards
