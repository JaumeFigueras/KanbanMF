#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fill the development server with the demo data the manual's screenshots show.

Run from the repository root, with the dev backend up (``make run backend``)::

    .venv/bin/python docs/screenshots/seed.py --lang en

What it does, in order:

1. Deletes the demo users of the requested language (see :data:`USERS`) and,
   through the database's ``ON DELETE CASCADE``, everything they own: boards,
   lists, cards, shares, time entries... Nothing else in the database is
   touched, so the demos of different languages live side by side.
2. Creates the demo users of the requested language straight in the database,
   already verified. Going through ``/auth/local/register`` would send a
   verification e-mail, and a development ``backend/.env`` may well point at a
   real SMTP server.
3. Builds the boards, templates, lists, labels, cards, checklists, shares and
   time entries through the REST API, signed in as each user, exactly as the
   frontend would.
4. Adds a pending invitation straight in the database, for the same reason as
   step 2: the API would e-mail it.
5. Connects "Claude" to the first user's main board, straight in the database
   (an OAuth client and a grant, as if the consent page had been answered),
   so the Connected apps dialog has something to show.

The demo data is written in the language being documented, so the Catalan
screenshots show Catalan board and card names. Due dates are relative to
today, so every due-date colour and the overdue page always have something
to show. No e-mail reminders are switched on: the hourly job would send them
for real.

