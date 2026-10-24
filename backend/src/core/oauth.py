#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The OAuth 2.1 authorization server behind the MCP server: client
registration, authorization requests and the consent decision, codes, token
issue and rotation, revocation, access-token checks, and the hourly clean-up.

The HTTP side is in :mod:`src.api.v1.oauth` and :mod:`src.api.well_known`.
"""

import base64
import hashlib
import json
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.security import hash_token
from src.model.board import Board
from src.model.mcp_grant import McpGrant
from src.model.mcp_grant_board import McpGrantBoard
from src.model.oauth_authorization_code import OAuthAuthorizationCode
from src.model.oauth_authorization_request import OAuthAuthorizationRequest
from src.model.oauth_client import REGISTRATION_CIMD, REGISTRATION_DCR, OAuthClient
from src.model.oauth_token import OAuthToken
from src.model.user import User

logger = logging.getLogger(__name__)

ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=30)
CODE_TTL = timedelta(minutes=5)
REQUEST_TTL = timedelta(minutes=10)
# A client nobody approved within this long is deleted by the clean-up.
UNUSED_CLIENT_TTL = timedelta(days=1)
CIMD_CACHE_TTL = timedelta(days=1)
CIMD_MAX_BYTES = 16 * 1024

# The one scope: what a grant may do is decided on the consent page (the
# boards, read-only or not), not by scopes.
SCOPE = "kanban"

# Prefixes make a leaked token recognisable (e.g. by secret scanners).
ACCESS_TOKEN_PREFIX = "kmf_at_"
REFRESH_TOKEN_PREFIX = "kmf_rt_"

_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
# RFC 7636: 43 to 128 characters from the unreserved set.
_CODE_VERIFIER = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")


class OAuthError(Exception):
    """An OAuth error response: ``error`` is the RFC 6749 code (e.g.
    ``invalid_grant``), ``description`` a sentence for the developer."""

    def __init__(self, error: str, description: str, status_code: int = 400) -> None:
        super().__init__(f"{error}: {description}")
        self.error = error
        self.description = description
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issuer() -> str:
    """The authorization server's issuer: the public address of the app."""
    return settings.frontend_url.rstrip("/")


def mcp_resource() -> str:
    """The MCP server's canonical URI, the audience of every token."""
    return f"{issuer()}/mcp"


def _new_secret(prefix: str = "") -> str:
    return prefix + secrets.token_urlsafe(32)


def pkce_matches(verifier: str, challenge: str) -> bool:
    """Whether the PKCE ``code_verifier`` hashes (S256) to the challenge."""
    if not _CODE_VERIFIER.match(verifier):
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return secrets.compare_digest(expected, challenge)


def _is_loopback(uri: str) -> bool:
    parts = urlsplit(uri)
    return parts.scheme == "http" and parts.hostname in _LOOPBACK_HOSTS


def valid_redirect_uri(uri: str) -> bool:
    """A redirect URI must be HTTPS, or HTTP on the loopback interface (a
    native app such as Claude Code listening on a local port), and carry no
    fragment."""
    try:
        parts = urlsplit(uri)
    except ValueError:
        return False
    if parts.fragment or not parts.hostname:
        return False
    return parts.scheme == "https" or _is_loopback(uri)


def redirect_uri_allowed(uri: str, registered: list[str]) -> bool:
    """Whether ``uri`` is one of the client's redirect URIs.

    Matching is exact, except that a loopback URI matches on any port (RFC
    8252 section 7.3): a native app picks a free port each time.
    """
    if uri in registered:
        return True
    if not _is_loopback(uri):
        return False
    wanted = urlsplit(uri)
    for candidate in registered:
        if not _is_loopback(candidate):
            continue
        parts = urlsplit(candidate)
        if (parts.hostname, parts.path, parts.query) == (wanted.hostname, wanted.path, wanted.query):
            return True
    return False


def same_resource(a: str, b: str) -> bool:
    """Compare two resource URIs, ignoring the case of scheme and host and a
    trailing slash."""
    pa, pb = urlsplit(a), urlsplit(b)
    return (
        (pa.scheme.lower(), pa.netloc.lower(), pa.path.rstrip("/"), pa.query)
        == (pb.scheme.lower(), pb.netloc.lower(), pb.path.rstrip("/"), pb.query)
    )


