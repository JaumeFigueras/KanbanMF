#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The MCP server's read tools: the connection's boards, one board with its
lists and cards, one card in full, card search and overdue cards.

Every tool reaches only the boards of the caller's grant (see
:mod:`src.api.mcp_server.context`), and answers with plain JSON: ids as
strings, dates as ISO 8601 in UTC, empty fields left out of card summaries
to keep answers short.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import Field
from sqlalchemy import select

from src.api.mcp_server.context import (
    current_grant,
    open_session,
    reachable_board,
    reachable_boards,
    reachable_card,
    tool_errors,
)
from src.core.card_groups import overdue_boards
from src.core.card_replacement import board_user_ids
from src.core.cards import card_load_options, cards_to_read
from src.core.config import settings
from src.core.people import people_by_id
from src.core.search import search_cards as core_search_cards
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.card import Card
from src.model.label import Label
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user_preferences import UserPreferences
from src.schemas.board import BoardCardsRead
from src.schemas.card import CardRead

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)

BoardId = Annotated[uuid.UUID, Field(description="A board id, from list_boards.")]
CardId = Annotated[uuid.UUID, Field(description="A card id, from get_board or search_cards.")]


def _iso(value: datetime | None) -> str | None:
    """ISO 8601 in UTC, as the server's instructions promise (the database
    hands dates back in its own session's time zone)."""
    return value.astimezone(timezone.utc).isoformat() if value else None


def board_url(board_id: uuid.UUID) -> str:
    """The board's address in the web app, to hand to the user."""
    return f"{settings.frontend_url.rstrip('/')}/boards/{board_id}"


def card_summary(card: CardRead) -> dict:
    """A card in a few fields: what a board overview needs."""
    items = [item for checklist in card.checklists for item in checklist.items]
    summary: dict = {"id": str(card.id), "name": card.name}
    for field in ("start_at", "due_at", "end_at"):
        if getattr(card, field):
            summary[field] = _iso(getattr(card, field))
    if card.labels:
        summary["labels"] = [label.name for label in card.labels]
    if card.assignees:
        summary["assignees"] = [person.display_name for person in card.assignees]
    if items:
        summary["checklist"] = f"{sum(item.is_done for item in items)}/{len(items)}"
    if card.description:
        summary["has_description"] = True
    if card.is_archived:
        summary["archived"] = True
    return summary


def card_detail(card: CardRead, board: Board, board_list: BoardList) -> dict:
    """A card with everything on it, ids included, for reading or changing it."""
    return {
        "id": str(card.id),
        "name": card.name,
        "description": card.description,
        "board": {"id": str(board.id), "name": board.name},
        "list": {"id": str(board_list.id), "name": board_list.name},
        "archived": card.is_archived or board_list.is_archived,
        "start_at": _iso(card.start_at),
        "due_at": _iso(card.due_at),
        "end_at": _iso(card.end_at),
        "labels": [{"id": str(lbl.id), "name": lbl.name} for lbl in card.labels],
        "assignees": [{"id": str(p.id), "name": p.display_name} for p in card.assignees],
        "members": [{"id": str(p.id), "name": p.display_name} for p in card.members],
        "creator": card.creator.display_name if card.creator else None,
        "checklists": [
            {
                "id": str(checklist.id),
                "name": checklist.name,
                "items": [
                    {"id": str(item.id), "text": item.text, "done": item.is_done}
                    for item in sorted(checklist.items, key=lambda i: i.position)
                ],
            }
            for checklist in sorted(card.checklists, key=lambda c: c.position)
        ],
        "created_at": _iso(card.created_at),
        "updated_at": _iso(card.updated_at),
        "url": board_url(board.id),
    }


def _grouped(boards: list[BoardCardsRead]) -> list[dict]:
    return [
        {
            "board": {"id": str(b.board_id), "name": b.board_name},
            "lists": [
                {"id": str(lst.list_id), "name": lst.list_name, "cards": [card_summary(c) for c in lst.cards]}
                for lst in b.lists
            ],
        }
        for b in boards
    ]


@tool_errors
async def list_boards() -> dict:
    """List the KanbanMF boards this connection can reach, with the user's
    name, time zone and current local time (for reading and setting due
    dates), and whether the connection is read-only. Start here: the other
    tools take the board ids it returns."""
    async with open_session() as db:
        grant = await current_grant(db)
        boards = await reachable_boards(grant, db)
        prefs = await db.get(UserPreferences, grant.user_id)
        tz_name = prefs.timezone if prefs else "UTC"
        try:
            tz = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            tz_name, tz = "UTC", ZoneInfo("UTC")
        return {
            "user": grant.user.display_name,
            "timezone": tz_name,
            "now": datetime.now(tz).isoformat(timespec="minutes"),
            "read_only": grant.read_only,
            "boards": [{"id": str(b.id), "name": b.name, "url": board_url(b.id)} for b in boards],
        }


