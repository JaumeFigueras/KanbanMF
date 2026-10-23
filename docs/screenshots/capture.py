#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Capture the user manual's screenshots from the running development server.

Run from the repository root, with both dev servers up and the demo data of
the same language seeded (``seed.py``)::

    .venv/bin/python docs/screenshots/capture.py --lang en

or let ``make screenshots`` do both, for every language.

Every shot is a function below, registered with :func:`shot`, that drives the
real frontend in headless Chromium and saves
``docs/source/manual/img/<name>.png`` for English and ``<name>.<lang>.png``
for any other language — the naming Sphinx's ``figure_language_filename``
picks up, so a page references ``img/<name>.png`` once. ``--only`` retakes a
few shots without running them all.

Buttons and menu entries are found by their visible text, read from the
frontend's own translation files (``frontend/src/i18n/locales/<lang>.ts``),
so the same script drives the app in any language and breaks loudly, rather
than silently capturing the wrong thing, when a label changes.

Dialogs are closed with Escape rather than submitted, so the shots leave the
demo data as the seed made it — with one exception. The e-mail notification
dialog saves every change as it is made, so the ``notifications`` shot really
does switch the demo user's reminders on; it switches them off again straight
after, whatever happens, because the hourly job would otherwise send them.
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Locator, Page, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))

from seed import DEMO_PASSWORD, TEXT, TIMEZONE, USERS  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "source" / "manual" / "img"
VIEWPORT = {"width": 1440, "height": 900}
LANGUAGE_LABELS = {"en": "English", "ca": "Català"}