def redirect_host(uri: str) -> str:
    """The host a redirect URI sends the code to, as shown on the consent page."""
    return urlsplit(uri).hostname or ""


def with_query(uri: str, params: dict[str, str | None]) -> str:
    """Add query parameters to a URI, keeping the ones it already has."""
    parts = urlsplit(uri)
    extra = urlencode({k: v for k, v in params.items() if v is not None})
    query = f"{parts.query}&{extra}" if parts.query else extra
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


# --- Clients -------------------------------------------------------------


async def register_client(
    client_name: str | None,
    redirect_uris: list[str],
    grant_types: list[str] | None,
    token_endpoint_auth_method: str | None,
    db: AsyncSession,
) -> OAuthClient:
    """Dynamic Client Registration (RFC 7591) of a public client.

    Raises :class:`OAuthError` (``invalid_redirect_uri`` or
    ``invalid_client_metadata``) when the metadata can't be accepted.
    """
    if not redirect_uris or len(redirect_uris) > 10:
        raise OAuthError("invalid_redirect_uri", "Between 1 and 10 redirect_uris are required.")
    for uri in redirect_uris:
        if not valid_redirect_uri(uri):
            raise OAuthError("invalid_redirect_uri", f"Redirect URI not allowed: {uri}")
    if token_endpoint_auth_method not in (None, "none"):
        raise OAuthError(
            "invalid_client_metadata", "Only public clients (token_endpoint_auth_method none) are supported."
        )
    if grant_types and not set(grant_types) <= {"authorization_code", "refresh_token"}:
        raise OAuthError(
            "invalid_client_metadata", "Only the authorization_code and refresh_token grants are supported."
        )

    client = OAuthClient(
        client_id=_new_secret(),
        registration=REGISTRATION_DCR,
        client_name=(client_name or "").strip()[:200] or "Unnamed application",
        redirect_uris=redirect_uris,
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return client


def _cimd_url_allowed(url: str) -> bool:
    """A metadata document URL must be HTTPS on the default port, on an
    allowed host (``OAUTH_CIMD_ALLOWED_HOSTS``), with a path, and no
    credentials or fragment."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    allowed = {h.strip().lower() for h in settings.oauth_cimd_allowed_hosts.split(",") if h.strip()}
    return (
        parts.scheme == "https"
        and parts.hostname in allowed
        and port is None
        and not parts.username
        and not parts.fragment
        and parts.path not in ("", "/")
    )


async def fetch_client_metadata(url: str) -> dict:
    """Download a Client ID Metadata Document.

    No redirects are followed and the response is capped, since this is a
    request the server makes to a URL a client chose (the host is checked
    against the allow-list before this is called).
    """
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
        async with client.stream("GET", url, headers={"Accept": "application/json"}) as response:
            if response.status_code != 200:
                raise OAuthError("invalid_client", f"Client metadata document answered {response.status_code}.")
            body = b""
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > CIMD_MAX_BYTES:
                    raise OAuthError("invalid_client", "Client metadata document is too large.")
    try:
        return json.loads(body)
    except ValueError as exc:
        raise OAuthError("invalid_client", "Client metadata document is not JSON.") from exc


async def _load_cimd_client(url: str, db: AsyncSession) -> OAuthClient:
    """Return the client of a metadata document URL, fetching the document
    when it isn't cached or the cached copy is a day old."""
    result = await db.execute(select(OAuthClient).where(OAuthClient.client_id == url))
    client = result.scalar_one_or_none()
    if client is not None and client.metadata_fetched_at and _now() - client.metadata_fetched_at < CIMD_CACHE_TTL:
        return client

    document = await fetch_client_metadata(url)
    redirect_uris = document.get("redirect_uris") if isinstance(document, dict) else None
    if not isinstance(document, dict) or document.get("client_id") != url:
        raise OAuthError("invalid_client", "The metadata document's client_id doesn't match its URL.")
    if (
        not isinstance(redirect_uris, list)
        or not redirect_uris
        or not all(isinstance(u, str) and valid_redirect_uri(u) for u in redirect_uris)
    ):
        raise OAuthError("invalid_client", "The metadata document has no valid redirect_uris.")
    name = document.get("client_name")
    name = name.strip()[:200] if isinstance(name, str) and name.strip() else redirect_host(url)

    if client is None:
        client = OAuthClient(client_id=url, registration=REGISTRATION_CIMD)
        db.add(client)
    client.client_name = name
    client.redirect_uris = redirect_uris
    client.metadata_fetched_at = _now()
    await db.commit()
    await db.refresh(client)
    return client


async def get_client(client_id: str, db: AsyncSession) -> OAuthClient:
    """Resolve a ``client_id``: an HTTPS URL is a metadata document, anything
    else a registered client. Raises ``invalid_client`` when unknown."""
    if client_id.startswith("https://"):
        if not _cimd_url_allowed(client_id):
            raise OAuthError("invalid_client", "Client metadata documents from this host are not accepted.")
        return await _load_cimd_client(client_id, db)
    result = await db.execute(
        select(OAuthClient).where(
            OAuthClient.client_id == client_id, OAuthClient.registration == REGISTRATION_DCR
        )
    )
    client = result.scalar_one_or_none()
    if client is None:
        raise OAuthError("invalid_client", "Unknown client_id.")
    return client


# --- Authorization and consent -------------------------------------------


async def create_authorization_request(
    client: OAuthClient,
    redirect_uri: str,
    state: str | None,
    code_challenge: str,
    resource: str,
    db: AsyncSession,
) -> OAuthAuthorizationRequest:
    """Store a validated authorization request until the user decides."""
    request = OAuthAuthorizationRequest(
        client_id=client.id,
        redirect_uri=redirect_uri,
        state=state,
        code_challenge=code_challenge,
        resource=resource,
        expires_at=_now() + REQUEST_TTL,
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request


async def get_pending_request(request_id: uuid.UUID, db: AsyncSession) -> OAuthAuthorizationRequest | None:
    """The unexpired authorization request with this id, with its client."""
    result = await db.execute(
        select(OAuthAuthorizationRequest)
        .options(selectinload(OAuthAuthorizationRequest.client))
        .where(
            OAuthAuthorizationRequest.id == request_id,
            OAuthAuthorizationRequest.expires_at > _now(),
        )
    )
    return result.scalar_one_or_none()


async def selectable_boards(user: User, db: AsyncSession) -> list[Board]:
    """The boards a grant may include: the user's own live boards (not
    archived, deleted or templates). Boards shared with the user never are."""
    result = await db.execute(
        select(Board)
        .where(
            Board.owner_id == user.id,
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
            Board.is_template.is_(False),
        )
        .order_by(Board.name)
    )
    return list(result.scalars().all())


async def check_board_selection(board_ids: list[uuid.UUID], user: User, db: AsyncSession) -> set[uuid.UUID]:
    """Return the selection as a set, or raise ``ValueError`` when it is
    empty or holds a board :func:`selectable_boards` doesn't offer."""
    wanted = set(board_ids)
    if not wanted:
        raise ValueError("Choose at least one board.")
    allowed = {b.id for b in await selectable_boards(user, db)}
    if not wanted <= allowed:
        raise ValueError("Only your own boards can be chosen.")
    return wanted


async def approve_request(
    request: OAuthAuthorizationRequest,
    user: User,
    board_ids: list[uuid.UUID],
    read_only: bool,
    db: AsyncSession,
) -> str:
    """Create the grant and a code, delete the request, and return the URL
    the browser is sent back to.

    Raises ``ValueError`` when the board selection isn't acceptable.
    """
    selected = await check_board_selection(board_ids, user, db)
    grant = McpGrant(
        user_id=user.id,
        client_id=request.client_id,
        read_only=read_only,
        boards=[McpGrantBoard(board_id=board_id) for board_id in selected],
    )
    db.add(grant)
    await db.flush()

    code = _new_secret()
    db.add(OAuthAuthorizationCode(
        code_hash=hash_token(code),
        grant_id=grant.id,
        redirect_uri=request.redirect_uri,
        code_challenge=request.code_challenge,
        resource=request.resource,
        expires_at=_now() + CODE_TTL,
    ))
    redirect_to = with_query(request.redirect_uri, {"code": code, "state": request.state, "iss": issuer()})
    await db.delete(request)
    await db.commit()
    return redirect_to


async def deny_request(request: OAuthAuthorizationRequest, db: AsyncSession) -> str:
    """Delete the request and return the ``access_denied`` redirect."""
    redirect_to = with_query(
        request.redirect_uri,
        {"error": "access_denied", "error_description": "The user denied access.",
         "state": request.state, "iss": issuer()},
    )
    await db.delete(request)
    await db.commit()
    return redirect_to


# --- Tokens --------------------------------------------------------------


def _token_response(access_token: str, refresh_token: str) -> dict:
    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
        "refresh_token": refresh_token,
        "scope": SCOPE,
    }


def _new_token_pair(grant_id: uuid.UUID, resource: str, db: AsyncSession) -> dict:
    access_token = _new_secret(ACCESS_TOKEN_PREFIX)
    refresh_token = _new_secret(REFRESH_TOKEN_PREFIX)
    now = _now()
    db.add(OAuthToken(
        grant_id=grant_id,
        access_token_hash=hash_token(access_token),
        refresh_token_hash=hash_token(refresh_token),
        resource=resource,
        access_expires_at=now + ACCESS_TOKEN_TTL,
        refresh_expires_at=now + REFRESH_TOKEN_TTL,
    ))
    return _token_response(access_token, refresh_token)


async def exchange_code(
    code: str,
    client_id: str,
    redirect_uri: str,
    code_verifier: str,
    resource: str | None,
    db: AsyncSession,
) -> dict:
    """The ``authorization_code`` grant: trade a code for a token pair.

    A code works once: it is deleted as soon as it is looked up, whether the
    rest of the request checks out or not.
    """
    result = await db.execute(
        select(OAuthAuthorizationCode).where(OAuthAuthorizationCode.code_hash == hash_token(code))
    )
    stored = result.scalar_one_or_none()
    if stored is None:
        raise OAuthError("invalid_grant", "Unknown or already used authorization code.")
    await db.delete(stored)
    await db.commit()

    grant_result = await db.execute(
        select(McpGrant).options(selectinload(McpGrant.client)).where(McpGrant.id == stored.grant_id)
    )
    grant = grant_result.scalar_one_or_none()
    if grant is None or stored.expires_at <= _now():
        raise OAuthError("invalid_grant", "The authorization code has expired.")
    if grant.client.client_id != client_id:
        raise OAuthError("invalid_grant", "The code was issued to another client.")
    if redirect_uri != stored.redirect_uri:
        raise OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request.")
    if not pkce_matches(code_verifier, stored.code_challenge):
        raise OAuthError("invalid_grant", "PKCE verification failed.")
    if resource is not None and not same_resource(resource, stored.resource):
        raise OAuthError("invalid_target", "resource doesn't match the authorization request.")

    response = _new_token_pair(grant.id, stored.resource, db)
    await db.commit()
    return response


async def refresh_tokens(refresh_token: str, client_id: str, resource: str | None, db: AsyncSession) -> dict:
    """The ``refresh_token`` grant: rotate the pair.

    The old refresh token dies and its access token expires at once. If a
    refresh token that was already rotated comes back, someone else has a
    copy, so the whole grant is deleted.
    """
    result = await db.execute(
        select(OAuthToken)
        .options(selectinload(OAuthToken.grant).selectinload(McpGrant.client),
                 selectinload(OAuthToken.grant).selectinload(McpGrant.user))
        .where(OAuthToken.refresh_token_hash == hash_token(refresh_token))
    )
    token = result.scalar_one_or_none()
    if token is None:
        raise OAuthError("invalid_grant", "Unknown refresh token.")
    grant = token.grant
    if grant.client.client_id != client_id:
        raise OAuthError("invalid_grant", "The refresh token was issued to another client.")
    if token.rotated_at is not None:
        logger.warning("Rotated refresh token reused; revoking MCP grant %s", grant.id)
        await db.delete(grant)
        await db.commit()
        raise OAuthError("invalid_grant", "The refresh token was already used.")
    if token.refresh_expires_at <= _now() or not grant.user.is_active:
        raise OAuthError("invalid_grant", "The refresh token has expired.")
    if resource is not None and not same_resource(resource, token.resource):
        raise OAuthError("invalid_target", "resource doesn't match the original authorization.")

    now = _now()
    token.rotated_at = now
    token.access_expires_at = now
    response = _new_token_pair(grant.id, token.resource, db)
    await db.commit()
    return response


async def revoke_token(token: str, client_id: str | None, db: AsyncSession) -> None:
    """RFC 7009 revocation: delete the pair an access or refresh token belongs
    to. Unknown tokens are ignored, as the RFC asks."""
    hashed = hash_token(token)
    result = await db.execute(
        select(OAuthToken)
        .options(selectinload(OAuthToken.grant).selectinload(McpGrant.client))
        .where((OAuthToken.access_token_hash == hashed) | (OAuthToken.refresh_token_hash == hashed))
    )
    stored = result.scalar_one_or_none()
    if stored is None or (client_id is not None and stored.grant.client.client_id != client_id):
        return
    await db.delete(stored)
    await db.commit()


async def authenticate_access_token(token: str, db: AsyncSession) -> McpGrant | None:
    """The grant behind a valid MCP access token, or None.

    Valid means: known, not expired, issued for this MCP server, and its user
    still active. Records the use in ``last_used_at``. The grant comes with
    its user, client and boards loaded.
    """
    result = await db.execute(
        select(OAuthToken).where(OAuthToken.access_token_hash == hash_token(token))
    )
    stored = result.scalar_one_or_none()
    if stored is None or stored.access_expires_at <= _now() or not same_resource(stored.resource, mcp_resource()):
        return None
    grant_result = await db.execute(
        select(McpGrant)
        .options(selectinload(McpGrant.user), selectinload(McpGrant.client), selectinload(McpGrant.boards))
        .where(McpGrant.id == stored.grant_id)
    )
    grant = grant_result.scalar_one()
    if not grant.user.is_active:
        return None
    grant.last_used_at = _now()
    await db.commit()
    return grant


# --- Grants --------------------------------------------------------------


async def user_grants(user: User, db: AsyncSession) -> list[McpGrant]:
    """The user's grants, newest first, with their client and boards."""
    result = await db.execute(
        select(McpGrant)
        .options(selectinload(McpGrant.client), selectinload(McpGrant.boards))
        .where(McpGrant.user_id == user.id)
        .order_by(McpGrant.created_at.desc())
    )
    return list(result.scalars().all())


async def get_user_grant(grant_id: uuid.UUID, user: User, db: AsyncSession) -> McpGrant | None:
    """One of the user's grants, with its client and boards."""
    result = await db.execute(
        select(McpGrant)
        .options(selectinload(McpGrant.client), selectinload(McpGrant.boards))
        .where(McpGrant.id == grant_id, McpGrant.user_id == user.id)
    )
    return result.scalar_one_or_none()


def client_redirect_host(client: OAuthClient) -> str:
    """Where a client receives its codes, for display: the host of its first
    redirect URI."""
    return redirect_host(client.redirect_uris[0]) if client.redirect_uris else ""


# --- Clean-up ------------------------------------------------------------


async def delete_expired_oauth_rows() -> None:
    """Hourly job: drop expired authorization requests, codes and tokens, and
    clients nobody approved within a day.

    Expired rows are already refused everywhere, so this only keeps the tables
    small. A rotated token is kept until its refresh token would have expired,
    so that its reuse can still be noticed.
    """
    now = _now()
    async with AsyncSessionLocal() as db:
        await db.execute(delete(OAuthAuthorizationRequest).where(OAuthAuthorizationRequest.expires_at <= now))
        await db.execute(delete(OAuthAuthorizationCode).where(OAuthAuthorizationCode.expires_at <= now))
        await db.execute(delete(OAuthToken).where(OAuthToken.refresh_expires_at <= now))
        clients = await db.execute(
            delete(OAuthClient).where(
                OAuthClient.created_at <= now - UNUSED_CLIENT_TTL,
                ~exists().where(McpGrant.client_id == OAuthClient.id),
            )
        )
        await db.commit()
    if clients.rowcount:
        logger.info("Deleted %d unused OAuth client(s)", clients.rowcount)
