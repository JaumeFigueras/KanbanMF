#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the MCP server's OAuth 2.1 authorization server: discovery,
client registration (DCR and Client ID Metadata Documents), authorize and
consent, the token endpoint, rotation, revocation, grants and clean-up."""

import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core import oauth
from src.core.oauth import authenticate_access_token, hash_token, issuer, mcp_resource
from src.core.security import create_access_token
from src.model.board import Board
from src.model.board_share import BoardShare
from src.model.mcp_grant import McpGrant
from src.model.oauth_authorization_code import OAuthAuthorizationCode
from src.model.oauth_authorization_request import OAuthAuthorizationRequest
from src.model.oauth_client import OAuthClient
from src.model.oauth_token import OAuthToken
from src.model.user import User

REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback"
CIMD_URL = "https://claude.ai/oauth/claude-code-client-metadata"


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _query(location: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(location).query).items()}


@pytest_asyncio.fixture
async def boards(db_session_async, test_user: User) -> dict[str, Board]:
    """test_user's two live boards, plus boards a grant may never include: an
    archived one, a template, and another user's board shared with test_user."""
    other = User(email="other@example.com", display_name="Other", is_verified=True)
    db_session_async.add(other)
    await db_session_async.flush()
    result = {
        "work": Board(owner_id=test_user.id, name="Work"),
        "home": Board(owner_id=test_user.id, name="Home"),
        "archived": Board(owner_id=test_user.id, name="Old", is_archived=True),
        "template": Board(owner_id=test_user.id, name="Template", is_template=True),
        "shared": Board(owner_id=other.id, name="Theirs"),
    }
    db_session_async.add_all(result.values())
    await db_session_async.flush()
    db_session_async.add(BoardShare(board_id=result["shared"].id, user_id=test_user.id))
    await db_session_async.commit()
    return result


async def _register(client, redirect_uris: list[str] | None = None) -> str:
    response = await client.post(
        "/api/v1/oauth/register",
        json={"client_name": "Claude", "redirect_uris": redirect_uris or [REDIRECT_URI]},
    )
    assert response.status_code == 201
    return response.json()["client_id"]


async def _authorize(client, client_id: str, challenge: str, **extra: str):
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "xyz",
        "resource": mcp_resource(),
        **extra,
    }
    return await client.get("/api/v1/oauth/authorize", params=params)


async def _approved_code(client, auth_headers, board_ids, client_id=None, read_only=False):
    """Run register + authorize + approve; return (client_id, code, verifier)."""
    client_id = client_id or await _register(client)
    verifier, challenge = _pkce()
    response = await _authorize(client, client_id, challenge)
    request_id = _query(response.headers["location"])["request"]
    response = await client.post(
        f"/api/v1/oauth/requests/{request_id}/approve",
        headers=auth_headers,
        json={"board_ids": [str(b) for b in board_ids], "read_only": read_only},
    )
    assert response.status_code == 200
    return client_id, _query(response.json()["redirect_to"])["code"], verifier


async def _exchange(client, client_id: str, code: str, verifier: str):
    return await client.post("/api/v1/oauth/token", data={
        "grant_type": "authorization_code",
        "client_id": client_id,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
        "resource": mcp_resource(),
    })


@pytest.mark.asyncio
async def test_oauth_01(client) -> None:
    """
    Verify the discovery documents point at this server and advertise PKCE
    S256, public clients, CIMD and DCR.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If a document is missing or names the wrong issuer or resource.
    """
    for path in ("/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"):
        response = await client.get(path)
        assert response.status_code == 200
        assert response.json()["resource"] == mcp_resource()
        assert response.json()["authorization_servers"] == [issuer()]

    metadata = (await client.get("/.well-known/oauth-authorization-server")).json()
    assert metadata["issuer"] == issuer()
    assert metadata["token_endpoint"] == f"{issuer()}/api/v1/oauth/token"
    assert metadata["code_challenge_methods_supported"] == ["S256"]
    assert metadata["token_endpoint_auth_methods_supported"] == ["none"]
    assert metadata["client_id_metadata_document_supported"] is True
    assert metadata["registration_endpoint"] == f"{issuer()}/api/v1/oauth/register"


