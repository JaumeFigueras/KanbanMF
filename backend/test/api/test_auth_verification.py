#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests that an account can't be used until its e-mail address is verified:
registration gives nothing to sign in with, and the API, the WebSocket and
the MCP server all refuse an unverified account; and that the e-mail address
can't be changed behind the owner's back."""

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from fastapi import WebSocketDisconnect, status

from src.api.v1 import ws as ws_module
from src.api.v1.auth import local as local_module
from src.core import oauth
from src.core.oauth import authenticate_access_token, mcp_resource
from src.core.security import create_access_token
from src.model.mcp_grant import McpGrant
from src.model.oauth_client import OAuthClient
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity

PASSWORD = "correct horse battery staple"


@pytest_asyncio.fixture
async def sent(monkeypatch) -> list[dict]:
    """Capture the verification e-mails instead of sending them."""
    mails: list[dict] = []

    async def _capture(**kwargs):
        mails.append(kwargs)

    monkeypatch.setattr(local_module, "send_verification_email", _capture)
    return mails


async def _register(client) -> dict:
    response = await client.post("/api/v1/auth/local/register", json={
        "email": "ana@example.com", "display_name": "Ana", "password": PASSWORD,
    })
    assert response.status_code == 201
    return response


@pytest.mark.asyncio
async def test_auth_verification_01(client, db_session_async, sent: list[dict]) -> None:
    """
    Verify registering returns no access token and sets no cookie, and the
    account can do nothing — not even with a token minted for it — until the
    address is verified; afterwards everything works.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    sent : list[dict]
        The verification e-mails "sent".

    Raises
    ------
    AssertionError
        If registration hands out a way in, or the unverified account can use
        the API, or the verified one can't.
    """
    response = await _register(client)
    assert response.json() == {"email": "ana@example.com"}
    assert "access_token" not in response.text
    assert not response.headers.get_list("set-cookie")

    user = (await db_session_async.execute(select(User).where(User.email == "ana@example.com"))).scalar_one()
    token = {"Authorization": f"Bearer {create_access_token(user.id)}"}
    response = await client.get("/api/v1/users/me", headers=token)
    assert response.status_code == 403 and response.json()["detail"] == "Email not verified"
    assert (await client.post("/api/v1/boards", headers=token, json={"name": "Spam"})).status_code == 403
    login = await client.post("/api/v1/auth/local/login", json={"email": "ana@example.com", "password": PASSWORD})
    assert login.status_code == 403

    assert (await client.post("/api/v1/auth/local/verify-email", json={"token": sent[0]["token"]})).status_code == 204
    login = await client.post("/api/v1/auth/local/login", json={"email": "ana@example.com", "password": PASSWORD})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.get("/api/v1/users/me", headers=headers)).status_code == 200


@pytest.mark.asyncio
async def test_auth_verification_02(client, test_user: User, auth_headers: dict[str, str], db_session_async) -> None:
    """
    Verify the e-mail address can't be changed through PUT /users/me, while
    the display name still can.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        A verified user.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    db_session_async : AsyncSession
        Session on the test database.

    Raises
    ------
    AssertionError
        If the address changes, the account loses its verification, or a
        display-name change is refused.
    """
    user_id = test_user.id
    response = await client.put("/api/v1/users/me", headers=auth_headers, json={"email": "victim@example.com"})
    assert response.status_code == 400

    response = await client.put("/api/v1/users/me", headers=auth_headers,
                                json={"email": test_user.email, "display_name": "Renamed"})
    assert response.status_code == 200
    assert response.json()["display_name"] == "Renamed"

    db_session_async.expire_all()
    user = (await db_session_async.execute(select(User).where(User.id == user_id))).scalar_one()
    assert user.email == "user@example.com" and user.is_verified is True


class _FakeSocket:
    """Stands in for the WebSocket: records whether the endpoint accepted or
    closed it, and disconnects as soon as the endpoint waits for a message,
    so a wrongly accepted connection can't hang the test."""

    def __init__(self) -> None:
        self.accepted = False
        self.closed_with: int | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code

    async def receive_text(self) -> str:
        raise WebSocketDisconnect()


@pytest.mark.asyncio
async def test_auth_verification_03(db_session_async, monkeypatch) -> None:
    """
    Verify the WebSocket accepts a verified user and closes the connection of
    an unverified one without accepting it.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session on the test database.
    monkeypatch : pytest.MonkeyPatch
        Points the endpoint's session factory at the test database.

    Raises
    ------
    AssertionError
        If the unverified user is accepted or the verified one isn't.
    """
    verified = User(email="ok@example.com", display_name="Ok", is_verified=True)
    unverified = User(email="nope@example.com", display_name="Nope", is_verified=False)
    db_session_async.add_all([verified, unverified])
    await db_session_async.commit()
    monkeypatch.setattr(
        ws_module, "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )

    socket = _FakeSocket()
    await ws_module.websocket_endpoint(socket, token=create_access_token(verified.id))
    assert socket.accepted and socket.closed_with is None

    socket = _FakeSocket()
    await ws_module.websocket_endpoint(socket, token=create_access_token(unverified.id))
    assert not socket.accepted and socket.closed_with == status.WS_1008_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_auth_verification_04(db_session_async) -> None:
    """
    Verify an MCP access token stops working if its user is unverified.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session on the test database.

    Raises
    ------
    AssertionError
        If the token is accepted for an unverified user.
    """
    user = User(email="mcp@example.com", display_name="Mcp", is_verified=True)
    db_session_async.add(user)
    await db_session_async.flush()
    db_session_async.add(UserIdentity(user_id=user.id, provider=AuthProvider.LOCAL))
    client = OAuthClient(client_id="c", registration="dcr", client_name="Claude",
                         redirect_uris=["https://claude.ai/api/mcp/auth_callback"])
    grant = McpGrant(user_id=user.id, client=client, read_only=True)
    db_session_async.add(grant)
    await db_session_async.flush()
    token = oauth._new_token_pair(grant.id, mcp_resource(), db_session_async)["access_token"]
    await db_session_async.commit()
    assert await authenticate_access_token(token, db_session_async) is not None

    user.is_verified = False
    await db_session_async.commit()
    assert await authenticate_access_token(token, db_session_async) is None
