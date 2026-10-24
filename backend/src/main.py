#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The FastAPI application: CORS, the ``/api/v1`` router, the ``/.well-known``
OAuth discovery documents, the MCP server at ``/mcp``, a health check, and a
lifespan that starts and stops the scheduler and the MCP session manager with
the app.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.routing import Route

from src.api import well_known
from src.api.mcp_server.server import create_mcp_app, create_mcp_server
from src.api.v1.router import router
from src.core.config import settings
from src.core.scheduler import shutdown_scheduler, start_scheduler


mcp_server = create_mcp_server()
mcp_app = create_mcp_app(mcp_server)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    start_scheduler()
    async with mcp_server.session_manager.run():
        yield
    shutdown_scheduler()


app = FastAPI(
    title=settings.app_name,
    description="KanbanMF REST API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(well_known.router)
# The SDK's own Starlette app, at exactly /mcp: a plain Route rather than a
# Mount, which would only match /mcp/ and redirect /mcp there.
app.router.routes.append(Route("/mcp", endpoint=mcp_app))


@app.get("/healthz", tags=["ops"])
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
