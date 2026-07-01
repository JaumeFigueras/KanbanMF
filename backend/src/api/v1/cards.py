#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.user import User
from src.schemas.card import CardCreate, CardRead, CardUpdate

router = APIRouter()


async def _get_accessible_board(
    board_id: uuid.UUID, user: User, db: AsyncSession
) -> Board:
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != user.id:
        share = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == user.id,
            )
        )
        if share.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return board


async def _get_list(
    board_id: uuid.UUID, list_id: uuid.UUID, db: AsyncSession
) -> BoardList:
    result = await db.execute(
        select(BoardList).where(
            BoardList.id == list_id,
            BoardList.board_id == board_id,
            BoardList.is_deleted.is_(False),
        )
    )
    board_list = result.scalar_one_or_none()
    if board_list is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="List not found")
    return board_list


@router.get("", response_model=list[CardRead])
async def list_cards(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CardRead]:
    """Return all non-deleted cards for a list."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    result = await db.execute(
        select(Card)
        .where(
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
        .order_by(Card.created_at.asc())
    )
    return [CardRead.model_validate(c) for c in result.scalars().all()]


@router.post("", response_model=CardRead, status_code=status.HTTP_201_CREATED)
async def create_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    body: CardCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CardRead:
    """Create a card inside a list."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    card = Card(
        list_id=list_id,
        creator_id=current_user.id,
        name=body.name,
        description=body.description,
        start_at=body.start_at,
        due_at=body.due_at,
        end_at=body.end_at,
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return CardRead.model_validate(card)


@router.patch("/{card_id}", response_model=CardRead)
async def update_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    body: CardUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CardRead:
    """Update a card's name, description, or archived status."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    result = await db.execute(
        select(Card).where(
            Card.id == card_id,
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")

    # A field explicitly sent as `null` clears it; an omitted field leaves it
    # untouched — `is not None` alone can't tell those two cases apart.
    fields_set = body.model_fields_set
    effective_start_at = body.start_at if "start_at" in fields_set else card.start_at
    effective_end_at = body.end_at if "end_at" in fields_set else card.end_at
    if (
        effective_start_at is not None
        and effective_end_at is not None
        and effective_start_at > effective_end_at
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Start date cannot be after end date.",
        )

    if body.name is not None:
        card.name = body.name
    if body.description is not None:
        card.description = body.description
    if body.is_archived is not None:
        card.is_archived = body.is_archived
    if "start_at" in fields_set:
        card.start_at = body.start_at
    if "due_at" in fields_set:
        card.due_at = body.due_at
    if "end_at" in fields_set:
        card.end_at = body.end_at
    await db.commit()
    await db.refresh(card)
    return CardRead.model_validate(card)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete a card by setting is_deleted=True."""
    await _get_accessible_board(board_id, current_user, db)
    await _get_list(board_id, list_id, db)
    result = await db.execute(
        select(Card).where(
            Card.id == card_id,
            Card.list_id == list_id,
            Card.is_deleted.is_(False),
        )
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    card.is_deleted = True
    await db.commit()
