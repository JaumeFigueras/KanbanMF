#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for sign-in sessions: refresh-token rotation, lookup by the token's
SHA-256 (no bcrypt scan of every session), expiry and its clean-up, logout,
and bcrypt kept off the event loop."""

import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.api.v1.auth import local as local_module
from src.core import sessions as sessions_module
from src.core.security import hash_password, hash_token
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_session import UserSession

PASSWORD = "correct horse battery staple"


@pytest_asyncio.fixture
async def ana(db_session_async) -> User:
    """A verified local account with a known password."""
    user = User(email="ana@example.com", display_name="Ana", is_active=True, is_verified=True)
    db_session_async.add(user)
    await db_session_async.flush()
    db_session_async.add(UserIdentity(user_id=user.id, provider=AuthProvider.LOCAL,
                                      hashed_password=hash_password(PASSWORD)))
    await db_session_async.commit()
    return user


def _cookie(response) -> str:
    """The refresh token a response sets."""
    for header in response.headers.get_list("set-cookie"):
        if header.startswith("refresh_token="):
            return header.split(";", 1)[0].split("=", 1)[1]
    raise AssertionError("no refresh_token cookie")


async def _login(client) -> str:
    response = await client.post("/api/v1/auth/local/login", json={"email": "ana@example.com", "password": PASSWORD})
    assert response.status_code == 200
    return _cookie(response)


async def _refresh(client, token: str):
    # The cookie is Secure and the test client talks plain http, so it is
    # sent by hand.
    client.cookies.clear()
    return await client.post("/api/v1/auth/local/refresh", headers={"Cookie": f"refresh_token={token}"})


@pytest.mark.asyncio
async def test_auth_sessions_01(client, db_session_async, ana: User) -> None:
    """
    Verify a login stores only the SHA-256 of its refresh token, and that
    refreshing rotates it: the new token works, the old one doesn't.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    ana : User
        A verified local account.

    Raises
    ------
    AssertionError
        If the plain token is stored, or rotation leaves the old token usable.
    """
    first = await _login(client)
    stored = (await db_session_async.execute(select(UserSession))).scalars().all()
    assert [s.hashed_refresh_token for s in stored] == [hash_token(first)]

    response = await _refresh(client, first)
    assert response.status_code == 200 and response.json()["access_token"]
    second = _cookie(response)
    assert second != first

    assert (await _refresh(client, first)).status_code == 401
    assert (await _refresh(client, second)).status_code == 200


@pytest.mark.asyncio
async def test_auth_sessions_02(client, db_session_async, ana: User, monkeypatch) -> None:
    """
    Verify a made-up refresh token is refused with no bcrypt check at all,
    however many sessions there are — the denial of service this used to be.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    ana : User
        A verified local account, given many sessions.
    monkeypatch : pytest.MonkeyPatch
        Makes any bcrypt check fail the test.

    Raises
    ------
    AssertionError
        If the refresh checks a password hash or answers anything but 401.
    """
    now = datetime.now(timezone.utc)
    db_session_async.add_all([
        UserSession(user_id=ana.id, hashed_refresh_token=hash_token(f"device-{n}"),
                    expires_at=now + timedelta(days=1))
        for n in range(200)
    ])
    await db_session_async.commit()

    def _no_bcrypt(*args):
        raise AssertionError("refresh must not run bcrypt")

    monkeypatch.setattr(local_module, "verify_password", _no_bcrypt)
    started = time.perf_counter()
    response = await _refresh(client, "made-up-token")
    assert response.status_code == 401
    assert time.perf_counter() - started < 1.0
    assert (await _refresh(client, "device-7")).status_code == 200


@pytest.mark.asyncio
async def test_auth_sessions_03(client, db_session_async, ana: User, monkeypatch) -> None:
    """
    Verify an expired session is refused, and the hourly clean-up deletes
    expired sessions and only those.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    ana : User
        A verified local account.
    monkeypatch : pytest.MonkeyPatch
        Points the job's session factory at the test database.

    Raises
    ------
    AssertionError
        If an expired session still works or survives the clean-up, or a live
        one is deleted.
    """
    now = datetime.now(timezone.utc)
    db_session_async.add_all([
        UserSession(user_id=ana.id, hashed_refresh_token=hash_token("old"), expires_at=now - timedelta(minutes=1)),
        UserSession(user_id=ana.id, hashed_refresh_token=hash_token("live"), expires_at=now + timedelta(days=1)),
    ])
    await db_session_async.commit()
    assert (await _refresh(client, "old")).status_code == 401

    monkeypatch.setattr(
        sessions_module, "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )
    await sessions_module.delete_expired_sessions()
    db_session_async.expire_all()
    left = (await db_session_async.execute(select(UserSession.hashed_refresh_token))).scalars().all()
    assert left == [hash_token("live")]


@pytest.mark.asyncio
async def test_auth_sessions_04(client, db_session_async, ana: User) -> None:
    """
    Verify logging out deletes that browser's session only: the user's other
    device stays signed in, and nobody else's session can be ended with it.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    ana : User
        A verified local account.

    Raises
    ------
    AssertionError
        If the wrong sessions are deleted.
    """
    ana_id = ana.id
    laptop = await _login(client)
    phone = await _login(client)
    bob = User(email="bob@example.com", display_name="Bob", is_active=True, is_verified=True)
    db_session_async.add(bob)
    await db_session_async.flush()
    db_session_async.add(UserSession(user_id=bob.id, hashed_refresh_token=hash_token("bob-token"),
                                     expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
    await db_session_async.commit()
    access = (await _refresh(client, laptop)).json()["access_token"]

    client.cookies.clear()
    response = await client.post("/api/v1/auth/local/logout",
                                 headers={"Authorization": f"Bearer {access}", "Cookie": "refresh_token=bob-token"})
    assert response.status_code == 204
    assert (await _refresh(client, "bob-token")).status_code == 200

    response = await client.post("/api/v1/auth/local/logout",
                                 headers={"Authorization": f"Bearer {access}", "Cookie": f"refresh_token={phone}"})
    assert response.status_code == 204
    assert (await _refresh(client, phone)).status_code == 401
    db_session_async.expire_all()
    ana_sessions = (await db_session_async.execute(
        select(UserSession).where(UserSession.user_id == ana_id)
    )).scalars().all()
    assert len(ana_sessions) == 1  # the laptop's, rotated by the refresh


@pytest.mark.asyncio
async def test_auth_sessions_05(client, ana: User, monkeypatch) -> None:
    """
    Verify a login's bcrypt check runs off the event loop: while a slow check
    is in progress, other requests are still answered.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    ana : User
        A verified local account.
    monkeypatch : pytest.MonkeyPatch
        Makes the bcrypt check take half a second.

    Raises
    ------
    AssertionError
        If the other request waits for the bcrypt check.
    """
    real_verify = local_module.verify_password
    verify_started: list[float] = []

    def _slow_verify(plain: str, hashed: str) -> bool:
        verify_started.append(time.perf_counter())
        time.sleep(0.5)
        return real_verify(plain, hashed)

    monkeypatch.setattr(local_module, "verify_password", _slow_verify)

    async def _timed_health() -> float:
        # Wait until the slow check has begun, then see how long after its
        # start another request is answered: on the event loop it would have
        # to wait the whole half second.
        while not verify_started:
            await asyncio.sleep(0.001)
        await client.get("/healthz")
        return time.perf_counter() - verify_started[0]

    login, health_time = await asyncio.gather(
        client.post("/api/v1/auth/local/login", json={"email": "ana@example.com", "password": PASSWORD}),
        _timed_health(),
    )
    assert login.status_code == 200
    assert health_time < 0.3
