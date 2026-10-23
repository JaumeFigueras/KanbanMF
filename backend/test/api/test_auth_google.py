#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the /api/v1/auth/google endpoints: the OAuth ``state`` check
that binds the callback to the browser that started the sign-in."""

from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from src.api.v1.auth import google as google_module
from src.core.config import settings
from src.model.user import User

_CALLBACK = "/api/v1/auth/google/callback"


class _FakeGoogleResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _FakeGoogleClient:
    """Stands in for httpx.AsyncClient inside the google module: answers the
    token exchange and the profile request, and counts the calls."""

    calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        type(self).calls += 1
        return _FakeGoogleResponse(200, {"access_token": "google-access", "refresh_token": "google-refresh"})

    async def get(self, url, headers=None):
        type(self).calls += 1
        return _FakeGoogleResponse(200, {"sub": "google-sub-1", "email": "ana@example.com", "name": "Ana Google"})


@pytest.fixture
def fake_google(monkeypatch):
    """Replace the module's httpx with the fake client, so no request leaves
    the test, and reset its call counter."""
    _FakeGoogleClient.calls = 0
    monkeypatch.setattr(google_module, "httpx", SimpleNamespace(AsyncClient=_FakeGoogleClient))
    return _FakeGoogleClient


@pytest.mark.asyncio
async def test_auth_google_01(client) -> None:
    """
    Verify GET /auth/google/ redirects to Google with a random state, and sets
    the same value as an HTTP-only cookie scoped to the Google auth routes.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If the redirect lacks a state, or the cookie doesn't match it or isn't
        HTTP-only, Secure, SameSite=Lax and limited to /api/v1/auth/google.
    """
    response = await client.get("/api/v1/auth/google/")

    assert response.status_code == 307
    location = urlparse(response.headers["location"])
    assert location.geturl().startswith(settings.google_auth_url)
    state = parse_qs(location.query)["state"][0]
    assert len(state) >= 32

    set_cookie = response.headers["set-cookie"]
    assert set_cookie.startswith(f"google_oauth_state={state};")
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "samesite=lax" in set_cookie.lower()
    assert "Path=/api/v1/auth/google" in set_cookie


@pytest.mark.asyncio
async def test_auth_google_02(client) -> None:
    """
    Verify two sign-ins get different states.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If the state repeats.
    """
    states = set()
    for _ in range(2):
        response = await client.get("/api/v1/auth/google/")
        states.add(parse_qs(urlparse(response.headers["location"]).query)["state"][0])

    assert len(states) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query, cookie",
    [
        ("code=abc", None),                                   # no state, no cookie
        ("code=abc&state=s1", None),                          # state but no cookie: the login CSRF case
        ("code=abc", "s1"),                                   # cookie but no state
        ("code=abc&state=s1", "s2"),                          # mismatch
        ("code=abc&state=%C3%A9t%C3%A9", "s1"),               # non-ASCII state
    ],
)
async def test_auth_google_03(client, fake_google, db_session_async, query, cookie) -> None:
    """
    Verify the callback refuses with 400 whenever the state is missing or
    doesn't match the state cookie — without contacting Google, creating a
    user or setting a session cookie.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    fake_google : type
        The stand-in for httpx.AsyncClient, counting calls to Google.
    db_session_async : AsyncSession
        Session on the test database.
    query : str
        The callback's query string.
    cookie : str or None
        The google_oauth_state cookie sent with it, if any.

    Raises
    ------
    AssertionError
        If the callback doesn't answer 400, or does any of the work it
        should only do for a matching state.
    """
    headers = {"Cookie": f"google_oauth_state={cookie}"} if cookie else {}
    response = await client.get(f"{_CALLBACK}?{query}", headers=headers)

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid OAuth state"
    assert fake_google.calls == 0
    assert "refresh_token" not in response.headers.get("set-cookie", "")
    result = await db_session_async.execute(select(User).where(User.email == "ana@example.com"))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_auth_google_04(client, fake_google, db_session_async) -> None:
    """
    Verify the full flow with a matching state: the callback signs the user
    in, sets the refresh cookie, clears the state cookie and redirects to
    the frontend.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    fake_google : type
        The stand-in for httpx.AsyncClient, answering as Google would.
    db_session_async : AsyncSession
        Session on the test database.

    Raises
    ------
    AssertionError
        If the sign-in doesn't complete, or the state cookie survives it.
    """
    login = await client.get("/api/v1/auth/google/")
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]

    response = await client.get(
        f"{_CALLBACK}?code=abc&state={state}",
        headers={"Cookie": f"google_oauth_state={state}"},
    )

    assert response.status_code == 307
    assert response.headers["location"] == settings.frontend_url
    assert fake_google.calls == 2
    set_cookies = response.headers.get_list("set-cookie")
    assert any(c.startswith("refresh_token=") for c in set_cookies)
    cleared = [c for c in set_cookies if c.startswith("google_oauth_state=")]
    assert len(cleared) == 1
    assert "Max-Age=0" in cleared[0]
    assert "Path=/api/v1/auth/google" in cleared[0]

    result = await db_session_async.execute(select(User).where(User.email == "ana@example.com"))
    user = result.scalar_one()
    assert user.is_verified is True
