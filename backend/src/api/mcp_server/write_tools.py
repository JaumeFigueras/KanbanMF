#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The MCP server's write tools: create, edit, move, archive and restore
cards, add lists, and add or tick checklist items.

Each goes through the same :mod:`src.core` operations as the web app, so the
same rules apply and everyone with the board open sees the change at once.
They refuse to run on a read-only connection, reach only the boards of the
caller's grant, and never delete anything: archiving is the way to remove a
card, and it can be undone with ``restore_card``.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.mcp_server.context import (
    NOT_REACHABLE,
    current_grant,
    open_session,
    reachable_board,
    reachable_card,
    tool_errors,
)
from src.api.mcp_server.read_tools import BoardId, CardId, card_detail
from src.core import cards as card_service
from src.core import checklists as checklist_service
from src.core import lists as list_service
from src.core.card_replacement import board_user_ids
from src.core.cards import card_load_options, cards_to_read
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.card import Card
from src.model.label import Label
from src.model.mcp_grant import McpGrant
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user_preferences import UserPreferences
from src.schemas.card import CardCreate, CardUpdate
from src.schemas.checklist import ChecklistCreate, ChecklistItemCreate, ChecklistItemUpdate

# Changes things, but nothing a user can't undo: archived cards come back
# with restore_card.
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)

ListId = Annotated[uuid.UUID, Field(description="A list id, from get_board.")]
ChecklistId = Annotated[uuid.UUID, Field(description="A checklist id, from get_card.")]
Date = Annotated[
    datetime | None,
    Field(description="ISO 8601 date and time, e.g. 2026-11-06T17:00:00+01:00. "
                      "Without an offset it is taken in the user's time zone (see list_boards)."),
]
Position = Annotated[
    int | None,
    Field(description="0-based position in the list, 0 being the top. Left out: the card stays "
                      "where the board puts it (new cards go below the ordered ones).", ge=0),
]
LabelIds = Annotated[list[uuid.UUID], Field(description="Label ids of this board, from get_board.")]
PersonIds = Annotated[list[uuid.UUID], Field(description="Ids of people on this board, from get_board.")]


async def _writable_grant(db: AsyncSession) -> McpGrant:
    grant = await current_grant(db)
    if grant.read_only:
        raise ToolError(
            "This connection is read-only, so it can't change anything. "
            "The user can allow changes in KanbanMF's Connected apps."
        )
    return grant


async def _user_tz(grant: McpGrant, db: AsyncSession) -> ZoneInfo:
    prefs = await db.get(UserPreferences, grant.user_id)
    try:
        return ZoneInfo(prefs.timezone if prefs else "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _aware(value: datetime | None, tz: ZoneInfo) -> datetime | None:
    """A date without an offset is in the user's time zone, as they would
    have meant it."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=tz)
    return value


async def _live_list(board: Board, list_id: uuid.UUID, db: AsyncSession) -> BoardList:
    """A list of the board that is neither archived nor deleted."""
    result = await db.execute(
        select(BoardList).where(
            BoardList.id == list_id,
            BoardList.board_id == board.id,
            BoardList.is_deleted.is_(False),
            BoardList.is_archived.is_(False),
        )
    )
    board_list = result.scalar_one_or_none()
    if board_list is None:
        raise ToolError(NOT_REACHABLE)
    return board_list


async def _check_ids(
    board: Board, label_ids: list[uuid.UUID] | None, person_ids: list[uuid.UUID] | None, db: AsyncSession
) -> None:
    """Refuse labels of another board and people not on this one, rather than
    dropping them silently as the web app's routes do: the model should learn
    that its id was wrong."""
    if label_ids:
        result = await db.execute(select(Label.id).where(Label.board_id == board.id))
        unknown = set(label_ids) - set(result.scalars().all())
        if unknown:
            raise ToolError(f"Not labels of this board: {', '.join(map(str, unknown))}. See get_board.")
    if person_ids:
        unknown = set(person_ids) - await board_user_ids(board, db)
        if unknown:
            raise ToolError(f"Not people on this board: {', '.join(map(str, unknown))}. See get_board.")


async def _place(
    grant: McpGrant, board: Board, list_id: uuid.UUID, card_id: uuid.UUID, position: int, db: AsyncSession
) -> None:
    """Put the card at ``position`` among the list's live cards, in the order
    the board shows them."""
    result = await db.execute(
        select(Card.id)
        .where(Card.list_id == list_id, Card.is_deleted.is_(False), Card.is_archived.is_(False))
        .order_by(Card.created_at)
    )
    ids = list(result.scalars().all())
    order = await db.get(UIListCardOrder, list_id)
    rank = {cid: i for i, cid in enumerate(order.card_ids if order else [])}
    ids.sort(key=lambda cid: rank.get(cid, len(rank)))
    ids.remove(card_id)
    ids.insert(min(position, len(ids)), card_id)
    await card_service.set_card_order(board.id, list_id, ids, grant.user, db, None)


async def _answer(grant: McpGrant, board_id: uuid.UUID, card_id: uuid.UUID, db: AsyncSession) -> dict:
    """The card as it now is, in get_card's shape (read again from the
    database, checklists and labels included)."""
    board, board_list, card = await reachable_card(
        grant, board_id, card_id, db, card_load_options(), refresh=True
    )
    return card_detail((await cards_to_read([card], db))[0], board, board_list)


@tool_errors
async def create_card(
    board_id: BoardId,
    list_id: ListId,
    name: Annotated[str, Field(description="The card's name.")],
    description: Annotated[str | None, Field(description="Longer text; Markdown is fine.")] = None,
    start_at: Date = None,
    due_at: Date = None,
    label_ids: LabelIds = [],
    assignee_ids: PersonIds = [],
    position: Position = None,
) -> dict:
    """Create a card in a list. The user becomes its creator and a member.
    Returns the new card, as get_card does."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board = await reachable_board(grant, board_id, db)
        await _live_list(board, list_id, db)
        await _check_ids(board, label_ids, assignee_ids, db)
        tz = await _user_tz(grant, db)
        card = await card_service.create_card(
            board.id, list_id,
            CardCreate(name=name, description=description, start_at=_aware(start_at, tz),
                       due_at=_aware(due_at, tz), label_ids=label_ids, assignee_ids=assignee_ids),
            grant.user, db, None,
        )
        if position is not None:
            await _place(grant, board, list_id, card.id, position, db)
        return await _answer(grant, board.id, card.id, db)