The users' password is :data:`DEMO_PASSWORD`; sign in as the first user of a
language to look around after seeding.
"""

import argparse
import asyncio
import secrets
import struct
import sys
import zlib
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

# The backend is imported as the top-level ``src`` package, from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import delete  # noqa: E402

from src.core.database import AsyncSessionLocal, engine  # noqa: E402
from src.core.security import hash_password  # noqa: E402
from src.model import (  # noqa: E402
    BoardInvitation, McpGrant, McpGrantBoard, OAuthClient, User, UserIdentity, UserPreferences,
)
from src.model.user_identity import AuthProvider  # noqa: E402

DEMO_PASSWORD = "demo-password"
TIMEZONE = "Europe/Madrid"

# The demo cast, per language. The first user is the one the screenshots are
# taken as. Addresses are on example.com (RFC 2606), which can't receive mail.
USERS = {
    "en": [
        ("emma.wilson@example.com", "Emma Wilson"),
        ("liam.carter@example.com", "Liam Carter"),
        ("sofia.lopez@example.com", "Sofia Lopez"),
    ],
    "ca": [
        ("marta.vidal@example.com", "Marta Vidal"),
        ("pau.serra@example.com", "Pau Serra"),
        ("laia.puig@example.com", "Laia Puig"),
    ],
}
INVITEE = {"en": "olivia.brown@example.com", "ca": "joan.ferrer@example.com"}
LOCALES = {"en": ("en", "en_GB"), "ca": ("ca_ES", "ca_ES")}

# Board, list and label colours come from frontend/src/utils/colorPalette.ts.
BLUE, GREEN, ORANGE, RED, PURPLE, PINK, BROWN = (
    "#1976D2", "#388E3C", "#F57C00", "#D32F2F", "#7B1FA2", "#C2185B", "#5D4037",
)

# Everything the demo shows, in both languages. Cards are
#   (list, name, description, start, due, end, labels, members, assignees,
#    checklists, colour)
# with dates as day offsets from today (None for no date) and people as
# indexes into USERS. A checklist is (name, [(text, done), ...]).
TEXT = {
    "en": {
        "main": "Website redesign",
        "lists": ["Backlog", "To do", "In progress", "Done"],
        "labels": [("Design", PURPLE), ("Frontend", BLUE), ("Content", GREEN),
                   ("Bug", RED), ("Urgent", ORANGE)],
        "cards": [
            (0, "Accessibility audit", "Check contrast, keyboard navigation and screen reader labels on every page.",
             None, 18, None, [1], [0], [2], [], None),
            (0, "Newsletter sign-up form", None, None, None, None, [1, 2], [], [], [], None),
            (0, "Translate the blog into Catalan", None, None, 30, None, [2], [], [1], [], None),
            (1, "New colour palette", "Agree on the primary and accent colours with the client.",
             -6, -2, None, [0, 4], [1], [0], [], None),
            (1, "Write the About us page", "Two short paragraphs and a team photo.",
             None, 3, None, [2], [2], [0, 2], [("Sections", [("History", True), ("Team", False), ("Values", False)])], None),
            (1, "Fix broken links in the footer", None, None, 0, None, [3, 4], [], [1], [], RED),
            (2, "Homepage layout", "Hero, three feature blocks and the call to action. Mobile first.",
             -5, 6, None, [0, 1], [1, 2], [0],
             [("Desktop", [("Hero section", True), ("Feature blocks", True), ("Call to action", False)]),
              ("Mobile", [("Navigation menu", True), ("Hero section", False)])], None),
            (2, "Product photos", None, -2, 9, None, [2], [], [2], [], None),
            (2, "Contact form validation", "Show the errors next to each field, not in a pop-up.",
             -1, -1, None, [1, 3], [], [0, 1], [], None),
            (2, "Pricing page copy", None, -8, 1, None, [2], [0], [2], [], None),
            (3, "Choose the CMS", None, -20, -12, -13, [], [0, 1], [0], [], None),
            (3, "Kick-off meeting", None, -25, -24, -24, [], [0, 1, 2], [0], [], None),
        ],
        "archived_cards": [(3, "Old logo sketches")],
        "archived_list": ("Rejected ideas", ["Animated background", "Chat bot"]),
        "other_boards": [
            ("Home renovation", GREEN, ["To buy", "In progress", "Done"],
             [(0, "Kitchen tiles", 12), (0, "Paint for the bedroom", 4), (1, "Fix the bathroom tap", -3)]),
            ("Conference 2027", PURPLE, ["Speakers", "Venue", "Sponsors"],
             [(0, "Confirm the keynote speaker", 20), (1, "Visit the venue", 7)]),
        ],
        "shared_board": ("Marketing plan", ORANGE, ["Ideas", "This month", "Published"],
                         [(1, "Spring campaign", 5), (1, "Social media calendar", -4), (2, "Launch announcement", None)]),
        "archived_board": "Old intranet",
        "template": ("Weekly sprint", ["Backlog", "This week", "Doing", "Done"]),
        "time_comments": ["Client call", "First draft", None, "Review with the team", None, "Fixes after review"],
    },
    "ca": {
        "main": "Redisseny del web",
        "lists": ["Pendents", "Per fer", "En curs", "Fet"],
        "labels": [("Disseny", PURPLE), ("Frontend", BLUE), ("Continguts", GREEN),
                   ("Error", RED), ("Urgent", ORANGE)],
        "cards": [
            (0, "Auditoria d'accessibilitat", "Revisar el contrast, la navegació amb teclat i les etiquetes per a lectors de pantalla de totes les pàgines.",
             None, 18, None, [1], [0], [2], [], None),
            (0, "Formulari d'alta al butlletí", None, None, None, None, [1, 2], [], [], [], None),
            (0, "Traduir el blog a l'anglès", None, None, 30, None, [2], [], [1], [], None),
            (1, "Nova paleta de colors", "Acordar amb el client els colors principal i d'accent.",
             -6, -2, None, [0, 4], [1], [0], [], None),
            (1, "Escriure la pàgina Qui som", "Dos paràgrafs curts i una foto de l'equip.",
             None, 3, None, [2], [2], [0, 2], [("Apartats", [("Història", True), ("Equip", False), ("Valors", False)])], None),
            (1, "Arreglar els enllaços trencats del peu", None, None, 0, None, [3, 4], [], [1], [], RED),
            (2, "Disseny de la portada", "Capçalera, tres blocs de funcionalitats i la crida a l'acció. Primer el mòbil.",
             -5, 6, None, [0, 1], [1, 2], [0],
             [("Escriptori", [("Capçalera", True), ("Blocs de funcionalitats", True), ("Crida a l'acció", False)]),
              ("Mòbil", [("Menú de navegació", True), ("Capçalera", False)])], None),
            (2, "Fotos dels productes", None, -2, 9, None, [2], [], [2], [], None),
            (2, "Validació del formulari de contacte", "Mostrar els errors al costat de cada camp, no en una finestra emergent.",
             -1, -1, None, [1, 3], [], [0, 1], [], None),
            (2, "Textos de la pàgina de preus", None, -8, 1, None, [2], [0], [2], [], None),
            (3, "Triar el gestor de continguts", None, -20, -12, -13, [], [0, 1], [0], [], None),
            (3, "Reunió d'inici", None, -25, -24, -24, [], [0, 1, 2], [0], [], None),
        ],
        "archived_cards": [(3, "Esbossos del logotip antic")],
        "archived_list": ("Idees descartades", ["Fons animat", "Xat automàtic"]),
        "other_boards": [
            ("Reforma de casa", GREEN, ["Per comprar", "En curs", "Fet"],
             [(0, "Rajoles de la cuina", 12), (0, "Pintura per a l'habitació", 4), (1, "Arreglar l'aixeta del bany", -3)]),
            ("Congrés 2027", PURPLE, ["Ponents", "Espai", "Patrocinadors"],
             [(0, "Confirmar la ponència inaugural", 20), (1, "Visitar l'espai", 7)]),
        ],
        "shared_board": ("Pla de màrqueting", ORANGE, ["Idees", "Aquest mes", "Publicat"],
                         [(1, "Campanya de primavera", 5), (1, "Calendari de xarxes socials", -4), (2, "Anunci del llançament", None)]),
        "archived_board": "Intranet antiga",
        "template": ("Sprint setmanal", ["Pendents", "Aquesta setmana", "En curs", "Fet"]),
        "time_comments": ["Trucada amb el client", "Primer esborrany", None, "Revisió amb l'equip", None, "Correccions després de la revisió"],
    },
}


def avatar_png(rgb_top: tuple[int, int, int], rgb_bottom: tuple[int, int, int], size: int = 96) -> bytes:
    """A small vertical-gradient PNG, so one demo user has a picture avatar.

    Written by hand to avoid a Pillow dependency for one image.
    """
    rows = []
    for y in range(size):
        t = y / (size - 1)
        pixel = bytes(round(a + (b - a) * t) for a, b in zip(rgb_top, rgb_bottom))
        rows.append(b"\x00" + pixel * size)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def day_at(offset: int | None, hour: int = 17) -> str | None:
    """Today + ``offset`` days at ``hour`` local time, as an ISO UTC string."""
    if offset is None:
        return None
    tz = ZoneInfo(TIMEZONE)
    local = datetime.combine(datetime.now(tz).date() + timedelta(days=offset), time(hour), tz)
    return local.astimezone(timezone.utc).isoformat()


async def reset_users(lang: str) -> list[str]:
    """Delete this language's demo users, then create them again, verified. Returns their ids."""
    language_locale, number_locale = LOCALES[lang]
    async with AsyncSessionLocal() as db:
        await db.execute(delete(User).where(User.email.in_([email for email, _ in USERS[lang]])))
        ids = []
        for email, name in USERS[lang]:
            user = User(email=email, display_name=name, is_active=True, is_verified=True)
            db.add(user)
            await db.flush()
            db.add(UserIdentity(user_id=user.id, provider=AuthProvider.LOCAL,
                                hashed_password=hash_password(DEMO_PASSWORD)))
            db.add(UserPreferences(user_id=user.id, language_locale=language_locale,
                                   number_locale=number_locale, timezone=TIMEZONE))
            ids.append(str(user.id))
        await db.commit()
    return ids


