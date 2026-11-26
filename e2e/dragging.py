#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dragging with the mouse or moving with the keyboard, for the tests of
every drag area: picking up, letting go, what a screen reader is told, and
what the page sends."""

import re
import time
from contextlib import ExitStack
from urllib.parse import urlparse

MOVE_FAILED = "The move couldn't be saved, and has been undone. Please try again."


def eventually(read, expected, timeout=5):
    deadline = time.monotonic() + timeout
    while (got := read()) != expected and time.monotonic() < deadline:
        time.sleep(0.1)
    assert got == expected


def names(handles, prefix: str, axis: str | None = None) -> list[str]:
    """The names on the handles, in the page's order, or along the axis as
    they're seen: during a drag, the two differ."""
    # Read in one go, as the page may change them meanwhile.
    found = handles.evaluate_all("(handles, axis) => handles.map(h => "
                                 "[axis ? h.getBoundingClientRect()[axis] : 0, h.getAttribute('aria-label')])", axis)
    return [label.removeprefix(prefix) for _, label in sorted(found, key=lambda f: f[0])]


def centre(locator):
    box = locator.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def drag(page, handle, dragged, onto):
    """Picks the handle up and moves it until the middle of what's dragged
    is over the middle of `onto` (or over the point `onto`), without
    letting go. Where it would land follows from the dragged thing's
    middle, not the pointer's."""
    # Measured first: once it's picked up, a floating copy follows the
    # pointer, and its place is kept by a hidden one.
    dx, dy = centre(dragged)
    tx, ty = onto if isinstance(onto, tuple) else centre(onto)
    x, y = centre(handle)
    page.mouse.move(x, y)
    page.mouse.down()
    # Past the few pixels that start a drag.
    page.mouse.move(x + 6, y + 6, steps=3)
    page.mouse.move(x + tx - dx, y + ty - dy, steps=20)
    # The list makes room with an animation, which moves what's beneath.
    page.wait_for_timeout(400)


def changes(page) -> list[str]:
    """Every change the page sends, as "METHOD /path", as it sends it."""
    sent = []
    page.on("request", lambda r: sent.append(f"{r.method} {urlparse(r.url).path}") if r.method != "GET" else None)
    return sent


def heard(page, said, timeout=5):
    """Waits until dnd-kit's live region, which a screen reader reads out,
    says `said` (a text, or a pattern). A page has one per drag area."""
    regions = page.locator("[id^='DndLiveRegion']")
    says = said.fullmatch if isinstance(said, re.Pattern) else said.__eq__
    deadline = time.monotonic() + timeout
    while True:
        told = regions.all_text_contents()
        if any(says(text) for text in told) or time.monotonic() > deadline:
            break
        time.sleep(0.1)
    assert any(says(text) for text in told), f"A screen reader was told {told}"


def pick_up(page, handle, said):
    """Picks the handle up with the keyboard, as its instructions say, and
    waits until a screen reader is told `said`, and the arrow keys work:
    dnd-kit listens for them only from a timeout it sets on the pick-up, so
    a key pressed before then is lost. A timeout set after it runs after it."""
    handle.focus()
    page.keyboard.press("Space")
    heard(page, said)
    page.evaluate("() => new Promise(resolve => setTimeout(resolve))")


def press(page, key, said):
    """Presses a key while something is picked up, and waits until a screen
    reader is told `said`."""
    page.keyboard.press(key)
    heard(page, said)


def let_go(page, *saves, floating=True, key=None):
    """Lets go, or, moving with the keyboard, presses `key` (Space drops,
    Escape puts back), and waits until each of the changes the drop should
    send ("METHOD /path") has been saved, and the floating copy, if any, is
    gone. Until then, what's moved has two handles: looked for in the whole
    page, or in `floating` (a locator) where the page shows something twice
    anyway (a starred board)."""
    with ExitStack() as stack:
        answers = [stack.enter_context(page.expect_response(
            lambda r, save=save: f"{r.request.method} {urlparse(r.url).path}" == save)) for save in saves]
        if key:
            page.keyboard.press(key)
        else:
            page.mouse.up()
    for answer in answers:
        assert answer.value.ok, f"{answer.value.request.method} {answer.value.url}: {answer.value.status}"
    scope = page.locator("body") if floating is True else floating
    page.wait_for_function("""scope => {
        const labels = [...scope.querySelectorAll("button[aria-label^='Move ']")].map(b => b.ariaLabel)
        return new Set(labels).size === labels.length
    }""", arg=scope.element_handle())


def nothing_sent(page, sent):
    # Time for a change to go out, which would be counted.
    page.wait_for_timeout(500)
    assert sent == []
