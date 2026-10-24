#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Routes of the MCP server's OAuth 2.1 authorization server.

The protocol endpoints, used by MCP clients such as Claude: client
registration, ``/authorize`` (which sends the browser to the frontend's
consent page), ``/token`` and ``/revoke``. Then the endpoints behind the
consent page and the connected apps list, which need the user's own sign-in:
read, approve or deny a pending request, and list, change or revoke grants.
The work is done in :mod:`src.core.oauth`.
"""

import re
import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, get_db
from src.core.oauth import (
    OAuthError,
    approve_request,
    check_board_selection,
    client_redirect_host,
    create_authorization_request,
    deny_request,
    exchange_code,
    get_client,
    get_pending_request,
    get_user_grant,
    issuer,
    mcp_resource,
    redirect_host,
    redirect_uri_allowed,
    refresh_tokens,
    register_client,
    revoke_token,
    same_resource,
    selectable_boards,
    user_grants,
    with_query,
)
from src.model.board import Board
from src.model.mcp_grant import McpGrant
from src.model.mcp_grant_board import McpGrantBoard
from src.model.user import User
from src.schemas.oauth import (
    AuthorizationRequestRead,
    ClientRegistrationRequest,
    ClientRegistrationResponse,
    ConsentApprove,
    ConsentResult,
    GrantBoardRead,
    McpGrantRead,
    McpGrantUpdate,
)

router = APIRouter()

# Token responses must never be cached (RFC 6749 section 5.1).
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}

# A PKCE S256 challenge is a base64url SHA-256: 43 characters.
_CODE_CHALLENGE = re.compile(r"^[A-Za-z0-9\-_]{43,128}$")


def _oauth_error(error: OAuthError) -> JSONResponse:
    return JSONResponse(
        {"error": error.error, "error_description": error.description},
        status_code=error.status_code,
        headers=_NO_STORE,
    )


def _consent_page(**params: str) -> str:
    return with_query(f"{issuer()}/oauth/consent", params)


@router.post("/register", response_model=ClientRegistrationResponse, status_code=status.HTTP_201_CREATED)
async def register(body: ClientRegistrationRequest, db: AsyncSession = Depends(get_db)):
    """Dynamic Client Registration (RFC 7591), for public clients only."""
    try:
        client = await register_client(
            body.client_name, body.redirect_uris, body.grant_types, body.token_endpoint_auth_method, db
        )
    except OAuthError as error:
        return _oauth_error(error)
    return ClientRegistrationResponse(
        client_id=client.client_id,
        client_id_issued_at=int(client.created_at.timestamp()),
        client_name=client.client_name,
        redirect_uris=client.redirect_uris,
    )


@router.get("/authorize")
async def authorize(
    response_type: str | None = None,
    client_id: str | None = None,
    redirect_uri: str | None = None,
    code_challenge: str | None = None,
    code_challenge_method: str | None = None,
    state: str | None = None,
    resource: str | None = None,
    scope: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Check an authorization request and send the browser to the consent page.

    Until the client and its redirect URI are known to be good, an error can't
    be sent back to the client (that would make this an open redirect), so the
    consent page shows it. After that, errors go back to the redirect URI as
    OAuth asks. ``scope`` is accepted and ignored: what a grant may do is
    chosen on the consent page.
    """
    if not client_id:
        return RedirectResponse(_consent_page(error="invalid_request"), status_code=status.HTTP_302_FOUND)
    try:
        client = await get_client(client_id, db)
    except OAuthError as error:
        return RedirectResponse(_consent_page(error=error.error), status_code=status.HTTP_302_FOUND)
    if not redirect_uri or not redirect_uri_allowed(redirect_uri, client.redirect_uris):
        return RedirectResponse(_consent_page(error="invalid_redirect_uri"), status_code=status.HTTP_302_FOUND)

    def fail(error: str, description: str) -> RedirectResponse:
        return RedirectResponse(
            with_query(redirect_uri, {
                "error": error, "error_description": description, "state": state, "iss": issuer(),
            }),
            status_code=status.HTTP_302_FOUND,
        )

    if response_type != "code":
        return fail("unsupported_response_type", "Only response_type=code is supported.")
    if code_challenge_method != "S256" or not code_challenge or not _CODE_CHALLENGE.match(code_challenge):
        return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.")
    if resource is not None and not same_resource(resource, mcp_resource()):
        return fail("invalid_target", f"This server only issues tokens for {mcp_resource()}.")

    request = await create_authorization_request(client, redirect_uri, state, code_challenge, mcp_resource(), db)
    return RedirectResponse(_consent_page(request=str(request.id)), status_code=status.HTTP_302_FOUND)