async def add_invitation(board_id: str, inviter_id: str, email: str, lang: str) -> None:
    """A pending invitation, written directly so that no e-mail goes out."""
    async with AsyncSessionLocal() as db:
        db.add(BoardInvitation(
            board_id=board_id, email=email, invited_by_id=inviter_id, language=lang,
            token=secrets.token_urlsafe(32),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        ))
        await db.commit()


async def add_connected_app(board_id: str, user_id: str, lang: str) -> None:
    """Claude, connected to the main board as the consent page would leave it.

    The client has a fixed id per language, so a new seed replaces it (the
    grant goes with the demo user).
    """
    client_id = f"demo-claude-{lang}"
    async with AsyncSessionLocal() as db:
        await db.execute(delete(OAuthClient).where(OAuthClient.client_id == client_id))
        client = OAuthClient(client_id=client_id, registration="dcr", client_name="Claude",
                             redirect_uris=["https://claude.ai/api/mcp/auth_callback"])
        db.add(McpGrant(user_id=user_id, client=client, read_only=False,
                        last_used_at=datetime.now(timezone.utc) - timedelta(hours=2),
                        boards=[McpGrantBoard(board_id=board_id)]))
        await db.commit()


class Api:
    """A signed-in API client for one demo user."""

    def __init__(self, base: str, email: str):
        self.http = httpx.Client(base_url=f"{base}/api/v1", timeout=30)
        r = self.http.post("/auth/local/login", json={"email": email, "password": DEMO_PASSWORD})
        r.raise_for_status()
        self.http.headers["Authorization"] = f"Bearer {r.json()['access_token']}"

    def call(self, method: str, path: str, **kwargs):
        r = self.http.request(method, path, **kwargs)
        if r.is_error:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text}")
        return r.json() if r.content else None

    def board(self, name: str, color: str | None = None, starred: bool = False,
              template: bool = False, template_id: str | None = None) -> str:
        board_id = self.call("POST", "/boards", json={
            "name": name, "is_starred": starred, "is_template": template, "template_id": template_id,
        })["id"]
        if color:
            self.call("PUT", f"/boards/{board_id}/color", json={"color": color})
        return board_id

    def lists(self, board_id: str, names: list[str]) -> list[str]:
        return [self.call("POST", f"/boards/{board_id}/lists", json={"name": n})["id"] for n in names]

    def card(self, board_id: str, list_id: str, name: str, **fields) -> str:
        return self.call("POST", f"/boards/{board_id}/lists/{list_id}/cards",
                         json={"name": name, **fields})["id"]


