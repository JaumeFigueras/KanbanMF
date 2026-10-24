#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""What every MCP tool shares: a database session, the grant behind the
caller's access token, the boards that grant may reach, and the translation of
the core's ``HTTPException``\\s into tool errors.
"""

import functools
import uuid
from collections.abc import Awaitable, Callable
from typing import ParamSpec, TypeVar

from fastapi import HTTPException, status
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.database import AsyncSessionLocal
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.card import Card
from src.model.mcp_grant import McpGrant

# One message for "doesn't exist" and "exists but isn't yours to see": the
# caller can't tell a board outside the connection from one that isn't there.
NOT_REACHABLE = "Not found, or not shared with this connection."

P = ParamSpec("P")
R = TypeVar("R")


def open_session() -> AsyncSession:
    """A database session for one tool call (patched by the tests)."""
    return AsyncSessionLocal()


def _http_message(error: HTTPException) -> str:
    if error.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND):
        return NOT_REACHABLE
    detail = error.detail
    if isinstance(detail, dict) and detail.get("code") == "card_replaced":
        return (
            "This card was archived and replaced by a copy when someone on it left the board; "
            "it can't be restored. Work on the copy instead."
        )
    if isinstance(detail, dict) and detail.get("code") == "former_people":
        return (
            "This card can't be restored: it holds people who have left the board ("
            + ", ".join(detail.get("names", []))
            + "). It can be copied instead."
        )
    return str(detail)


def tool_errors(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
    """Report the core's errors as tool errors the model can read and act on.

    ``functools.wraps`` keeps the signature, which the MCP SDK reads to build
    the tool's input schema.
    """

    @functools.wraps(fn)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await fn(*args, **kwargs)
        except ToolError:
            raise
        except HTTPException as error:
            raise ToolError(_http_message(error)) from None
        except ValidationError as error:
            raise ToolError("Invalid arguments: " + "; ".join(e["msg"] for e in error.errors())) from None
        except ValueError as error:
            raise ToolError(str(error)) from None

    return wrapper


async def current_grant(db: AsyncSession) -> McpGrant:
    """The grant behind the access token of the current request, with its user
    and boards, read again from the database so a change made a moment ago in
    the connected apps list already counts."""
    token = get_access_token()
    grant_id = (token.claims or {}).get("grant_id") if token else None
    if not grant_id:
        raise ToolError("Not authenticated.")
    result = await db.execute(
        select(McpGrant)
        .options(selectinload(McpGrant.user), selectinload(McpGrant.boards))
        .where(McpGrant.id == uuid.UUID(grant_id))
    )
    grant = result.scalar_one_or_none()
    if grant is None or not grant.user.is_active or not grant.user.is_verified:
        raise ToolError("This connection has been revoked.")
    return grant


def _reachable(grant: McpGrant):
    """SQL conditions for the boards a grant reaches: ticked for it, still the
    user's own, live, and not a template."""
    return (
        Board.id.in_([b.board_id for b in grant.boards]),
        Board.owner_id == grant.user_id,
        Board.is_deleted.is_(False),
        Board.is_archived.is_(False),
        Board.is_template.is_(False),
    )


async def reachable_boards(grant: McpGrant, db: AsyncSession) -> list[Board]:
    """The boards the grant reaches, by name."""
    result = await db.execute(select(Board).where(*_reachable(grant)).order_by(Board.name))
    return list(result.scalars().all())


async def reachable_board(grant: McpGrant, board_id: uuid.UUID, db: AsyncSession) -> Board:
    """One board the grant reaches, or a tool error."""
    result = await db.execute(select(Board).where(Board.id == board_id, *_reachable(grant)))
    board = result.scalar_one_or_none()
    if board is None:
        raise ToolError(NOT_REACHABLE)
    return board


async def reachable_card(
    grant: McpGrant,
    board_id: uuid.UUID,
    card_id: uuid.UUID,
    db: AsyncSession,
    options: tuple = (),
    refresh: bool = False,
) -> tuple[Board, BoardList, Card]:
    """A non-deleted card of a board the grant reaches, with its list.

    ``refresh`` reloads the card and the relationships in ``options`` even if
    the session already holds them, as after a change made in this session.
    """
    board = await reachable_board(grant, board_id, db)
    result = await db.execute(
        select(Card, BoardList)
        .options(*options)
        .execution_options(populate_existing=refresh)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(
            Card.id == card_id,
            Card.is_deleted.is_(False),
            BoardList.board_id == board_id,
            BoardList.is_deleted.is_(False),
        )
    )
    row = result.one_or_none()
    if row is None:
        raise ToolError(NOT_REACHABLE)
    return board, row[1], row[0]
