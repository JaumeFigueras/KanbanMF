#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the /api/v1/auth/google endpoints: the OAuth ``state`` check
that binds the callback to the browser that started the sign-in, and what
joining an existing account by e-mail may and may not keep."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from src.api.v1.auth import google as google_module
from src.api.v1.auth import local as local_module
from src.core.config import settings
from src.core.security import hash_password
from src.model.mcp_grant import McpGrant
from src.model.oauth_client import OAuthClient
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_session import UserSession

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
    profile: dict = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        type(self).calls += 1
        return _FakeGoogleResponse(200, {"access_token": "google-access", "refresh_token": "google-refresh"})

    async def get(self, url, headers=None):
        type(self).calls += 1
        return _FakeGoogleResponse(200, type(self).profile)


@pytest.fixture
def fake_google(monkeypatch):
    """Replace the module's httpx with the fake client, so no request leaves
    the test, and reset its call counter."""
    _FakeGoogleClient.calls = 0
    _FakeGoogleClient.profile = {
        "sub": "google-sub-1", "email": "ana@example.com", "email_verified": True, "name": "Ana Google",
    }
    monkeypatch.setattr(google_module, "httpx", SimpleNamespace(AsyncClient=_FakeGoogleClient))
    return _FakeGoogleClient


@pytest.mark.asyncio
async def test_auth_google_01(client) -> None:
    """
    Verify GET /auth/google/ redirects to Google with a random state, and sets
    the same value as an HTTP-only cookie scoped to the Google auth routes. It
    asks for no offline access: Google only signs the user in, so there is no
    refresh token to keep.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If the redirect lacks a state, or the cookie doesn't match it or isn't
        HTTP-only, Secure, SameSite=Lax and limited to /api/v1/auth/google, or
        offline access is requested.
    """
    response = await client.get("/api/v1/auth/google/")

    assert response.status_code == 307
    location = urlparse(response.headers["location"])
    assert location.geturl().startswith(settings.google_auth_url)
    query = parse_qs(location.query)
    state = query["state"][0]
    assert len(state) >= 32
    assert "access_type" not in query

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


async def _google_sign_in(client):
    """Run the whole Google sign-in in one browser, as the user would."""
    login = await client.get("/api/v1/auth/google/")
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    return await client.get(
        f"{_CALLBACK}?code=abc&state={state}",
        headers={"Cookie": f"google_oauth_state={state}"},
    )


@pytest.mark.asyncio
async def test_auth_google_05(client, fake_google, db_session_async, monkeypatch) -> None:
    """
    Verify the pre-registration takeover is closed: someone registers the
    victim's address with their own password (and has sessions, another
    Google identity and an MCP connection on that unverified account); when
    the real owner signs in with Google, every one of those ways in is gone
    and the password no longer works.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    fake_google : type
        The stand-in for httpx.AsyncClient, answering as Google would.
    db_session_async : AsyncSession
        Session on the test database.
    monkeypatch : pytest.MonkeyPatch
        Silences the verification e-mail.

    Raises
    ------
    AssertionError
        If the attacker's password, session, Google identity or MCP
        connection survives, or the owner isn't signed in.
    """
    async def _no_email(**kwargs):
        return None

    monkeypatch.setattr(local_module, "send_verification_email", _no_email)
    response = await client.post("/api/v1/auth/local/register", json={
        "email": "ana@example.com", "display_name": "Not Ana", "password": "attacker-password",
    })
    assert response.status_code == 201
    user = (await db_session_async.execute(select(User).where(User.email == "ana@example.com"))).scalar_one()
    client_row = OAuthClient(client_id="attacker-client", registration="dcr", client_name="Claude",
                             redirect_uris=["https://claude.ai/api/mcp/auth_callback"])
    db_session_async.add_all([
        UserSession(user_id=user.id, hashed_refresh_token="x",
                    expires_at=datetime.now(timezone.utc) + timedelta(days=1)),
        UserIdentity(user_id=user.id, provider=AuthProvider.GOOGLE, provider_user_id="attacker-sub"),
        McpGrant(user_id=user.id, client=client_row, read_only=False),
    ])
    await db_session_async.commit()

    response = await _google_sign_in(client)
    assert response.status_code == 307

    db_session_async.expire_all()
    user = (await db_session_async.execute(select(User).where(User.email == "ana@example.com"))).scalar_one()
    assert user.is_verified is True and user.display_name == "Ana Google"
    identities = (await db_session_async.execute(
        select(UserIdentity).where(UserIdentity.user_id == user.id)
    )).scalars().all()
    assert [(i.provider, i.provider_user_id) for i in identities] == [(AuthProvider.GOOGLE, "google-sub-1")]
    sessions = (await db_session_async.execute(
        select(UserSession).where(UserSession.user_id == user.id)
    )).scalars().all()
    assert len(sessions) == 1 and sessions[0].hashed_refresh_token != "x"
    assert (await db_session_async.execute(select(McpGrant))).scalars().all() == []

    response = await client.post("/api/v1/auth/local/login", json={
        "email": "ana@example.com", "password": "attacker-password",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_google_06(client, fake_google, db_session_async) -> None:
    """
    Verify an address Google hasn't verified is refused, before any account
    is created or joined.

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
        If the sign-in goes through, or an account or session appears.
    """
    for verified in (False, None):
        fake_google.profile = {"sub": "google-sub-2", "email": "eve@example.com", "name": "Eve"}
        if verified is not None:
            fake_google.profile["email_verified"] = verified
        response = await _google_sign_in(client)
        assert response.status_code == 403
        assert not any(c.startswith("refresh_token=") for c in response.headers.get_list("set-cookie"))
    assert (await db_session_async.execute(select(User).where(User.email == "eve@example.com"))).first() is None


@pytest.mark.asyncio
async def test_auth_google_07(client, fake_google, db_session_async) -> None:
    """
    Verify signing in with Google to an already verified local account still
    joins the two and keeps the password and the other sessions: the owner
    proved the address both ways, so nothing is taken away.

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
        If the password, the session or the display name is lost.
    """
    user = User(email="ana@example.com", display_name="Ana", is_active=True, is_verified=True)
    db_session_async.add(user)
    await db_session_async.flush()
    db_session_async.add_all([
        UserIdentity(user_id=user.id, provider=AuthProvider.LOCAL, hashed_password=hash_password("ana-password")),
        UserSession(user_id=user.id, hashed_refresh_token="laptop",
                    expires_at=datetime.now(timezone.utc) + timedelta(days=1)),
    ])
    await db_session_async.commit()

    assert (await _google_sign_in(client)).status_code == 307

    db_session_async.expire_all()
    user = (await db_session_async.execute(select(User).where(User.email == "ana@example.com"))).scalar_one()
    assert user.display_name == "Ana"
    providers = {i.provider for i in (await db_session_async.execute(
        select(UserIdentity).where(UserIdentity.user_id == user.id)
    )).scalars()}
    assert providers == {AuthProvider.LOCAL, AuthProvider.GOOGLE}
    sessions = (await db_session_async.execute(
        select(UserSession).where(UserSession.user_id == user.id)
    )).scalars().all()
    assert len(sessions) == 2
    response = await client.post("/api/v1/auth/local/login", json={
        "email": "ana@example.com", "password": "ana-password",
    })
    assert response.status_code == 200