@pytest.mark.asyncio
async def test_oauth_02(client) -> None:
    """
    Verify Dynamic Client Registration accepts a public client with HTTPS or
    loopback redirect URIs and refuses anything else.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If a good registration fails, or a plain-HTTP redirect URI or a
        confidential client is accepted.
    """
    response = await client.post("/api/v1/oauth/register", json={
        "client_name": "Claude Code",
        "redirect_uris": ["http://localhost/callback", REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_method": "none",
        "logo_uri": "https://example.com/logo.png",
    })
    assert response.status_code == 201
    assert response.json()["client_name"] == "Claude Code"
    assert response.json()["token_endpoint_auth_method"] == "none"

    response = await client.post("/api/v1/oauth/register", json={"redirect_uris": ["http://evil.example/cb"]})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_redirect_uri"

    response = await client.post("/api/v1/oauth/register", json={
        "redirect_uris": [REDIRECT_URI], "token_endpoint_auth_method": "client_secret_basic",
    })
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_client_metadata"


@pytest.mark.asyncio
async def test_oauth_03(client) -> None:
    """
    Verify /authorize never redirects to an unchecked address: an unknown
    client or redirect URI lands on the consent page with an error, while
    errors after that go back to the client with its state.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.

    Raises
    ------
    AssertionError
        If an error is sent to an unregistered address, PKCE or the resource
        aren't enforced, or a good request doesn't reach the consent page.
    """
    client_id = await _register(client)
    _, challenge = _pkce()
    consent = f"{issuer()}/oauth/consent"

    response = await _authorize(client, "nobody", challenge)
    assert response.headers["location"] == f"{consent}?error=invalid_client"

    response = await _authorize(client, client_id, challenge, redirect_uri="https://evil.example/cb")
    assert response.headers["location"] == f"{consent}?error=invalid_redirect_uri"

    response = await _authorize(client, client_id, challenge, code_challenge_method="plain")
    location = response.headers["location"]
    assert location.startswith(REDIRECT_URI)
    assert _query(location)["error"] == "invalid_request"
    assert _query(location)["state"] == "xyz"

    response = await _authorize(client, client_id, challenge, resource="https://elsewhere.example/mcp")
    assert _query(response.headers["location"])["error"] == "invalid_target"

    response = await _authorize(client, client_id, challenge)
    assert response.status_code == 302
    assert response.headers["location"].startswith(f"{consent}?request=")


@pytest.mark.asyncio
async def test_oauth_04(client, boards: dict[str, Board], auth_headers: dict[str, str]) -> None:
    """
    Verify the consent page is offered only the user's own live boards, and
    needs the user's sign-in.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    boards : dict[str, Board]
        test_user's boards and the ones that may never be offered.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If an archived board, a template or a shared board is offered, or the
        request can be read without signing in.
    """
    client_id = await _register(client)
    _, challenge = _pkce()
    response = await _authorize(client, client_id, challenge)
    request_id = _query(response.headers["location"])["request"]

    response = await client.get(f"/api/v1/oauth/requests/{request_id}")
    assert response.status_code in (401, 403)

    response = await client.get(f"/api/v1/oauth/requests/{request_id}", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["client_name"] == "Claude"
    assert body["redirect_host"] == "claude.ai"
    assert body["redirect_is_local"] is False
    assert [b["name"] for b in body["boards"]] == ["Home", "Work"]


@pytest.mark.asyncio
async def test_oauth_05(client, boards: dict[str, Board], auth_headers: dict[str, str]) -> None:
    """
    Verify approving needs at least one of the user's own boards, and sends
    the browser back with the code, the state and the issuer, once.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    boards : dict[str, Board]
        test_user's boards and the ones that may never be chosen.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If an empty or foreign selection is accepted, the redirect lacks the
        code, state or iss, or the request can be approved twice.
    """
    client_id = await _register(client)
    _, challenge = _pkce()
    response = await _authorize(client, client_id, challenge)
    url = f"/api/v1/oauth/requests/{_query(response.headers['location'])['request']}/approve"

    for chosen in ([], [boards["shared"].id], [boards["work"].id, boards["template"].id], [boards["archived"].id]):
        response = await client.post(url, headers=auth_headers, json={"board_ids": [str(b) for b in chosen]})
        assert response.status_code == 422

    response = await client.post(url, headers=auth_headers, json={"board_ids": [str(boards["work"].id)]})
    assert response.status_code == 200
    redirect_to = response.json()["redirect_to"]
    assert redirect_to.startswith(REDIRECT_URI)
    params = _query(redirect_to)
    assert params["code"] and params["state"] == "xyz" and params["iss"] == issuer()

    response = await client.post(url, headers=auth_headers, json={"board_ids": [str(boards["work"].id)]})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_oauth_06(
    client, db_session_async, boards: dict[str, Board], auth_headers: dict[str, str]
) -> None:
    """
    Verify a code is traded for tokens only with the right client, redirect
    URI and PKCE verifier, and only once.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    boards : dict[str, Board]
        test_user's boards.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If a wrong verifier, redirect URI or client is accepted, a code works
        twice, or the tokens aren't stored only as hashes.
    """
    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id])
    response = await _exchange(client, client_id, code, "x" * 50)
    assert response.status_code == 400 and response.json()["error"] == "invalid_grant"
    # The failed attempt used the code up.
    response = await _exchange(client, client_id, code, verifier)
    assert response.json()["error"] == "invalid_grant"

    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id], client_id)
    other_client = await _register(client)
    response = await _exchange(client, other_client, code, verifier)
    assert response.json()["error"] == "invalid_grant"

    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id], client_id)
    response = await _exchange(client, client_id, code, verifier)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["token_type"] == "Bearer" and body["expires_in"] == 3600
    assert body["access_token"].startswith("kmf_at_") and body["refresh_token"].startswith("kmf_rt_")

    stored = (await db_session_async.execute(select(OAuthToken))).scalars().all()
    assert len(stored) == 1
    assert stored[0].access_token_hash == hash_token(body["access_token"])
    assert body["access_token"] not in (stored[0].access_token_hash, stored[0].refresh_token_hash)

    response = await _exchange(client, client_id, code, verifier)
    assert response.json()["error"] == "invalid_grant"


