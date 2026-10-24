#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Request and response bodies for the MCP server's OAuth endpoints: client
registration, the consent page, and the connected apps list."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ClientRegistrationRequest(BaseModel):
    """RFC 7591 client metadata. Fields this server doesn't use are ignored."""

    model_config = ConfigDict(extra="ignore")

    client_name: str | None = None
    redirect_uris: list[str] = []
    grant_types: list[str] | None = None
    token_endpoint_auth_method: str | None = None


class ClientRegistrationResponse(BaseModel):
    client_id: str
    client_id_issued_at: int
    client_name: str
    redirect_uris: list[str]
    grant_types: list[str] = ["authorization_code", "refresh_token"]
    response_types: list[str] = ["code"]
    token_endpoint_auth_method: str = "none"


class GrantBoardRead(BaseModel):
    id: uuid.UUID
    name: str
    is_archived: bool = False


class AuthorizationRequestRead(BaseModel):
    """What the consent page shows: who asks, where the answer goes, and the
    boards that can be chosen."""

    client_name: str
    redirect_host: str
    # The answer goes to a program on the user's own computer (e.g. Claude
    # Code); the page warns that any local program could claim that name.
    redirect_is_local: bool
    boards: list[GrantBoardRead]
    expires_at: datetime


class ConsentApprove(BaseModel):
    board_ids: list[uuid.UUID]
    read_only: bool = False


class ConsentResult(BaseModel):
    """Where the consent page sends the browser next."""

    redirect_to: str


class McpGrantRead(BaseModel):
    id: uuid.UUID
    client_name: str
    redirect_host: str
    read_only: bool
    created_at: datetime
    last_used_at: datetime | None
    boards: list[GrantBoardRead]


class McpGrantUpdate(BaseModel):
    board_ids: list[uuid.UUID] | None = None
    read_only: bool | None = None
