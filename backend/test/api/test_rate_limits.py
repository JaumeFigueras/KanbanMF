#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the rate limits (src.core.rate_limit): login per account and per
IP, registration, password change, invitations and OAuth client
registration, the sliding window itself, and that behind the proxy the
address counted is the real client's."""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from src.api.v1.auth import local as local_module
from src.core import rate_limit
from src.core.rate_limit import RateLimit
from src.core.security import hash_password
from src.main import app
from src.model.board import Board
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity

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


def _client_from(ip: str, wrap=None) -> AsyncClient:
    """A client whose requests come from ``ip`` (the app's database override
    is already in place through the ``client`` fixture)."""
    return AsyncClient(transport=ASGITransport(app=wrap or app, client=(ip, 50000)), base_url="http://test")


async def _login(client, email: str, password: str):
    return await client.post("/api/v1/auth/local/login", json={"email": email, "password": password})


@pytest.mark.asyncio
async def test_rate_limits_01(client, ana: User, monkeypatch) -> None:
    """
    Verify ten login attempts per account in 15 minutes: the eleventh is
    refused with 429 and Retry-After — even with the right password, and
    from another address — without running bcrypt; other accounts aren't
    affected.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    ana : User
        A verified local account.
    monkeypatch : pytest.MonkeyPatch
        Counts the bcrypt checks.

    Raises
    ------
    AssertionError
        If the limit doesn't apply, applies to the wrong account, or costs
        bcrypt work when refusing.
    """
    checks = []
    real_verify = local_module.verify_password
    monkeypatch.setattr(local_module, "verify_password", lambda p, h: checks.append(1) or real_verify(p, h))

    for _ in range(10):
        assert (await _login(client, "ana@example.com", "wrong-password")).status_code == 401
    checks.clear()

    response = await _login(client, "ANA@example.com", PASSWORD)
    assert response.status_code == 429
    assert 0 < int(response.headers["retry-after"]) <= 15 * 60
    async with _client_from("10.0.0.2") as elsewhere:
        assert (await _login(elsewhere, "ana@example.com", PASSWORD)).status_code == 429
    assert checks == []

    assert (await _login(client, "bob@example.com", "whatever-pass")).status_code == 401


@pytest.mark.asyncio
async def test_rate_limits_02(client) -> None:
    """
    Verify thirty login attempts per address in 15 minutes, whatever the
    accounts tried, while another address can still sign in.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If one address can try more than thirty accounts, or the limit spills
        over to other addresses.
    """
    for n in range(30):
        assert (await _login(client, f"user{n}@example.com", "whatever-pass")).status_code == 401
    assert (await _login(client, "user99@example.com", "whatever-pass")).status_code == 429
    async with _client_from("10.0.0.3") as other:
        assert (await _login(other, "user99@example.com", "whatever-pass")).status_code == 401


@pytest.mark.asyncio
async def test_rate_limits_03(client, monkeypatch) -> None:
    """
    Verify five registrations per address an hour: the sixth is refused and
    sends no e-mail.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    monkeypatch : pytest.MonkeyPatch
        Captures the verification e-mails.

    Raises
    ------
    AssertionError
        If a sixth registration goes through or e-mails anyone.
    """
    sent = []

    async def _capture(**kwargs):
        sent.append(kwargs["email"])

    monkeypatch.setattr(local_module, "send_verification_email", _capture)
    for n in range(5):
        response = await client.post("/api/v1/auth/local/register", json={
            "email": f"new{n}@example.com", "display_name": "New", "password": PASSWORD,
        })
        assert response.status_code == 201
    response = await client.post("/api/v1/auth/local/register", json={
        "email": "victim@example.com", "display_name": "New", "password": PASSWORD,
    })
    assert response.status_code == 429
    assert "victim@example.com" not in sent and len(sent) == 5


@pytest.mark.asyncio
async def test_rate_limits_04(client, db_session_async, ana: User) -> None:
    """
    Verify ten password changes per user in 15 minutes, and that a password
    under 8 characters is refused.

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
        If the eleventh guess at the current password is checked, or a short
        password is accepted.
    """
    token = (await _login(client, "ana@example.com", PASSWORD)).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    url = "/api/v1/users/me/password"

    response = await client.put(url, headers=headers, json={"old_password": PASSWORD, "new_password": "short"})
    assert response.status_code == 422  # refused by validation, before it counts
    for _ in range(10):
        response = await client.put(url, headers=headers,
                                    json={"old_password": "a-guess-at-it", "new_password": "new-password"})
        assert response.status_code == 400
    response = await client.put(url, headers=headers, json={"old_password": PASSWORD, "new_password": "new-password"})
    assert response.status_code == 429


