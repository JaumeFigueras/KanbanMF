#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""What a page is told over its WebSocket, for the tests of live updates:
the notifications themselves, and waiting until a page is told of what
changes, which the backend doesn't say."""

import json
import time


def notifications(page) -> list[str]:
    """The type of every notification the page is told of over its
    WebSocket, as it's told. Set up before the page opens its socket."""
    told = []
    page.on("websocket", lambda ws: ws.on("framereceived", lambda frame: told.append(json.loads(frame)["type"])))
    return told


def wait_until(page, condition, timeout=5) -> bool:
    """Whether condition() comes to hold within the timeout. Waits through
    the page, as Playwright tells of what happens (a request, a
    notification) only while it's being called."""
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            return False
        page.wait_for_timeout(50)
    return True


def listening(page, poke, *told):
    """Waits until each page is told of what changes. The backend doesn't say
    when a socket is signed in, so this pokes (a change that changes nothing)
    until each page has been told of it, then gives them a moment for what
    they fetch for it."""
    for _ in range(20):
        before = [len(t) for t in told]
        poke()
        if wait_until(page, lambda: all(len(t) > b for t, b in zip(told, before)), timeout=0.5):
            page.wait_for_timeout(300)
            return
    raise AssertionError("A page isn't told of what changes")


def unchanged_list_order(client, board):
    """A change that changes nothing, which everyone on the board is told of."""
    return lambda: client.put(f"/boards/{board.id}/lists/order",
                              json={"list_ids": list(board.lists.values())}).raise_for_status()
