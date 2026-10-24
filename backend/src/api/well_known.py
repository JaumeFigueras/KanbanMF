#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The ``/.well-known`` discovery documents MCP clients read before signing
in: the MCP server's Protected Resource Metadata (RFC 9728) and the
authorization server's metadata (RFC 8414).

They live at the root of the site, outside ``/api/v1``, because their
addresses are fixed by those RFCs.
"""

from fastapi import APIRouter

from src.core.oauth import SCOPE, issuer, mcp_resource

router = APIRouter(prefix="/.well-known", tags=["oauth"])


def _protected_resource() -> dict:
    return {
        "resource": mcp_resource(),
        "authorization_servers": [issuer()],
        "scopes_supported": [SCOPE],
        "bearer_methods_supported": ["header"],
        "resource_name": "KanbanMF",
    }


@router.get("/oauth-protected-resource/mcp")
async def protected_resource_for_mcp() -> dict:
    """Protected Resource Metadata for ``/mcp``, at the path RFC 9728 derives
    from it."""
    return _protected_resource()


@router.get("/oauth-protected-resource")
async def protected_resource() -> dict:
    """The same document at the root, where clients look next."""
    return _protected_resource()


@router.get("/oauth-authorization-server")
async def authorization_server() -> dict:
    """Authorization Server Metadata.

    Advertises both ways a client can identify itself: a Client ID Metadata
    Document (with ``none`` as the token endpoint auth method, which Claude
    requires before using one) and Dynamic Client Registration.
    """
    base = f"{issuer()}/api/v1/oauth"
    return {
        "issuer": issuer(),
        "authorization_endpoint": f"{base}/authorize",
        "token_endpoint": f"{base}/token",
        "registration_endpoint": f"{base}/register",
        "revocation_endpoint": f"{base}/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [SCOPE],
        "client_id_metadata_document_supported": True,
        "authorization_response_iss_parameter_supported": True,
    }