@router.post("/token")
async def token(
    grant_type: str | None = Form(None),
    code: str | None = Form(None),
    redirect_uri: str | None = Form(None),
    client_id: str | None = Form(None),
    code_verifier: str | None = Form(None),
    refresh_token: str | None = Form(None),
    resource: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """The token endpoint: the ``authorization_code`` and ``refresh_token``
    grants, form-encoded, for public clients (``client_id`` in the body)."""
    try:
        if not client_id:
            raise OAuthError("invalid_request", "client_id is required.")
        if grant_type == "authorization_code":
            if not (code and redirect_uri and code_verifier):
                raise OAuthError("invalid_request", "code, redirect_uri and code_verifier are required.")
            body = await exchange_code(code, client_id, redirect_uri, code_verifier, resource, db)
        elif grant_type == "refresh_token":
            if not refresh_token:
                raise OAuthError("invalid_request", "refresh_token is required.")
            body = await refresh_tokens(refresh_token, client_id, resource, db)
        else:
            raise OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.")
    except OAuthError as error:
        return _oauth_error(error)
    return JSONResponse(body, headers=_NO_STORE)


@router.post("/revoke")
async def revoke(
    token: str | None = Form(None),
    client_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Token revocation (RFC 7009). Answers 200 even for unknown tokens."""
    if token:
        await revoke_token(token, client_id, db)
    return Response(status_code=status.HTTP_200_OK)


@router.get("/requests/{request_id}", response_model=AuthorizationRequestRead)
async def read_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuthorizationRequestRead:
    """What the consent page shows for a pending request."""
    request = await get_pending_request(request_id, db)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Authorization request not found or expired")
    host = redirect_host(request.redirect_uri)
    return AuthorizationRequestRead(
        client_name=request.client.client_name,
        redirect_host=host,
        redirect_is_local=request.redirect_uri.startswith("http://"),
        boards=[GrantBoardRead(id=b.id, name=b.name) for b in await selectable_boards(current_user, db)],
        expires_at=request.expires_at,
    )


@router.post("/requests/{request_id}/approve", response_model=ConsentResult)
async def approve(
    request_id: uuid.UUID,
    body: ConsentApprove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConsentResult:
    """Allow the client to reach the chosen boards; answers where to send the
    browser (the client's redirect URI, with the code)."""
    request = await get_pending_request(request_id, db)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Authorization request not found or expired")
    try:
        redirect_to = await approve_request(request, current_user, body.board_ids, body.read_only, db)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    return ConsentResult(redirect_to=redirect_to)


@router.post("/requests/{request_id}/deny", response_model=ConsentResult)
async def deny(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConsentResult:
    """Refuse the request; answers where to send the browser (the client's
    redirect URI, with ``error=access_denied``)."""
    request = await get_pending_request(request_id, db)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Authorization request not found or expired")
    return ConsentResult(redirect_to=await deny_request(request, db))


async def _grant_read(grant: McpGrant, db: AsyncSession) -> McpGrantRead:
    board_ids = [b.board_id for b in grant.boards]
    result = await db.execute(
        select(Board).where(Board.id.in_(board_ids), Board.is_deleted.is_(False)).order_by(Board.name)
    )
    return McpGrantRead(
        id=grant.id,
        client_name=grant.client.client_name,
        redirect_host=client_redirect_host(grant.client),
        read_only=grant.read_only,
        created_at=grant.created_at,
        last_used_at=grant.last_used_at,
        boards=[GrantBoardRead(id=b.id, name=b.name, is_archived=b.is_archived) for b in result.scalars()],
    )


@router.get("/grants", response_model=list[McpGrantRead])
async def list_grants(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[McpGrantRead]:
    """The applications the user has connected, newest first."""
    return [await _grant_read(g, db) for g in await user_grants(current_user, db)]


@router.patch("/grants/{grant_id}", response_model=McpGrantRead)
async def update_grant(
    grant_id: uuid.UUID,
    body: McpGrantUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> McpGrantRead:
    """Change a grant's boards or read-only flag; takes effect on the client's
    next call."""
    grant = await get_user_grant(grant_id, current_user, db)
    if grant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    if body.board_ids is not None:
        try:
            selected = await check_board_selection(body.board_ids, current_user, db)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
        grant.boards = [McpGrantBoard(board_id=board_id) for board_id in selected]
    if body.read_only is not None:
        grant.read_only = body.read_only
    await db.commit()
    grant = await get_user_grant(grant_id, current_user, db)
    return await _grant_read(grant, db)


@router.delete("/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_grant(
    grant_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Revoke a connection: its tokens stop working at once."""
    grant = await get_user_grant(grant_id, current_user, db)
    if grant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    await db.delete(grant)
    await db.commit()