def build(lang: str, base: str, user_ids: list[str]) -> str:
    """Everything that goes through the API. Returns the main board's id."""
    t = TEXT[lang]
    owner, colleague, third = (Api(base, email) for email, _ in USERS[lang])

    # -- The main board: everything a board can hold -------------------------
    main = owner.board(t["main"], BLUE, starred=True)
    list_ids = owner.lists(main, t["lists"])
    owner.call("PUT", f"/boards/{main}/lists/{list_ids[0]}/color", json={"color": "#90CAF9"})
    owner.call("PUT", f"/boards/{main}/lists/{list_ids[3]}/color", json={"color": "#A5D6A7"})
    label_ids = [owner.call("POST", f"/boards/{main}/labels", json={"name": n, "color": c})["id"]
                 for n, c in t["labels"]]
    for user_id in user_ids[1:]:
        owner.call("POST", f"/boards/{main}/shares", json={"user_id": user_id})

    for (lst, name, desc, start, due, end, labels, members, assignees, checklists, color) in t["cards"]:
        card_id = owner.card(
            main, list_ids[lst], name, description=desc,
            start_at=day_at(start, 9), due_at=day_at(due), end_at=day_at(end),
            label_ids=[label_ids[i] for i in labels],
            member_ids=[user_ids[i] for i in members],
            assignee_ids=[user_ids[i] for i in assignees],
        )
        base_path = f"/boards/{main}/lists/{list_ids[lst]}/cards/{card_id}"
        for checklist_name, items in checklists:
            checklist_id = owner.call("POST", f"{base_path}/checklists", json={"name": checklist_name})["id"]
            for text, done in items:
                owner.call("POST", f"{base_path}/checklists/{checklist_id}/items",
                           json={"text": text, "is_done": done})
        if color:
            owner.call("PUT", f"{base_path}/color", json={"color": "#FFCDD2"})

    for lst, name in t["archived_cards"]:
        card_id = owner.card(main, list_ids[lst], name)
        owner.call("PATCH", f"/boards/{main}/lists/{list_ids[lst]}/cards/{card_id}", json={"is_archived": True})

    # An archived card above and an archived list holding two cards here, so
    # the "Archived Lists & Cards" view has something in both halves.
    archived_name, archived_cards = t["archived_list"]
    archived_list = owner.lists(main, [archived_name])[0]
    for name in archived_cards:
        owner.card(main, archived_list, name)
    owner.call("PATCH", f"/boards/{main}/lists/{archived_list}", json={"is_archived": True})

    # -- More boards, so the overview has something in every section ---------
    for name, color, names, cards in t["other_boards"]:
        board_id = owner.board(name, color)
        ids = owner.lists(board_id, names)
        for lst, card_name, due in cards:
            owner.card(board_id, ids[lst], card_name, due_at=day_at(due), assignee_ids=[user_ids[0]])

    name, color, names, cards = t["shared_board"]
    shared = colleague.board(name, color)
    ids = colleague.lists(shared, names)
    for lst, card_name, due in cards:
        colleague.card(shared, ids[lst], card_name, due_at=day_at(due),
                       assignee_ids=[user_ids[0], user_ids[1]] if due and due < 0 else [user_ids[1]])
    colleague.call("POST", f"/boards/{shared}/shares", json={"user_id": user_ids[0]})

    archived = owner.board(t["archived_board"], BROWN)
    owner.lists(archived, t["lists"][:2])
    owner.call("PATCH", f"/boards/{archived}", json={"is_archived": True})

    template_name, template_lists = t["template"]
    template = owner.board(template_name, PINK, template=True)
    owner.lists(template, template_lists)

    # -- People ---------------------------------------------------------------
    owner.call("PUT", "/users/me/avatar",
               files={"file": ("avatar.png", avatar_png((255, 183, 77), (194, 24, 91)), "image/png")})
    colleague.call("PUT", "/users/me/avatar",
                   files={"file": ("avatar.png", avatar_png((100, 181, 246), (13, 71, 161)), "image/png")})

    # -- A week of time entries, and one running now -------------------------
    cards = {c["name"]: (lst_id, c["id"])
             for lst_id in list_ids
             for c in owner.call("GET", f"/boards/{main}/lists/{lst_id}/cards")}
    names = [c[1] for c in t["cards"]]
    plan = [  # (days ago, start hour, minutes, card index)
        (6, 9, 90, 3), (6, 11, 45, 6), (5, 9, 120, 6), (5, 14, 60, 9),
        (4, 10, 75, 4), (3, 9, 50, 8), (3, 10, 40, 6), (2, 9, 150, 6),
        (1, 9, 60, 9), (1, 10, 55, 8),
    ]
    tz = ZoneInfo(TIMEZONE)
    today = datetime.now(tz).date()
    for n, (days_ago, hour, minutes, card_index) in enumerate(plan):
        list_id, card_id = cards[names[card_index]]
        start = datetime.combine(today - timedelta(days=days_ago), time(hour), tz)
        # One entry deliberately overlaps the previous one, to show the warning.
        if n == 6:
            start -= timedelta(minutes=20)
        owner.call("POST", "/time-entries", json={
            "board_id": main, "list_id": list_id, "card_id": card_id,
            "started_at": start.astimezone(timezone.utc).isoformat(),
            "ended_at": (start + timedelta(minutes=minutes)).astimezone(timezone.utc).isoformat(),
            "comment": t["time_comments"][n % len(t["time_comments"])],
        })
    list_id, card_id = cards[names[6]]
    owner.call("POST", "/time-entries/start", json={"board_id": main, "list_id": list_id, "card_id": card_id})

    for api in (owner, colleague, third):
        api.http.close()
    return main


async def seed(lang: str, base: str) -> None:
    # One event loop for all the database work: the async engine's pooled
    # connections belong to the loop that opened them.
    try:
        user_ids = await reset_users(lang)
        main = await asyncio.to_thread(build, lang, base, user_ids)
        await add_invitation(main, user_ids[0], INVITEE[lang], lang)
        await add_connected_app(main, user_ids[0], lang)
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--lang", choices=sorted(USERS), default="en")
    parser.add_argument("--api", default="http://localhost:8000", help="backend base URL")
    args = parser.parse_args()

    asyncio.run(seed(args.lang, args.api))
    print(f"Seeded the {args.lang} demo. Sign in as {USERS[args.lang][0][0]} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
