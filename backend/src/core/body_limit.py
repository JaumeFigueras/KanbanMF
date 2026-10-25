#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""A ceiling on the size of every request body, checked before the app reads
it.

FastAPI reads a JSON body whole before validating it, and Starlette parses a
multipart upload whole (into memory, then a temporary file) before the route
runs, so without a ceiling one request could make the backend hold or write
as much as it was sent. In production Apache refuses the same size first
(``LimitRequestBody`` in the vhost); this is the backend's own copy, for the
dev server and for anything that reaches uvicorn some other way.

A declared ``Content-Length`` over the limit is refused at once. A body sent
without one (chunked) is counted as it arrives, and refused when it passes
the limit.
"""

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# 1 MiB: the biggest legitimate body is an avatar (100 KB) or a card with a
# 20,000-character description, well under it. Same value as the vhost's
# LimitRequestBody.
MAX_REQUEST_BODY_BYTES = 1024 * 1024


class BodyTooLarge(HTTPException):
    """Raised from ``receive`` when a body without a ``Content-Length`` grows
    past the limit. An ``HTTPException``, so FastAPI's body parsing passes it
    on as a 413 instead of turning it into a 400."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail="Request body too large")


class BodySizeLimitMiddleware:
    """Refuse request bodies over ``max_bytes`` with 413."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        too_large = JSONResponse({"detail": "Request body too large"}, status_code=413)
        for name, value in scope["headers"]:
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = None
                if declared is None or declared > self.max_bytes:
                    await too_large(scope, receive, send)
                    return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLarge()
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except BodyTooLarge:
            # Raised outside FastAPI's body parsing, e.g. by the MCP app.
            if response_started:
                raise
            await too_large(scope, receive, send)