@pytest.mark.asyncio
async def test_oauth_07(
    client, db_session_async, test_user: User, boards: dict[str, Board], auth_headers: dict[str, str]
) -> None:
    """
    Verify an access token leads to its grant, and that refreshing rotates the
    pair: the old access token stops working, and reusing the old refresh
    token revokes the whole grant.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The user who approved the grant.
    boards : dict[str, Board]
        test_user's boards.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the grant isn't found, rotation leaves the old tokens working, or a
        reused refresh token doesn't end the grant.
    """
    client_id, code, verifier = await _approved_code(
        client, auth_headers, [boards["work"].id, boards["home"].id], read_only=True
    )
    first = (await _exchange(client, client_id, code, verifier)).json()

    grant = await authenticate_access_token(first["access_token"], db_session_async)
    assert grant is not None
    assert grant.user_id == test_user.id and grant.read_only is True
    assert {b.board_id for b in grant.boards} == {boards["work"].id, boards["home"].id}
    assert grant.last_used_at is not None

    response = await client.post("/api/v1/oauth/token", data={
        "grant_type": "refresh_token", "client_id": client_id, "refresh_token": first["refresh_token"],
    })
    assert response.status_code == 200
    second = response.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert await authenticate_access_token(first["access_token"], db_session_async) is None
    assert await authenticate_access_token(second["access_token"], db_session_async) is not None

    response = await client.post("/api/v1/oauth/token", data={
        "grant_type": "refresh_token", "client_id": client_id, "refresh_token": first["refresh_token"],
    })
    assert response.json()["error"] == "invalid_grant"
    db_session_async.expire_all()
    assert await authenticate_access_token(second["access_token"], db_session_async) is None
    assert (await db_session_async.execute(select(McpGrant))).scalars().all() == []


@pytest.mark.asyncio
async def test_oauth_08(
    client, db_session_async, test_user: User, boards: dict[str, Board], auth_headers: dict[str, str]
) -> None:
    """
    Verify MCP tokens and sign-in tokens can't stand in for each other, and an
    access token issued for another resource or expired is refused.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    test_user : User
        The user who approved the grant.
    boards : dict[str, Board]
        test_user's boards.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the REST API accepts an MCP token, the MCP check accepts a JWT, or a
        token for another audience or past its expiry is accepted.
    """
    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id])
    tokens = (await _exchange(client, client_id, code, verifier)).json()

    response = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert response.status_code == 401
    assert await authenticate_access_token(create_access_token(test_user.id), db_session_async) is None

    stored = (await db_session_async.execute(select(OAuthToken))).scalar_one()
    stored.resource = "https://elsewhere.example/mcp"
    await db_session_async.commit()
    assert await authenticate_access_token(tokens["access_token"], db_session_async) is None

    stored.resource = mcp_resource()
    stored.access_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session_async.commit()
    assert await authenticate_access_token(tokens["access_token"], db_session_async) is None