@tool_errors
async def update_card(
    board_id: BoardId,
    card_id: CardId,
    name: Annotated[str | None, Field(description="New name.")] = None,
    description: Annotated[str | None, Field(description="New description (replaces the old one).")] = None,
    start_at: Date = None,
    due_at: Date = None,
    end_at: Annotated[datetime | None, Field(
        description="When the work was finished: setting it marks the card done (it stops being "
                    "overdue). ISO 8601, as for due_at.")] = None,
    label_ids: Annotated[list[uuid.UUID] | None, Field(
        description="The card's labels from now on (replaces them); board label ids.")] = None,
    assignee_ids: Annotated[list[uuid.UUID] | None, Field(
        description="The card's assignees from now on (replaces them); ids of people on the board.")] = None,
    clear: Annotated[list[Literal["description", "start_at", "due_at", "end_at"]], Field(
        description="Fields to empty, e.g. ['due_at'] to remove the due date.")] = [],
) -> dict:
    """Change a card's name, description, dates, labels or assignees. Only
    the arguments given change. Returns the card as it now is."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board, board_list, _ = await reachable_card(grant, board_id, card_id, db)
        await _check_ids(board, label_ids, assignee_ids, db)
        tz = await _user_tz(grant, db)
        fields: dict = {}
        for key, value in (("name", name), ("description", description), ("label_ids", label_ids),
                           ("assignee_ids", assignee_ids)):
            if value is not None:
                fields[key] = value
        for key, value in (("start_at", start_at), ("due_at", due_at), ("end_at", end_at)):
            if value is not None:
                fields[key] = _aware(value, tz)
        for key in clear:
            if key in fields:
                raise ToolError(f"{key} is both set and cleared.")
            # The web app clears a description by saving it empty.
            fields[key] = "" if key == "description" else None
        if not fields:
            raise ToolError("Nothing to change: give at least one field.")
        await card_service.update_card(
            board.id, board_list.id, card_id, CardUpdate(**fields), grant.user, db, None
        )
        return await _answer(grant, board.id, card_id, db)


@tool_errors
async def move_card(
    board_id: BoardId,
    card_id: CardId,
    list_id: Annotated[uuid.UUID, Field(description="The list to move it to (may be its own list, to reorder).")],
    position: Position = None,
) -> dict:
    """Move a card to another list of the same board, or to another place in
    its list. Returns the card as it now is."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board, board_list, card = await reachable_card(grant, board_id, card_id, db)
        if card.is_archived or board_list.is_archived:
            raise ToolError("The card is archived; restore it first.")
        await _live_list(board, list_id, db)
        if list_id != board_list.id:
            await card_service.update_card(
                board.id, board_list.id, card_id, CardUpdate(list_id=list_id), grant.user, db, None
            )
        if position is not None:
            await _place(grant, board, list_id, card_id, position, db)
        return await _answer(grant, board.id, card_id, db)


