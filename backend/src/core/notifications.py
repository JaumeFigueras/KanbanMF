#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Hourly due-date e-mail notification job.

Wired into the app's lifespan by src.core.scheduler. Runs against its own
AsyncSessionLocal session rather than a request-scoped one, since it's
triggered by APScheduler on a timer rather than by an HTTP request.
"""

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from src.core.database import AsyncSessionLocal
from src.core.email import send_due_date_reminder_email
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_notification_offset import BoardNotificationOffset
from src.model.board_notification_settings import BoardNotificationSettings
from src.model.card import Card
from src.model.card_assignee import CardAssignee
from src.model.card_due_notification import CardDueNotification
from src.model.user import User
from src.model.user_preferences import UserPreferences

logger = logging.getLogger(__name__)


def _resolve_timezone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo("UTC")


async def send_due_date_notifications() -> None:
    """Scan every enabled (board, user) notification setting and e-mail that
    user about their own assigned cards whose due-date offset or
    overdue-repeat threshold matches today, at their own locally-configured
    notify_hour.

    Settings are per-user: BoardNotificationSettings.user_id is both who the
    setting belongs to AND the only person it can ever cause an e-mail to be
    sent to. A user enabling notifications on a board never opts any other
    assignee on that board in — each person controls only their own row.

    Safe to call repeatedly (e.g. if the process restarts mid-hour): the
    CardDueNotification table dedupes so each (card, recipient, calendar
    day) is notified at most once.
    """
    now_utc = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        settings_result = await db.execute(
            select(BoardNotificationSettings).where(BoardNotificationSettings.is_enabled.is_(True))
        )
        all_settings = list(settings_result.scalars().all())
        if not all_settings:
            return

        prefs_cache: dict = {}

        async def get_prefs(user_id):
            if user_id not in prefs_cache:
                result = await db.execute(
                    select(UserPreferences).where(UserPreferences.user_id == user_id)
                )
                prefs_cache[user_id] = result.scalar_one_or_none()
            return prefs_cache[user_id]

        boards_cache: dict = {}

        async def get_board(board_id):
            if board_id not in boards_cache:
                result = await db.execute(select(Board).where(Board.id == board_id))
                boards_cache[board_id] = result.scalar_one_or_none()
            return boards_cache[board_id]

        users_cache: dict = {}

        async def get_user(user_id):
            if user_id not in users_cache:
                result = await db.execute(select(User).where(User.id == user_id))
                users_cache[user_id] = result.scalar_one_or_none()
            return users_cache[user_id]

        for settings_row in all_settings:
            board = await get_board(settings_row.board_id)
            if board is None or board.is_deleted:
                continue

            recipient = await get_user(settings_row.user_id)
            if recipient is None:
                continue

            prefs = await get_prefs(settings_row.user_id)
            tz = _resolve_timezone(prefs.timezone if prefs else "UTC")
            local_now = now_utc.astimezone(tz)

            # notify_hour is set per (board, user) but interpreted in this
            # user's own timezone, so only proceed once their local clock
            # actually reaches the configured hour.
            if local_now.hour != settings_row.notify_hour:
                continue

            offsets_result = await db.execute(
                select(BoardNotificationOffset.offset_days).where(
                    BoardNotificationOffset.board_id == settings_row.board_id,
                    BoardNotificationOffset.user_id == settings_row.user_id,
                )
            )
            offsets = set(offsets_result.scalars().all())

            # Only cards on this board where settings_row.user_id is
            # themselves an assignee — never any other assignee on the card.
            cards_result = await db.execute(
                select(Card)
                .join(BoardList, Card.list_id == BoardList.id)
                .join(CardAssignee, CardAssignee.card_id == Card.id)
                .where(
                    BoardList.board_id == settings_row.board_id,
                    CardAssignee.user_id == settings_row.user_id,
                    Card.is_archived.is_(False),
                    Card.is_deleted.is_(False),
                    Card.due_at.isnot(None),
                    Card.end_at.is_(None),
                )
            )
            cards = list(cards_result.scalars().all())

            for card in cards:
                due_date_local = card.due_at.astimezone(tz).date()
                today_local = local_now.date()
                days_diff = (today_local - due_date_local).days

                matched_offset = days_diff in offsets
                matched_overdue = (
                    settings_row.overdue_repeat_after_days is not None
                    and days_diff >= settings_row.overdue_repeat_after_days
                )
                if not (matched_offset or matched_overdue):
                    continue

                existing = await db.execute(
                    select(CardDueNotification).where(
                        CardDueNotification.card_id == card.id,
                        CardDueNotification.user_id == recipient.id,
                        CardDueNotification.notification_date == today_local,
                    )
                )
                if existing.scalar_one_or_none() is not None:
                    continue

                language = "ca" if prefs and prefs.language_locale.startswith("ca") else "en"
                try:
                    await send_due_date_reminder_email(
                        email=recipient.email,
                        display_name=recipient.display_name,
                        card_name=card.name,
                        board_name=board.name,
                        board_id=str(board.id),
                        due_at=card.due_at.astimezone(tz),
                        days_diff=days_diff,
                        language=language,
                    )
                except Exception:
                    # Leave no CardDueNotification row on failure so the
                    # next hourly tick retries this (card, recipient) pair.
                    logger.exception(
                        "Failed to send due-date reminder for card %s to user %s",
                        card.id,
                        recipient.id,
                    )
                    continue

                db.add(
                    CardDueNotification(
                        card_id=card.id,
                        user_id=recipient.id,
                        notification_date=today_local,
                    )
                )
                await db.commit()