@pytest.mark.asyncio
async def test_oauth_09(client, db_session_async, auth_headers: dict[str, str]) -> None:
    """
    Verify denying sends the browser back with access_denied and drops the
    request.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the redirect doesn't carry access_denied and the state, or the
        request is still stored.
    """
    client_id = await _register(client)
    _, challenge = _pkce()
    response = await _authorize(client, client_id, challenge)
    request_id = _query(response.headers["location"])["request"]

    response = await client.post(f"/api/v1/oauth/requests/{request_id}/deny", headers=auth_headers)
    assert response.status_code == 200
    params = _query(response.json()["redirect_to"])
    assert params["error"] == "access_denied" and params["state"] == "xyz"
    assert (await db_session_async.execute(select(OAuthAuthorizationRequest))).scalars().all() == []


@pytest.mark.asyncio
async def test_oauth_10(
    client, db_session_async, boards: dict[str, Board], auth_headers: dict[str, str]
) -> None:
    """
    Verify the connected apps list shows a grant's boards, lets the user
    change them and the read-only flag, and revoking it ends its tokens.
    Another user can't see or change it.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    boards : dict[str, Board]
        test_user's boards and the ones that may never be chosen.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the list, an update or the revocation doesn't behave as described.
    """
    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id])
    tokens = (await _exchange(client, client_id, code, verifier)).json()

    response = await client.get("/api/v1/oauth/grants", headers=auth_headers)
    assert response.status_code == 200
    [grant] = response.json()
    assert grant["client_name"] == "Claude" and grant["redirect_host"] == "claude.ai"
    assert [b["name"] for b in grant["boards"]] == ["Work"]
    url = f"/api/v1/oauth/grants/{grant['id']}"

    response = await client.patch(url, headers=auth_headers, json={"board_ids": [str(boards["shared"].id)]})
    assert response.status_code == 422
    response = await client.patch(url, headers=auth_headers, json={
        "board_ids": [str(boards["home"].id), str(boards["work"].id)], "read_only": True,
    })
    assert response.status_code == 200
    assert [b["name"] for b in response.json()["boards"]] == ["Home", "Work"]
    assert response.json()["read_only"] is True

    stranger = User(email="stranger@example.com", display_name="Stranger", is_verified=True)
    db_session_async.add(stranger)
    await db_session_async.commit()
    stranger_headers = {"Authorization": f"Bearer {create_access_token(stranger.id)}"}
    assert (await client.get("/api/v1/oauth/grants", headers=stranger_headers)).json() == []
    assert (await client.delete(url, headers=stranger_headers)).status_code == 404

    assert (await client.delete(url, headers=auth_headers)).status_code == 204
    db_session_async.expire_all()
    assert await authenticate_access_token(tokens["access_token"], db_session_async) is None


@pytest.mark.asyncio
async def test_oauth_11(
    client, db_session_async, boards: dict[str, Board], auth_headers: dict[str, str]
) -> None:
    """
    Verify revoking a refresh token deletes its pair, and unknown tokens are
    answered 200 too.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    boards : dict[str, Board]
        test_user's boards.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the pair survives revocation or an unknown token gets an error.
    """
    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id])
    tokens = (await _exchange(client, client_id, code, verifier)).json()

    response = await client.post("/api/v1/oauth/revoke", data={"token": "nonsense", "client_id": client_id})
    assert response.status_code == 200
    response = await client.post(
        "/api/v1/oauth/revoke", data={"token": tokens["refresh_token"], "client_id": client_id}
    )
    assert response.status_code == 200
    assert await authenticate_access_token(tokens["access_token"], db_session_async) is None


