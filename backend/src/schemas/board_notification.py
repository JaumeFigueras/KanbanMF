#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from pydantic import BaseModel, field_validator


class BoardNotificationSettingsRead(BaseModel):
    board_id: uuid.UUID
    is_enabled: bool
    notify_hour: int
    offset_days: list[int]
    overdue_repeat_after_days: int | None

    model_config = {"from_attributes": True}


class BoardNotificationSettingsUpdate(BaseModel):
    """Full replacement of a board's e-mail notification settings."""

    is_enabled: bool
    notify_hour: int
    offset_days: list[int]
    overdue_repeat_after_days: int | None

    @field_validator("notify_hour")
    @classmethod
    def notify_hour_in_range(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("notify_hour must be between 0 and 23")
        return v

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