@tool_errors
async def archive_card(board_id: BoardId, card_id: CardId) -> dict:
    """Archive a card: it leaves the board but stays in the board's archive,
    and restore_card brings it back. This is how cards are removed; nothing
    is ever deleted."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board, board_list, _ = await reachable_card(grant, board_id, card_id, db)
        await card_service.update_card(
            board.id, board_list.id, card_id, CardUpdate(is_archived=True), grant.user, db, None
        )
        return await _answer(grant, board.id, card_id, db)


@tool_errors
async def restore_card(board_id: BoardId, card_id: CardId) -> dict:
    """Bring an archived card back to its list. Find archived cards with
    search_cards(archived=true)."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board, board_list, _ = await reachable_card(grant, board_id, card_id, db)
        await card_service.update_card(
            board.id, board_list.id, card_id, CardUpdate(is_archived=False), grant.user, db, None
        )
        return await _answer(grant, board.id, card_id, db)


@tool_errors
async def create_list(
    board_id: BoardId,
    name: Annotated[str, Field(description="The list's name, e.g. 'In progress'.")],
) -> dict:
    """Add a list at the right end of a board."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board = await reachable_board(grant, board_id, db)
        if not name.strip():
            raise ToolError("The list needs a name.")
        board_list = await list_service.create_list(board.id, name.strip(), grant.user, db, None)
        return {"id": str(board_list.id), "name": board_list.name}


@tool_errors
async def add_checklist(
    board_id: BoardId,
    card_id: CardId,
    name: Annotated[str, Field(description="The checklist's name, e.g. 'Steps'.")],
    items: Annotated[list[str], Field(description="The items, in order, all unticked.")] = [],
) -> dict:
    """Add a checklist to a card, with its items. Returns the card as it now is."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board, board_list, _ = await reachable_card(grant, board_id, card_id, db)
        bodies = [ChecklistItemCreate(text=text) for text in items]  # validate all before writing
        checklist = await checklist_service.create_checklist(
            board.id, board_list.id, card_id, ChecklistCreate(name=name), grant.user, db, None
        )
        for body in bodies:
            await checklist_service.create_checklist_item(
                board.id, board_list.id, card_id, checklist.id, body, grant.user, db, None
            )
        return await _answer(grant, board.id, card_id, db)


@tool_errors
async def add_checklist_item(
    board_id: BoardId,
    card_id: CardId,
    checklist_id: ChecklistId,
    text: Annotated[str, Field(description="The item's text.")],
) -> dict:
    """Add an item at the end of one of a card's checklists. Returns the card
    as it now is."""
    async with open_session() as db:
        grant = await _writable_grant(db)
        board, board_list, _ = await reachable_card(grant, board_id, card_id, db)
        await checklist_service.create_checklist_item(
            board.id, board_list.id, card_id, checklist_id, ChecklistItemCreate(text=text), grant.user, db, None
        )
        return await _answer(grant, board.id, card_id, db)


@tool_errors
async def update_checklist_item(
    board_id: BoardId,
    card_id: CardId,
    checklist_id: ChecklistId,
    item_id: Annotated[uuid.UUID, Field(description="The item's id, from get_card.")],
    done: Annotated[bool | None, Field(description="Tick (true) or untick (false) the item.")] = None,
    text: Annotated[str | None, Field(description="New text.")] = None,
) -> dict:
    """Tick or untick a checklist item, or change its text. Returns the card
    as it now is."""
    if done is None and text is None:
        raise ToolError("Nothing to change: give done or text.")
    async with open_session() as db:
        grant = await _writable_grant(db)
        board, board_list, _ = await reachable_card(grant, board_id, card_id, db)
        await checklist_service.update_checklist_item(
            board.id, board_list.id, card_id, checklist_id, item_id,
            ChecklistItemUpdate(text=text, is_done=done), grant.user, db, None,
        )
        return await _answer(grant, board.id, card_id, db)


def register_write_tools(server: MCPServer) -> None:
    """Add the write tools to the server."""
    for fn in (create_card, update_card, move_card, archive_card, restore_card, create_list,
               add_checklist, add_checklist_item, update_checklist_item):
        server.tool(annotations=WRITE)(fn)