@pytest.mark.asyncio
async def test_oauth_12(
    client, db_session_async, boards: dict[str, Board], auth_headers: dict[str, str], monkeypatch
) -> None:
    """
    Verify a Client ID Metadata Document client is accepted from an allowed
    host, fetched once and cached, and refused from any other host or when
    the document doesn't name its own URL.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    boards : dict[str, Board]
        test_user's boards.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    monkeypatch : pytest.MonkeyPatch
        Replaces the document download.

    Raises
    ------
    AssertionError
        If the allowed client can't complete the flow, the document is fetched
        twice, or a bad host or document is accepted.
    """
    fetched: list[str] = []
    documents = {
        CIMD_URL: {"client_id": CIMD_URL, "client_name": "Claude Code",
                   "redirect_uris": ["http://localhost/callback", REDIRECT_URI]},
        "https://claude.ai/oauth/liar": {"client_id": "https://claude.ai/oauth/other",
                                         "redirect_uris": [REDIRECT_URI]},
    }

    async def _fetch(url: str) -> dict:
        fetched.append(url)
        return documents[url]

    monkeypatch.setattr(oauth, "fetch_client_metadata", _fetch)
    _, challenge = _pkce()
    consent = f"{issuer()}/oauth/consent"

    response = await _authorize(client, "https://evil.example/client.json", challenge)
    assert response.headers["location"] == f"{consent}?error=invalid_client"
    response = await _authorize(client, "https://claude.ai/oauth/liar", challenge)
    assert response.headers["location"] == f"{consent}?error=invalid_client"

    # Claude Code's loopback redirect on whatever port it picked.
    response = await _authorize(client, CIMD_URL, challenge, redirect_uri="http://localhost:3118/callback")
    assert response.headers["location"].startswith(f"{consent}?request=")
    request_id = _query(response.headers["location"])["request"]
    response = await client.get(f"/api/v1/oauth/requests/{request_id}", headers=auth_headers)
    assert response.json()["client_name"] == "Claude Code"
    assert response.json()["redirect_is_local"] is True

    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id], CIMD_URL)
    assert (await _exchange(client, client_id, code, verifier)).status_code == 200
    assert fetched.count(CIMD_URL) == 1
    stored = (await db_session_async.execute(select(OAuthClient).where(OAuthClient.client_id == CIMD_URL))).scalar_one()
    assert stored.registration == "cimd"


@pytest.mark.asyncio
async def test_oauth_13(
    client, db_session_async, boards: dict[str, Board], auth_headers: dict[str, str], monkeypatch
) -> None:
    """
    Verify the hourly clean-up drops expired requests, codes and tokens and
    clients nobody approved within a day, and keeps everything still in use.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database.
    boards : dict[str, Board]
        test_user's boards.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    monkeypatch : pytest.MonkeyPatch
        Points the job's session factory at the test database.

    Raises
    ------
    AssertionError
        If an expired row survives, or a live grant, token or client is
        deleted.
    """
    monkeypatch.setattr(
        oauth, "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )
    client_id, code, verifier = await _approved_code(client, auth_headers, [boards["work"].id])
    tokens = (await _exchange(client, client_id, code, verifier)).json()
    _, unused_code, _ = await _approved_code(client, auth_headers, [boards["work"].id], client_id)
    abandoned = await _register(client)
    _, challenge = _pkce()
    await _authorize(client, abandoned, challenge)

    past = datetime.now(timezone.utc) - timedelta(days=2)
    for row in (await db_session_async.execute(select(OAuthAuthorizationRequest))).scalars():
        row.expires_at = past
    (await db_session_async.execute(
        select(OAuthAuthorizationCode).where(OAuthAuthorizationCode.code_hash == hash_token(unused_code))
    )).scalar_one().expires_at = past
    for row in (await db_session_async.execute(select(OAuthClient))).scalars():
        row.created_at = past
    await db_session_async.commit()

    await oauth.delete_expired_oauth_rows()

    db_session_async.expire_all()
    assert (await db_session_async.execute(select(OAuthAuthorizationRequest))).scalars().all() == []
    assert (await db_session_async.execute(select(OAuthAuthorizationCode))).scalars().all() == []
    remaining = {c.client_id for c in (await db_session_async.execute(select(OAuthClient))).scalars()}
    assert remaining == {client_id}
    assert await authenticate_access_token(tokens["access_token"], db_session_async) is not None