@tool_errors
async def get_board(board_id: BoardId) -> dict:
    """Get one board: its lists in order, each with its live cards in order
    (summarised: dates, labels, assignees, checklist progress), plus the
    board's labels and the people on it. Use get_card for a card's
    description and checklist items."""
    async with open_session() as db:
        grant = await current_grant(db)
        board = await reachable_board(grant, board_id, db)

        lists_result = await db.execute(
            select(BoardList)
            .where(
                BoardList.board_id == board.id,
                BoardList.is_deleted.is_(False),
                BoardList.is_archived.is_(False),
            )
            .order_by(BoardList.created_at)
        )
        lists = list(lists_result.scalars().all())
        order = await db.get(UIBoardListOrder, board.id)
        position = {lid: i for i, lid in enumerate(order.list_ids if order else [])}
        lists.sort(key=lambda lst: position.get(lst.id, len(position)))

        cards_result = await db.execute(
            select(Card)
            .options(*card_load_options())
            .where(
                Card.list_id.in_([lst.id for lst in lists]),
                Card.is_deleted.is_(False),
                Card.is_archived.is_(False),
            )
            .order_by(Card.created_at)
        )
        cards = await cards_to_read(list(cards_result.scalars().all()), db)
        card_orders_result = await db.execute(
            select(UIListCardOrder).where(UIListCardOrder.list_id.in_([lst.id for lst in lists]))
        )
        card_position = {
            card_id: i for row in card_orders_result.scalars() for i, card_id in enumerate(row.card_ids)
        }
        cards.sort(key=lambda c: card_position.get(c.id, len(card_position)))

        labels_result = await db.execute(
            select(Label).where(Label.board_id == board.id).order_by(Label.position)
        )
        people = await people_by_id(await board_user_ids(board, db), db)

        return {
            "id": str(board.id),
            "name": board.name,
            "url": board_url(board.id),
            "labels": [{"id": str(lbl.id), "name": lbl.name} for lbl in labels_result.scalars()],
            "people": sorted(
                ({"id": str(p.id), "name": p.display_name} for p in people.values()), key=lambda p: p["name"]
            ),
            "lists": [
                {
                    "id": str(lst.id),
                    "name": lst.name,
                    "cards": [card_summary(c) for c in cards if c.list_id == lst.id],
                }
                for lst in lists
            ],
        }


@tool_errors
async def get_card(board_id: BoardId, card_id: CardId) -> dict:
    """Get one card in full: description, dates, labels, people and its
    checklists with every item, all with their ids."""
    async with open_session() as db:
        grant = await current_grant(db)
        board, board_list, card = await reachable_card(grant, board_id, card_id, db, card_load_options())
        return card_detail((await cards_to_read([card], db))[0], board, board_list)


@tool_errors
async def search_cards(
    query: Annotated[str, Field(description="Words to find; every word must match. At least 2 characters.")],
    board_id: Annotated[uuid.UUID | None, Field(description="Search only this board.")] = None,
    archived: Annotated[bool, Field(description="Search the board's archive instead (needs board_id).")] = False,
) -> dict:
    """Search cards by words in their name, description, checklists or label
    names, ignoring case and accents — across every board of this connection,
    or one board. Results are grouped by board and list."""
    if len(query.strip()) < 2:
        raise ToolError("The query needs at least 2 characters.")
    if archived and board_id is None:
        raise ToolError("Searching an archive needs a board_id.")
    async with open_session() as db:
        grant = await current_grant(db)
        if board_id is not None:
            await reachable_board(grant, board_id, db)
        reachable = {b.id for b in await reachable_boards(grant, db)}
        results = await core_search_cards(
            query.strip(), board_id, archived, grant.user, db, only_board_ids=reachable
        )
        return {"truncated": results.truncated, "boards": _grouped(results.boards)}


@tool_errors
async def list_overdue() -> dict:
    """List the overdue cards — due date passed, no end date — on this
    connection's boards, grouped by board and list, oldest due date first."""
    async with open_session() as db:
        grant = await current_grant(db)
        reachable = {b.id for b in await reachable_boards(grant, db)}
        boards = [b for b in await overdue_boards(grant.user, db) if b.board_id in reachable]
        return {"boards": _grouped(boards)}


def register_read_tools(server: MCPServer) -> None:
    """Add the read tools to the server."""
    for fn in (list_boards, get_board, get_card, search_cards, list_overdue):
        server.tool(annotations=READ_ONLY)(fn)