@pytest.mark.asyncio
async def test_rate_limits_05(client, db_session_async, test_user: User, auth_headers: dict[str, str]) -> None:
    """
    Verify thirty invitations per user an hour (each would e-mail someone, and
    the answer reveals whether an address has an account).

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    test_user : User
        A board owner.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If a thirty-first invitation is processed.
    """
    board = Board(owner_id=test_user.id, name="Board")
    other = User(email="other@example.com", display_name="Other", is_verified=True)
    db_session_async.add_all([board, other])
    await db_session_async.commit()
    url = f"/api/v1/boards/{board.id}/invitations"

    # An address with an account is answered 409 without sending anything,
    # which is enough to count attempts here.
    for _ in range(30):
        response = await client.post(url, headers=auth_headers, json={"email": "other@example.com"})
        assert response.status_code == 409
    response = await client.post(url, headers=auth_headers, json={"email": "other@example.com"})
    assert response.status_code == 429


@pytest.mark.asyncio
async def test_rate_limits_06(client) -> None:
    """
    Verify twenty OAuth client registrations per address an hour.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If a twenty-first client is registered.
    """
    body = {"client_name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]}
    for _ in range(20):
        assert (await client.post("/api/v1/oauth/register", json=body)).status_code == 201
    assert (await client.post("/api/v1/oauth/register", json=body)).status_code == 429


def test_rate_limits_07(monkeypatch) -> None:
    """
    Verify the sliding window: events older than the window stop counting, a
    refused event isn't counted, Retry-After says when the oldest event
    leaves, and keys whose window has passed are pruned.

    Parameters
    ----------
    monkeypatch : pytest.MonkeyPatch
        Controls the clock.

    Raises
    ------
    AssertionError
        If the window, the retry time or the pruning is wrong.
    """
    now = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now[0])
    limit = RateLimit("test", 2, 60)
    rate_limit.LIMITS.remove(limit)

    limit.hit("a")
    now[0] += 10
    limit.hit("a")
    now[0] += 10
    with pytest.raises(Exception) as refused:
        limit.hit("a")
    assert refused.value.status_code == 429 and refused.value.headers["Retry-After"] == "40"
    now[0] += 40  # the first event leaves the window
    limit.hit("a")
    limit.hit("b")  # another key has its own count

    monkeypatch.setattr(RateLimit, "_PRUNE_ABOVE", 1)
    now[0] += 120
    limit.hit("c")
    assert set(limit._events) == {"c"}


@pytest.mark.asyncio
async def test_rate_limits_08(client) -> None:
    """
    Verify that behind the proxy the counted address is the real client's:
    uvicorn's proxy middleware (on by default, trusting 127.0.0.1) takes the
    address Apache appended to X-Forwarded-For, so a client can't escape the
    limit by sending the header itself, and different clients are counted
    apart.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If a spoofed header resets the count, or two clients share one.
    """
    proxied = ProxyHeadersMiddleware(app, trusted_hosts="127.0.0.1")
    async with _client_from("127.0.0.1", wrap=proxied) as through_apache:
        for n in range(30):
            # The attacker sends a different made-up address each time; Apache
            # appends the real one, 203.0.113.9.
            response = await through_apache.post(
                "/api/v1/auth/local/login",
                headers={"X-Forwarded-For": f"198.51.100.{n}, 203.0.113.9"},
                json={"email": f"user{n}@example.com", "password": "whatever-pass"},
            )
            assert response.status_code == 401
        response = await through_apache.post(
            "/api/v1/auth/local/login",
            headers={"X-Forwarded-For": "198.51.100.200, 203.0.113.9"},
            json={"email": "user99@example.com", "password": "whatever-pass"},
        )
        assert response.status_code == 429

        response = await through_apache.post(
            "/api/v1/auth/local/login",
            headers={"X-Forwarded-For": "203.0.113.50"},
            json={"email": "user99@example.com", "password": "whatever-pass"},
        )
        assert response.status_code == 401
