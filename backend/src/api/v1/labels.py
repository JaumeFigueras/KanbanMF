#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.label import Label
from src.model.user import User
from src.schemas.label import LabelCreate, LabelOrderUpdate, LabelRead, LabelUpdate

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


async def _require_owner(board_id: uuid.UUID, user: User, db: AsyncSession) -> Board:
    board = await _get_accessible_board(board_id, user, db)
    if board.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the board owner can manage labels",
        )
    return board


@router.get("", response_model=list[LabelRead])
async def list_labels(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[LabelRead]:
    """Return all labels for the board, in display order. Accessible by owner
    and shared users."""
    await _get_accessible_board(board_id, current_user, db)
    result = await db.execute(
        select(Label)
        .where(Label.board_id == board_id)
        .order_by(Label.position)
    )
    return [LabelRead.model_validate(lbl) for lbl in result.scalars().all()]


@router.post("", response_model=LabelRead, status_code=status.HTTP_201_CREATED)
async def create_label(
    board_id: uuid.UUID,
    body: LabelCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LabelRead:
    """Create a label on the board, appended after any existing labels.
    Owner only."""
    await _require_owner(board_id, current_user, db)
    count_result = await db.execute(
        select(func.count()).select_from(Label).where(Label.board_id == board_id)
    )
    label = Label(
        board_id=board_id,
        name=body.name,
        color=body.color,
        position=count_result.scalar_one(),
    )
    db.add(label)
    await db.commit()
    await db.refresh(label)
    return LabelRead.model_validate(label)


@router.put("/order", response_model=list[LabelRead])
async def update_label_order(
    board_id: uuid.UUID,
    body: LabelOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[LabelRead]:
    """Reorder a board's labels — body must list every label on the board
    exactly once; position is set to each id's index. Owner only."""
    await _require_owner(board_id, current_user, db)
    result = await db.execute(select(Label).where(Label.board_id == board_id))
    labels = {lbl.id: lbl for lbl in result.scalars().all()}
    if set(body.label_ids) != set(labels.keys()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="label_ids must list every label on this board exactly once.",
        )
    for position, label_id in enumerate(body.label_ids):
        labels[label_id].position = position
    await db.commit()

    result = await db.execute(
        select(Label).where(Label.board_id == board_id).order_by(Label.position)
    )
    return [LabelRead.model_validate(lbl) for lbl in result.scalars().all()]


@router.patch("/{label_id}", response_model=LabelRead)
async def update_label(
    board_id: uuid.UUID,
    label_id: uuid.UUID,
    body: LabelUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LabelRead:
    """Rename or recolour a label. Owner only."""
    await _require_owner(board_id, current_user, db)
    result = await db.execute(
        select(Label).where(Label.id == label_id, Label.board_id == board_id)
    )
    label = result.scalar_one_or_none()
    if label is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found")
    if body.name is not None:
        label.name = body.name
    if body.color is not None:
        label.color = body.color
    await db.commit()
    await db.refresh(label)
    return LabelRead.model_validate(label)


@router.delete("/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_label(
    board_id: uuid.UUID,
    label_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a label and remove it from all cards. Owner only."""
    await _require_owner(board_id, current_user, db)
    result = await db.execute(
        select(Label).where(Label.id == label_id, Label.board_id == board_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found")
    await db.execute(delete(Label).where(Label.id == label_id))
    await db.commit()
