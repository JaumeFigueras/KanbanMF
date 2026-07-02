#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the /api/v1/users endpoints."""

import pytest

from src.model.user import User


@pytest.mark.asyncio
async def test_users_01(client) -> None:
    """
    Verify GET /me rejects requests with no Authorization header.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If the endpoint does not respond with 401 Unauthorized.
    """
    response = await client.get("/api/v1/users/me")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_users_02(client, test_user: User, auth_headers: dict[str, str]) -> None:
    """
    Verify GET /me returns the authenticated user's profile with default
    preferences, for a user that has no UserPreferences or UserIdentity rows.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        A freshly created user with no preferences or identities.
    auth_headers : dict[str, str]
        A valid Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the response status or body doesn't match the expected UserRead shape.
    """
    response = await client.get("/api/v1/users/me", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(test_user.id)
    assert body["email"] == test_user.email
    assert body["display_name"] == test_user.display_name
    assert body["is_active"] is True
    assert body["is_verified"] is False
    assert body["language_locale"] == "en"
    assert body["number_locale"] == "en"
    assert body["date_format"] == "numeric"
    assert body["initials"] == "TU"
    assert body["auth_providers"] == []
