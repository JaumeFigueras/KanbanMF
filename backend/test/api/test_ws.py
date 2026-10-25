#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the WebSocket endpoint's sign-in: the access token is the first
message, never part of the URL, and a connection is registered for
notifications only once it has been accepted."""

import asyncio
import json

import pytest
import pytest_asyncio
from fastapi import WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.api.v1 import ws as ws_module
from src.core.security import create_access_token
from src.core.ws_manager import manager
from src.model.user import User


class _Socket:
    """Stands in for the WebSocket. Hands the endpoint ``messages`` one by
    one; after the last it disconnects, or with ``hang`` waits forever (a
    client that never signs in). Records whether the endpoint's user was
    registered with the manager while it was waiting for the next message."""

    def __init__(self, *messages: str, user: User | None = None, hang: bool = False) -> None:
        self.messages = list(messages)
        self.user = user
        self.hang = hang
        self.accepted = False
        self.closed_with: int | None = None
        self.registered = False

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code

    async def receive_text(self) -> str:
        if self.user is not None and self in manager._connections.get(self.user.id, set()):
            self.registered = True
        if self.messages:
            return self.messages.pop(0)
        if self.hang:
            await asyncio.Event().wait()
        raise WebSocketDisconnect()


def _auth(token: str) -> str:
    return json.dumps({"type": "auth", "token": token})


@pytest_asyncio.fixture
async def ws_user(db_session_async, monkeypatch) -> User:
    """A verified user, with the endpoint reading the test database."""
    user = User(email="ws@example.com", display_name="Ws", is_verified=True)
    db_session_async.add(user)
    await db_session_async.commit()
    monkeypatch.setattr(
        ws_module, "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )
    return user


@pytest.mark.asyncio
async def test_ws_01(ws_user: User) -> None:
    """
    Verify a valid token sent as the first message registers the connection
    for notifications, and that closing it unregisters it.

    Parameters
    ----------
    ws_user : User
        A verified user.

    Raises
    ------
    AssertionError
        If the connection isn't registered, is closed, or stays registered.
    """
    socket = _Socket(_auth(create_access_token(ws_user.id)), user=ws_user)
    await ws_module.websocket_endpoint(socket)
    assert socket.accepted and socket.closed_with is None
    assert socket.registered
    assert socket not in manager._connections.get(ws_user.id, set())


@pytest.mark.asyncio
async def test_ws_02(ws_user: User) -> None:
    """
    Verify a connection whose first message isn't a valid sign-in is closed
    with 1008 and never registered: a bad token, a token of another kind,
    the wrong message type, and text that isn't JSON.

    Parameters
    ----------
    ws_user : User
        A verified user.

    Raises
    ------
    AssertionError
        If any of them is registered or left open.
    """
    good = create_access_token(ws_user.id)
    for first in (_auth("not-a-jwt"), json.dumps({"type": "hello", "token": good}),
                  json.dumps({"type": "auth", "token": 42}), json.dumps(["auth", good]), "auth " + good):
        socket = _Socket(first, user=ws_user)
        await ws_module.websocket_endpoint(socket)
        assert socket.closed_with == status.WS_1008_POLICY_VIOLATION, first
        assert not socket.registered, first


@pytest.mark.asyncio
async def test_ws_03(ws_user: User, monkeypatch) -> None:
    """
    Verify a connection that never sends its token is closed once the time
    to sign in runs out.

    Parameters
    ----------
    ws_user : User
        A verified user.
    monkeypatch : pytest.MonkeyPatch
        Shortens the time to sign in.

    Raises
    ------
    AssertionError
        If the silent connection is left open or registered.
    """
    monkeypatch.setattr(ws_module, "AUTH_TIMEOUT_SECONDS", 0.05)
    socket = _Socket(user=ws_user, hang=True)
    await asyncio.wait_for(ws_module.websocket_endpoint(socket), 2)
    assert socket.closed_with == status.WS_1008_POLICY_VIOLATION
    assert not socket.registered