def load_strings(lang: str) -> dict:
    """The frontend's translation table, by importing the .ts file with Node."""
    path = REPO / "frontend" / "src" / "i18n" / "locales" / f"{lang}.ts"
    script = "const m = await import(process.argv[1]); console.log(JSON.stringify(m.default))"
    result = subprocess.run(["node", "--input-type=module", "-e", script, str(path)],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


class Shooter:
    """Holds the page, the language and its strings, and saves the images."""

    def __init__(self, page: Page, lang: str, base: str):
        self.page, self.lang, self.base = page, lang, base
        self.strings = load_strings(lang)
        self.text = TEXT[lang]

    def t(self, key: str) -> str:
        value = self.strings
        for part in key.split("."):
            value = value[part]
        return value

    # -- Navigation ----------------------------------------------------------

    def goto(self, path: str) -> None:
        self.page.goto(self.base + path)
        self.settle()

    def settle(self, ms: int = 600) -> None:
        """Let requests and MUI transitions finish before a screenshot."""
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(ms)

    def escape(self) -> None:
        """Close whatever menu or dialog is open, without saving anything."""
        self.page.keyboard.press("Escape")
        self.page.wait_for_timeout(400)

    def button(self, key: str, within: Locator | Page | None = None) -> Locator:
        return (within or self.page).get_by_role("button", name=self.t(key), exact=True)

    def labelled(self, key: str, within: Locator | Page | None = None) -> Locator:
        """An element by its aria-label. Unlike get_by_role, this still finds a
        menu's anchor once the open menu has hidden the page from assistive
        technology (aria-hidden), which is when the screenshot is taken."""
        return (within or self.page).locator(f'[aria-label="{self.t(key)}"]').first

    def menu_item(self, key: str) -> Locator:
        return self.page.get_by_role("menuitem", name=self.t(key))

    def dialog(self) -> Locator:
        return self.page.get_by_role("dialog").last

    def menu(self) -> Locator:
        return self.page.get_by_role("menu").last

    def open_board(self, name: str | None = None) -> None:
        self.goto("/boards")
        self.page.get_by_text(name or self.text["main"], exact=True).first.click()
        self.page.wait_for_url("**/boards/*")
        self.settle(900)

    def board_tile(self, name: str) -> Locator:
        """A board's tile on the overview — the outlined card holding its name."""
        return self.page.locator(".MuiCard-root", has=self.page.get_by_text(name, exact=True)).first

    def open_tile_menu(self, name: str) -> Locator:
        """Open a board tile's menu (its last icon button) and return the tile."""
        tile = self.board_tile(name)
        tile.locator("button.MuiIconButton-root").last.click()
        self.settle(300)
        return tile

    def list_column(self, name: str) -> Locator:
        return self.page.locator(".MuiPaper-root", has=self.page.get_by_text(name, exact=True)).first

    def card_face(self, name: str) -> Locator:
        return self.page.locator(".MuiCard-root", has=self.page.get_by_text(name, exact=True)).last

    # -- Saving --------------------------------------------------------------

    def save(self, name: str, *areas: Locator, pad: int = 16, full_page: bool = False) -> None:
        """Screenshot the viewport, or the box around ``areas`` plus ``pad``."""
        suffix = "" if self.lang == "en" else f".{self.lang}"
        path = OUT / f"{name}{suffix}.png"
        if not areas:
            self.page.screenshot(path=path, full_page=full_page)
        else:
            boxes = [a.bounding_box() for a in areas]
            x0 = max(0, min(b["x"] for b in boxes) - pad)
            y0 = max(0, min(b["y"] for b in boxes) - pad)
            x1 = min(VIEWPORT["width"], max(b["x"] + b["width"] for b in boxes) + pad)
            y1 = min(VIEWPORT["height"], max(b["y"] + b["height"] for b in boxes) + pad)
            self.page.screenshot(path=path, clip={"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0})
        print(f"  {path.relative_to(REPO)}")


SHOTS = []


def shot(func):
    """Register a screenshot function; they run in the order defined."""
    SHOTS.append(func)
    return func


# -- Signing in --------------------------------------------------------------
# These run signed out, so the language has to be picked on the page itself.


def pick_public_language(s: Shooter) -> None:
    if s.lang == "en":
        return
    s.page.get_by_role("combobox").first.click()
    s.page.get_by_role("option", name=LANGUAGE_LABELS[s.lang]).click()
    s.page.evaluate("document.activeElement.blur()")
    s.settle(300)


@shot
def signin(s: Shooter) -> None:
    s.goto("/signin")
    pick_public_language(s)
    s.save("signin")


@shot
def signup(s: Shooter) -> None:
    s.goto("/signup")
    pick_public_language(s)
    s.save("signup")


def sign_in(s: Shooter) -> None:
    s.goto("/signin")
    s.page.fill("input[name=email]", USERS[s.lang][0][0])
    s.page.fill("input[name=password]", DEMO_PASSWORD)
    s.page.press("input[name=password]", "Enter")
    s.page.wait_for_url("**/boards")
    s.settle()


# -- The boards overview -----------------------------------------------------


@shot
def boards_overview(s: Shooter) -> None:
    s.goto("/boards")
    s.save("boards-overview", full_page=True)


@shot
def board_tile_menu(s: Shooter) -> None:
    s.goto("/boards")
    tile = s.open_tile_menu(s.text["main"])
    s.save("board-tile-menu", tile, s.menu())
    s.escape()


@shot
def color_picker(s: Shooter) -> None:
    s.goto("/boards")
    s.open_tile_menu(s.text["main"])
    s.menu_item("boards.changeBoardColor").click()
    s.settle()
    s.save("color-picker", s.dialog())
    s.escape()


@shot
def create_board(s: Shooter) -> None:
    s.goto("/boards")
    s.button("boards.createNewBoard").click()
    s.settle(300)
    s.dialog().get_by_label(s.t("boards.useTemplate")).click()
    s.page.get_by_role("option", name=s.text["template"][0]).click()
    s.dialog().get_by_label(s.t("boards.boardName")).fill(s.text["template"][0])
    s.settle(300)
    s.save("create-board", s.dialog())
    s.escape()


@shot
def archived_boards(s: Shooter) -> None:
    s.goto("/boards")
    s.button("boards.showArchivedBoards").click()
    s.settle()
    heading = s.page.get_by_text(s.t("boards.archivedBoards"), exact=False).first
    heading.scroll_into_view_if_needed()
    s.settle(300)
    s.save("archived-boards", heading, s.board_tile(s.text["archived_board"]), pad=24)


@shot
def share_dialog(s: Shooter) -> None:
    s.goto("/boards")
    s.open_tile_menu(s.text["main"])
    s.menu_item("boards.shareBoard").click()
    s.settle()
    s.save("share", s.dialog())
    s.escape()


@shot
def notifications(s: Shooter) -> None:
    s.goto("/boards")
    s.open_tile_menu(s.text["main"])
    s.menu_item("boards.emailNotification").click()
    s.settle()
    # This dialog saves each change immediately (see the module docstring).
    # The reminder job runs on the hour, so don't leave them on across one.
    while datetime.now().minute in (59, 0):
        time.sleep(15)
    enabled = s.dialog().get_by_label(s.t("boards.enableEmailNotifications"))
    enabled.check()
    try:
        s.settle(300)
        for offset in ("-1", "0"):
            s.dialog().get_by_placeholder(s.t("boards.offsetDaysPlaceholder")).fill(offset)
            s.labelled("common.add", s.dialog()).click()
            s.settle(300)
        s.save("notifications", s.dialog())
    finally:
        enabled.uncheck()
        s.settle()
    s.escape()


@shot
def overdue(s: Shooter) -> None:
    s.goto("/boards")
    s.button("boards.showOverdueTasks").click()
    s.page.wait_for_url("**/overdue")
    s.settle()
    # Open every board's section; each click shrinks the set of closed ones.
    closed = s.page.locator('.MuiAccordionSummary-root[aria-expanded="false"]')
    while closed.count():
        closed.first.click()
        s.page.wait_for_timeout(300)
    s.settle(900)
    s.save("overdue", full_page=True)


# -- A board -----------------------------------------------------------------


@shot
def board(s: Shooter) -> None:
    s.open_board()
    s.save("board")


@shot
def board_menu(s: Shooter) -> None:
    s.open_board()
    anchor = s.labelled("board.boardMenu")
    anchor.click()
    s.settle(300)
    s.save("board-menu", anchor, s.menu())
    s.escape()


@shot
def sort_cards(s: Shooter) -> None:
    s.open_board()
    sort = s.labelled("board.sortCards")
    sort.click()
    s.settle(300)
    s.save("sort-cards", sort, s.menu())
    s.escape()


@shot
def list_menu(s: Shooter) -> None:
    s.open_board()
    column = s.list_column(s.text["lists"][1])
    s.labelled("board.listMenu", column).click()
    s.settle(300)
    s.save("list-menu", column.get_by_text(s.text["lists"][1], exact=True), s.menu())
    s.escape()


@shot
def card_menu(s: Shooter) -> None:
    s.open_board()
    card = s.card_face(s.text["cards"][5][1])
    s.labelled("board.cardMenu", card).click()
    s.settle(300)
    s.save("card-menu", card, s.menu())
    s.escape()


@shot
def card_dialog(s: Shooter) -> None:
    s.open_board()
    s.page.get_by_text(s.text["cards"][6][1], exact=True).click()
    s.settle()
    s.save("card-dialog", s.dialog())
    s.escape()


@shot
def copy_card(s: Shooter) -> None:
    s.open_board()
    card = s.card_face(s.text["cards"][5][1])
    s.labelled("board.cardMenu", card).click()
    s.menu_item("board.copyCard").click()
    s.settle()
    s.save("copy-card", s.dialog())
    s.escape()


@shot
def labels(s: Shooter) -> None:
    s.open_board()
    s.button("board.manageLabels").click()
    s.settle()
    s.save("labels", s.dialog())
    s.escape()


@shot
def archive_view(s: Shooter) -> None:
    s.open_board()
    s.button("board.archive").click()
    s.settle(900)
    s.save("archive-view")


@shot
def template_board(s: Shooter) -> None:
    s.open_board(s.text["template"][0])
    s.save("template-board")


# -- Time tracker ------------------------------------------------------------


@shot
def time_tracker(s: Shooter) -> None:
    s.goto("/time-tracker")
    s.settle(900)
    s.save("time-tracker")


@shot
def time_entry(s: Shooter) -> None:
    s.goto("/time-tracker")
    s.page.get_by_role("button", name=s.t("timeTracker.editEntry")).first.click()
    s.settle()
    s.save("time-entry", s.dialog())
    s.escape()


# -- The user menu -----------------------------------------------------------


def open_user_menu(s: Shooter) -> Locator:
    anchor = s.labelled("boards.userProfile")
    anchor.click()
    s.settle(300)
    return anchor


@shot
def user_menu(s: Shooter) -> None:
    s.goto("/boards")
    anchor = open_user_menu(s)
    s.save("user-menu", anchor, s.menu())
    s.escape()


@shot
def preferences(s: Shooter) -> None:
    s.goto("/boards")
    open_user_menu(s)
    s.menu_item("boards.languageLocalization").click()
    s.settle()
    s.save("preferences", s.dialog())
    s.escape()


@shot
def display_name(s: Shooter) -> None:
    s.goto("/boards")
    open_user_menu(s)
    s.menu_item("boards.changeDisplayName").click()
    s.settle()
    s.save("display-name", s.dialog())
    s.escape()


@shot
def board_dark(s: Shooter) -> None:
    s.goto("/boards")
    open_user_menu(s)
    s.menu_item("boards.changeToDark").click()
    try:
        s.open_board()
        s.save("board-dark")
    finally:
        s.goto("/boards")
        open_user_menu(s)
        s.menu_item("boards.changeToLight").click()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--lang", choices=sorted(USERS), default="en")
    parser.add_argument("--app", default="http://localhost:5173", help="frontend base URL")
    parser.add_argument("--only", nargs="*", help="names of the shot functions to run")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    selected = [f for f in SHOTS if not args.only or f.__name__ in args.only]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport=VIEWPORT, timezone_id=TIMEZONE,
                                      locale="ca-ES" if args.lang == "ca" else "en-GB")
        page = context.new_page()
        page.set_default_timeout(10_000)
        s = Shooter(page, args.lang, args.app)
        public = [f for f in selected if f in (signin, signup)]
        for func in public:
            func(s)
        if len(public) < len(selected):
            sign_in(s)
        for func in selected:
            if func not in public:
                func(s)
        browser.close()


if __name__ == "__main__":
    main()
