#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.model.board import Board
from src.model.board_notification_offset import BoardNotificationOffset
from src.model.board_notification_settings import BoardNotificationSettings
from src.model.board_share import BoardShare
from src.model.user import User
from src.schemas.board_notification import BoardNotificationSettingsRead, BoardNotificationSettingsUpdate

router = APIRouter()


async def _get_accessible_board(board_id: uuid.UUID, user: User, db: AsyncSession) -> Board:
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


async def _read_settings(board_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> BoardNotificationSettingsRead:
    """Return the calling user's own settings for this board, or sensible defaults if they haven't saved any yet."""
    result = await db.execute(
        select(BoardNotificationSettings).where(
            BoardNotificationSettings.board_id == board_id,
            BoardNotificationSettings.user_id == user_id,
        )
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        return BoardNotificationSettingsRead(
            board_id=board_id,
            is_enabled=False,
            notify_hour=9,
            offset_days=[],
            overdue_repeat_after_days=None,
        )

    offsets_result = await db.execute(
        select(BoardNotificationOffset.offset_days)
        .where(
            BoardNotificationOffset.board_id == board_id,
            BoardNotificationOffset.user_id == user_id,
        )
        .order_by(BoardNotificationOffset.offset_days)
    )

    return BoardNotificationSettingsRead(
        board_id=settings.board_id,
        is_enabled=settings.is_enabled,
        notify_hour=settings.notify_hour,
        offset_days=list(offsets_result.scalars().all()),
        overdue_repeat_after_days=settings.overdue_repeat_after_days,
    )


@router.get("", response_model=BoardNotificationSettingsRead)
async def get_board_notification_settings(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardNotificationSettingsRead:
    """Return the calling user's own due-date e-mail notification settings for this board.

    Accessible to the owner and any shared member — each reads/writes only
    their own row, never another user's.
    """
    await _get_accessible_board(board_id, current_user, db)
    return await _read_settings(board_id, current_user.id, db)


@router.put("", response_model=BoardNotificationSettingsRead)
async def update_board_notification_settings(
    board_id: uuid.UUID,
    body: BoardNotificationSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardNotificationSettingsRead:
    """Replace the calling user's own due-date e-mail notification settings for this board.

    Accessible to the owner and any shared member, for the same reason as the
    GET above — but this only ever writes the caller's own (board_id, user_id)
    row, so enabling notifications can never opt another user (e.g. an
    assignee who hasn't enabled them for themselves) into receiving e-mails.
    The client always sends the full settings object (see
    EmailNotificationDialog), so this is a full replace rather than a partial
    patch: the offset-days list is dropped and re-inserted rather than diffed.
    """
    await _get_accessible_board(board_id, current_user, db)

    await db.execute(
        pg_insert(BoardNotificationSettings)
        .values(
            board_id=board_id,
            user_id=current_user.id,
            is_enabled=body.is_enabled,
            notify_hour=body.notify_hour,
            overdue_repeat_after_days=body.overdue_repeat_after_days,
        )
        .on_conflict_do_update(
            index_elements=["board_id", "user_id"],
            set_={
                "is_enabled": body.is_enabled,
                "notify_hour": body.notify_hour,
                "overdue_repeat_after_days": body.overdue_repeat_after_days,
                "updated_at": func.now(),
            },
        )
    )

    await db.execute(
        delete(BoardNotificationOffset).where(
            BoardNotificationOffset.board_id == board_id,
            BoardNotificationOffset.user_id == current_user.id,
        )
    )
    if body.offset_days:
        db.add_all(
            [
                BoardNotificationOffset(board_id=board_id, user_id=current_user.id, offset_days=d)
                for d in body.offset_days
            ]
        )

    await db.commit()

    return await _read_settings(board_id, current_user.id, db)
