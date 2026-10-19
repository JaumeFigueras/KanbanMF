#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the Pydantic schemas in src/schemas/board_notification.py.

Pure validation tests, no database or HTTP layer — focused on the
notify_weekdays field of BoardNotificationSettingsUpdate.
"""

import pytest
from pydantic import ValidationError

from src.schemas.board_notification import BoardNotificationSettingsUpdate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _update_kwargs(**overrides) -> dict:
    """Return a valid set of BoardNotificationSettingsUpdate kwargs, overridden by kwargs."""
    defaults = dict(
        is_enabled=True,
        notify_hour=9,
        notify_weekdays=[1, 2, 3, 4, 5],
        offset_days=[],
        overdue_repeat_after_days=None,
    )
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# 01 – notify_weekdays is deduplicated and sorted
# ---------------------------------------------------------------------------

def test_board_notification_schema_01() -> None:
    """
    Verify notify_weekdays comes out sorted and without duplicates.

    Raises
    ------
    AssertionError
        If the validated list is not [1, 3, 7].
    """
    body = BoardNotificationSettingsUpdate(**_update_kwargs(notify_weekdays=[7, 1, 3, 1]))
    assert body.notify_weekdays == [1, 3, 7]


# ---------------------------------------------------------------------------
# 02 – An empty selection is rejected
# ---------------------------------------------------------------------------

def test_board_notification_schema_02() -> None:
    """
    Verify an empty notify_weekdays list is rejected.

    Raises
    ------
    AssertionError
        If no ValidationError is raised.
    """
    with pytest.raises(ValidationError):
        BoardNotificationSettingsUpdate(**_update_kwargs(notify_weekdays=[]))


# ---------------------------------------------------------------------------
# 03 – Values outside 1..7 are rejected
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("weekdays", [[0], [8], [1, 2, 8], [-1]])
def test_board_notification_schema_03(weekdays: list[int]) -> None:
    """
    Verify notify_weekdays rejects anything that isn't an ISO weekday.

    Parameters
    ----------
    weekdays : list[int]
        A list containing at least one out-of-range day.

    Raises
    ------
    AssertionError
        If no ValidationError is raised.
    """
    with pytest.raises(ValidationError):
        BoardNotificationSettingsUpdate(**_update_kwargs(notify_weekdays=weekdays))


# ---------------------------------------------------------------------------
# 04 – notify_weekdays is required
# ---------------------------------------------------------------------------

def test_board_notification_schema_04() -> None:
    """
    Verify the full-replace update refuses a body without notify_weekdays.

    Raises
    ------
    AssertionError
        If no ValidationError is raised.
    """
    kwargs = _update_kwargs()
    del kwargs["notify_weekdays"]
    with pytest.raises(ValidationError):
        BoardNotificationSettingsUpdate(**kwargs)
