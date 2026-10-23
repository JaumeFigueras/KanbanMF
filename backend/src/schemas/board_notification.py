#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for a user's due-date e-mail settings."""

import uuid

from pydantic import BaseModel, field_validator


class BoardNotificationSettingsRead(BaseModel):
    board_id: uuid.UUID
    is_enabled: bool
    notify_hour: int
    notify_weekdays: list[int]
    offset_days: list[int]
    overdue_repeat_after_days: int | None

    model_config = {"from_attributes": True}


class BoardNotificationSettingsUpdate(BaseModel):
    """Full replacement of a board's e-mail notification settings.

    notify_weekdays lists the ISO weekdays (1 = Monday ... 7 = Sunday) on
    which e-mails may be sent; a reminder falling on any other day is
    skipped, not postponed. At least one day must be selected — switching
    every day off is what is_enabled is for.
    """

    is_enabled: bool
    notify_hour: int
    notify_weekdays: list[int]
    offset_days: list[int]
    overdue_repeat_after_days: int | None

    @field_validator("notify_hour")
    @classmethod
    def notify_hour_in_range(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("notify_hour must be between 0 and 23")
        return v

    @field_validator("notify_weekdays")
    @classmethod
    def notify_weekdays_valid(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("notify_weekdays must contain at least one day")
        if any(not 1 <= d <= 7 for d in v):
            raise ValueError("notify_weekdays must be ISO weekdays between 1 (Monday) and 7 (Sunday)")
        return sorted(set(v))

    @field_validator("overdue_repeat_after_days")
    @classmethod
    def overdue_repeat_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("overdue_repeat_after_days must be at least 1")
        return v

    @field_validator("offset_days")
    @classmethod
    def offset_days_dedup_sorted(cls, v: list[int]) -> list[int]:
        return sorted(set(v))
