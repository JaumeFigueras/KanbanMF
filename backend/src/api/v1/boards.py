#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_client_id, get_current_user, get_db, reject_if_template
# The overdue page draws the same card faces the board does, so it reuses the
# card serialization helpers instead of growing a second copy of them here.
from src.api.v1.cards import (
    _card_load_options,
    _card_people_ids,
    _card_to_read,
    _people_by_id,
)
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification, board_recipients
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.ui_board_color import UIBoardColor
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_board_order import UIBoardOrder
from src.model.ui_card_color import UICardColor
from src.model.ui_list_color import UIListColor
from src.model.user import User
from src.model.user_avatar import UserAvatar
from src.model.user_board_star import UserBoardStar
from src.model.user_preferences import UserPreferences
from src.schemas.board import (
    BoardCreate,
    BoardOrderRead,
    BoardOrderUpdate,
    BoardRead,
    BoardShareCreate,
    BoardUpdate,
    BoardsResponse,
    OverdueBoardRead,
    OverdueListRead,
    TemplateDuplicate,
)
from src.schemas.person import PersonRead
from src.schemas.ui_color import BoardColorsRead, ColorRead, ColorUpdate

router = APIRouter()


def _compute_initials(display_name: str) -> str:
    return "".join(w[0].upper() for w in display_name.split() if w)[:3]


async def _starred_ids(user_id: uuid.UUID, db: AsyncSession) -> set[uuid.UUID]:
    """Return the set of board IDs that the given user has starred."""
    result = await db.execute(
        select(UserBoardStar.board_id).where(UserBoardStar.user_id == user_id)
    )
    return set(result.scalars().all())


def _to_read(
    board: Board,
    starred: set[uuid.UUID],
    owner_display_name: str,
    owner_initials: str | None,
    owner_has_avatar: bool,
) -> BoardRead:
    return BoardRead(
        id=board.id,
        owner_id=board.owner_id,
        owner_display_name=owner_display_name,
        owner_initials=owner_initials,
        owner_has_avatar=owner_has_avatar,
        name=board.name,
        is_archived=board.is_archived,
        is_deleted=board.is_deleted,
        is_template=board.is_template,
        is_starred=board.id in starred,
        created_at=board.created_at,
        updated_at=board.updated_at,
    )


async def _get_order(user_id: uuid.UUID, db: AsyncSession) -> UIBoardOrder | None:
    result = await db.execute(
        select(UIBoardOrder).where(UIBoardOrder.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _remove_from_order(
    user_id: uuid.UUID, board_id: uuid.UUID, db: AsyncSession
) -> None:
    """Remove a board ID from all four order arrays in one statement."""
    await db.execute(
        update(UIBoardOrder)
        .where(UIBoardOrder.user_id == user_id)
        .values(
            owned_ids=func.array_remove(UIBoardOrder.owned_ids, board_id),
            starred_ids=func.array_remove(UIBoardOrder.starred_ids, board_id),
            shared_ids=func.array_remove(UIBoardOrder.shared_ids, board_id),
            template_ids=func.array_remove(UIBoardOrder.template_ids, board_id),
            updated_at=func.now(),
        )
    )


async def _append_to_order(
    user_id: uuid.UUID, section: str, board_id: uuid.UUID, db: AsyncSession
) -> None:
    """Append a board ID to one of the user's order arrays, creating the row if needed."""
    column = getattr(UIBoardOrder, section)
    await db.execute(
        pg_insert(UIBoardOrder)
        .values(user_id=user_id, **{section: [board_id]})
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={section: func.array_append(column, board_id), "updated_at": func.now()},
        )
    )


async def _read_as_owner(
    board: Board, owner: User, starred: set[uuid.UUID], db: AsyncSession
) -> BoardRead:
    """Build the BoardRead for a board the given user owns, looking up their initials and avatar."""
    pref_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == owner.id)
    )
    pref = pref_result.scalar_one_or_none()
    owner_initials = (
        pref.initials if (pref and pref.initials)
        else _compute_initials(owner.display_name)
    )
    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == owner.id)
    )
    owner_has_avatar = avatar_result.scalar_one_or_none() is not None
    return _to_read(board, starred, owner.display_name, owner_initials, owner_has_avatar)


async def _copy_template_into(
    template: Board, board: Board, user_id: uuid.UUID, db: AsyncSession
) -> None:
    """Copy a template's live lists, their order and user_id's own colors into board.

    Archived and deleted lists stay behind. Colors are per user, so only the
    colors user_id has set on the template (board and lists) are carried
    over, and only as user_id's colors on the new board: anyone the board is
    later shared with starts from the default colors, whatever they had set
    on the template. The copy is a one-off — later edits to the template
    don't reach boards already made from it.
    """
    lists_result = await db.execute(
        select(BoardList)
        .where(
            BoardList.board_id == template.id,
            BoardList.is_deleted.is_(False),
            BoardList.is_archived.is_(False),
        )
        .order_by(BoardList.created_at.asc())
    )
    source_lists = list(lists_result.scalars().all())

    # Same rule the board page uses: lists in the stored order first, then
    # any the order row doesn't mention, oldest first.
    order_result = await db.execute(
        select(UIBoardListOrder.list_ids).where(UIBoardListOrder.board_id == template.id)
    )
    position = {lid: i for i, lid in enumerate(order_result.scalar_one_or_none() or [])}
    source_lists.sort(key=lambda lst: position.get(lst.id, len(position)))

    new_ids: dict[uuid.UUID, uuid.UUID] = {}
    for source in source_lists:
        new_list = BoardList(board_id=board.id, name=source.name)
        db.add(new_list)
        await db.flush()
        new_ids[source.id] = new_list.id

    if new_ids:
        db.add(UIBoardListOrder(board_id=board.id, list_ids=list(new_ids.values())))

        list_colors = await db.execute(
            select(UIListColor.list_id, UIListColor.color).where(
                UIListColor.user_id == user_id,
                UIListColor.list_id.in_(new_ids.keys()),
            )
        )
        db.add_all(
            UIListColor(user_id=user_id, list_id=new_ids[list_id], color=color)
            for list_id, color in list_colors.all()
        )

    board_color = await db.execute(
        select(UIBoardColor.color).where(
            UIBoardColor.user_id == user_id,
            UIBoardColor.board_id == template.id,
        )
    )
    color = board_color.scalar_one_or_none()
    if color is not None:
        db.add(UIBoardColor(user_id=user_id, board_id=board.id, color=color))


@router.get("", response_model=BoardsResponse)
async def list_boards(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardsResponse:
    """Return all live (not archived, not deleted) boards and templates for the current user."""
    starred = await _starred_ids(current_user.id, db)

    owned_result = await db.execute(
        select(Board)
        .where(
            Board.owner_id == current_user.id,
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
            Board.is_template.is_(False),
        )
        .order_by(Board.created_at.desc())
    )
    owned = owned_result.scalars().all()

    shared_result = await db.execute(
        select(Board)
        .join(BoardShare, BoardShare.board_id == Board.id)
        .where(
            BoardShare.user_id == current_user.id,
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
            Board.is_template.is_(False),
        )
        .order_by(Board.created_at.desc())
    )
    shared = shared_result.scalars().all()

    # Owned and shared templates share one section, so one query covers both.
    templates_result = await db.execute(
        select(Board)
        .where(
            or_(
                Board.owner_id == current_user.id,
                Board.id.in_(
                    select(BoardShare.board_id).where(BoardShare.user_id == current_user.id)
                ),
            ),
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
            Board.is_template.is_(True),
        )
        .order_by(Board.created_at.desc())
    )
    templates = templates_result.scalars().all()

    owner_ids = {b.owner_id for b in list(owned) + list(shared) + list(templates)}
    users_by_id: dict[uuid.UUID, User] = {}
    prefs_by_id: dict[uuid.UUID, UserPreferences] = {}
    avatar_ids: set[uuid.UUID] = set()

    if owner_ids:
        u_result = await db.execute(select(User).where(User.id.in_(owner_ids)))
        users_by_id = {u.id: u for u in u_result.scalars()}
        p_result = await db.execute(
            select(UserPreferences).where(UserPreferences.user_id.in_(owner_ids))
        )
        prefs_by_id = {p.user_id: p for p in p_result.scalars()}
        a_result = await db.execute(
            select(UserAvatar.user_id).where(UserAvatar.user_id.in_(owner_ids))
        )
        avatar_ids = set(a_result.scalars().all())

    def board_to_read(board: Board) -> BoardRead:
        owner = users_by_id.get(board.owner_id)
        pref = prefs_by_id.get(board.owner_id)
        dn = owner.display_name if owner else ""
        initials = pref.initials if (pref and pref.initials) else _compute_initials(dn)
        return _to_read(board, starred, dn, initials, board.owner_id in avatar_ids)

    return BoardsResponse(
        owned=[board_to_read(b) for b in owned],
        shared=[board_to_read(b) for b in shared],
        templates=[board_to_read(b) for b in templates],
    )


@router.post("", response_model=BoardRead, status_code=status.HTTP_201_CREATED)
async def create_board(
    body: BoardCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardRead:
    """Create a new board (or template) and append it to the owner's board order.

    With template_id, the template's lists are copied into the new board —
    see :func:`_copy_template_into`.
    """
    template: Board | None = None
    if body.template_id is not None:
        template = await _check_board_access(body.template_id, current_user, db)
        if not template.is_template:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Board is not a template")
        if template.is_archived:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template is archived")

    board = Board(owner_id=current_user.id, name=body.name, is_template=body.is_template)
    db.add(board)
    await db.flush()

    if template is not None:
        await _copy_template_into(template, board, current_user.id, db)

    if body.is_template:
        await _append_to_order(current_user.id, "template_ids", board.id, db)
    else:
        if body.is_starred:
            db.add(UserBoardStar(user_id=current_user.id, board_id=board.id))
            await _append_to_order(current_user.id, "starred_ids", board.id, db)
        await _append_to_order(current_user.id, "owned_ids", board.id, db)

    await db.commit()
    await db.refresh(board)

    return await _read_as_owner(board, current_user, {board.id} if body.is_starred else set(), db)


@router.get("/archived", response_model=list[BoardRead])
async def list_archived_boards(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BoardRead]:
    """Return owned archived (but not deleted) boards and templates for the current user."""
    result = await db.execute(
        select(Board)
        .where(
            Board.owner_id == current_user.id,
            Board.is_archived.is_(True),
            Board.is_deleted.is_(False),
        )
        .order_by(Board.created_at.desc())
    )
    boards = result.scalars().all()
    if not boards:
        return []

    pref_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == current_user.id)
    )
    pref = pref_result.scalar_one_or_none()
    owner_initials = (
        pref.initials if (pref and pref.initials)
        else _compute_initials(current_user.display_name)
    )
    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == current_user.id)
    )
    owner_has_avatar = avatar_result.scalar_one_or_none() is not None
    starred = await _starred_ids(current_user.id, db)

    return [
        _to_read(b, starred, current_user.display_name, owner_initials, owner_has_avatar)
        for b in boards
    ]


@router.get("/overdue", response_model=list[OverdueBoardRead])
async def list_overdue_boards(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[OverdueBoardRead]:
    """Return every overdue card the user can see, grouped by board and list.

    A card counts as overdue when its due date has passed and it has no end
    date — the same "still open, past due" rule the reminder e-mails use (see
    :mod:`src.core.notifications`). Archived and deleted boards, lists and
    cards are all left out, as are templates and boards and lists with
    nothing overdue.

    Boards come back ordered by how many overdue cards they hold (most first),
    lists in the board's own list order, and cards oldest due date first. The
    viewer's personal board/list/card colors ride along so the page can paint
    the columns exactly as the board itself does.
    """
    result = await db.execute(
        select(Card, BoardList)
        .options(*_card_load_options())
        .join(BoardList, Card.list_id == BoardList.id)
        .join(Board, BoardList.board_id == Board.id)
        .outerjoin(
            BoardShare,
            (BoardShare.board_id == Board.id) & (BoardShare.user_id == current_user.id),
        )
        .where(
            or_(Board.owner_id == current_user.id, BoardShare.user_id.isnot(None)),
            Board.is_deleted.is_(False),
            Board.is_archived.is_(False),
            Board.is_template.is_(False),
            BoardList.is_deleted.is_(False),
            BoardList.is_archived.is_(False),
            Card.is_deleted.is_(False),
            Card.is_archived.is_(False),
            Card.due_at.isnot(None),
            Card.due_at < datetime.now(timezone.utc),
            Card.end_at.is_(None),
        )
        .order_by(Card.due_at)
    )
    rows = result.all()
    if not rows:
        return []

    # board id -> list id -> its overdue cards, both dicts kept in insertion
    # order: the rows arrive due-date ascending, so each list's cards already
    # come out oldest first.
    by_board: dict[uuid.UUID, dict[uuid.UUID, list[Card]]] = {}
    lists_by_id: dict[uuid.UUID, BoardList] = {}
    for card, board_list in rows:
        lists_by_id[board_list.id] = board_list
        by_board.setdefault(board_list.board_id, {}).setdefault(board_list.id, []).append(card)

    board_ids = list(by_board)
    board_names_result = await db.execute(
        select(Board.id, Board.name).where(Board.id.in_(board_ids))
    )
    board_names = {row.id: row.name for row in board_names_result.all()}

    people_ids: set[uuid.UUID] = set()
    for card, _ in rows:
        people_ids |= _card_people_ids(card)
    people_by_id = await _people_by_id(people_ids, db)

    # The viewer's own colors, in three batched queries rather than one per
    # entity — mirrors the board page's /boards/{id}/colors.
    board_colors_result = await db.execute(
        select(UIBoardColor.board_id, UIBoardColor.color).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id.in_(board_ids),
        )
    )
    board_colors = {row.board_id: row.color for row in board_colors_result.all()}

    list_colors_result = await db.execute(
        select(UIListColor.list_id, UIListColor.color).where(
            UIListColor.user_id == current_user.id,
            UIListColor.list_id.in_(list(lists_by_id)),
        )
    )
    list_colors = {row.list_id: row.color for row in list_colors_result.all()}

    card_colors_result = await db.execute(
        select(UICardColor.card_id, UICardColor.color).where(
            UICardColor.user_id == current_user.id,
            UICardColor.card_id.in_([card.id for card, _ in rows]),
        )
    )
    card_colors = {row.card_id: row.color for row in card_colors_result.all()}

    order_result = await db.execute(
        select(UIBoardListOrder.board_id, UIBoardListOrder.list_ids).where(
            UIBoardListOrder.board_id.in_(board_ids)
        )
    )
    list_order = {row.board_id: row.list_ids for row in order_result.all()}

    boards: list[OverdueBoardRead] = []
    for board_id, cards_by_list in by_board.items():
        # Follow the board's own list order; a list missing from it (older
        # board, or a row never written) falls in after the ordered ones.
        ordered_ids = [lid for lid in list_order.get(board_id, []) if lid in cards_by_list]
        ordered_ids += [lid for lid in cards_by_list if lid not in ordered_ids]

        boards.append(
            OverdueBoardRead(
                board_id=board_id,
                board_name=board_names.get(board_id, ""),
                overdue_count=sum(len(c) for c in cards_by_list.values()),
                color=board_colors.get(board_id),
                card_colors={
                    str(card.id): card_colors[card.id]
                    for cards in cards_by_list.values()
                    for card in cards
                    if card.id in card_colors
                },
                lists=[
                    OverdueListRead(
                        list_id=list_id,
                        list_name=lists_by_id[list_id].name,
                        color=list_colors.get(list_id),
                        cards=[_card_to_read(c, people_by_id) for c in cards_by_list[list_id]],
                    )
                    for list_id in ordered_ids
                ],
            )
        )

    boards.sort(key=lambda b: (-b.overdue_count, b.board_name))
    return boards


# NOTE: /order and /overdue must be defined before /{board_id} so FastAPI
# matches the literal segment before trying to parse it as a UUID.

@router.get("/order", response_model=BoardOrderRead)
async def get_board_order(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardOrderRead:
    """Return the stored board display order for the current user."""
    order = await _get_order(current_user.id, db)
    if order is None:
        return BoardOrderRead(starred_ids=[], owned_ids=[], shared_ids=[], template_ids=[])
    return BoardOrderRead(
        starred_ids=order.starred_ids,
        owned_ids=order.owned_ids,
        shared_ids=order.shared_ids,
        template_ids=order.template_ids,
    )


@router.put("/order", response_model=BoardOrderRead)
async def update_board_order(
    body: BoardOrderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> BoardOrderRead:
    """Replace one or more section orderings. Omit a field to leave it unchanged."""
    order = await _get_order(current_user.id, db)
    current_starred = order.starred_ids if order else []
    current_owned = order.owned_ids if order else []
    current_shared = order.shared_ids if order else []
    current_templates = order.template_ids if order else []

    new_starred = body.starred_ids if body.starred_ids is not None else current_starred
    new_owned = body.owned_ids if body.owned_ids is not None else current_owned
    new_shared = body.shared_ids if body.shared_ids is not None else current_shared
    new_templates = body.template_ids if body.template_ids is not None else current_templates

    await db.execute(
        pg_insert(UIBoardOrder).values(
            user_id=current_user.id,
            starred_ids=new_starred,
            owned_ids=new_owned,
            shared_ids=new_shared,
            template_ids=new_templates,
        ).on_conflict_do_update(
            index_elements=["user_id"],
            set_={
                "starred_ids": new_starred,
                "owned_ids": new_owned,
                "shared_ids": new_shared,
                "template_ids": new_templates,
                "updated_at": func.now(),
            },
        )
    )
    await db.commit()

    # Board order is per-user (not shared), so only the owner's other
    # sessions need to know — never the users a board is shared with.
    await manager.notify(current_user.id, board_notification("board_reordered", None, client_id))

    return BoardOrderRead(
        starred_ids=new_starred,
        owned_ids=new_owned,
        shared_ids=new_shared,
        template_ids=new_templates,
    )


@router.get("/{board_id}", response_model=BoardRead)
async def get_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardRead:
    """Fetch a single board. User must be the owner or a shared member."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")

    if board.owner_id != current_user.id:
        share_result = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == current_user.id,
            )
        )
        if share_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    owner_name = current_user.display_name
    pref_owner_id = current_user.id
    if board.owner_id != current_user.id:
        owner_result = await db.execute(select(User).where(User.id == board.owner_id))
        owner = owner_result.scalar_one_or_none()
        owner_name = owner.display_name if owner else ""
        pref_owner_id = board.owner_id

    pref_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == pref_owner_id)
    )
    pref = pref_result.scalar_one_or_none()
    owner_initials = (
        pref.initials if (pref and pref.initials)
        else _compute_initials(owner_name)
    )
    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == board.owner_id)
    )
    owner_has_avatar = avatar_result.scalar_one_or_none() is not None
    starred = await _starred_ids(current_user.id, db)

    return _to_read(board, starred, owner_name, owner_initials, owner_has_avatar)


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Soft-delete a board and remove it from the owner's order."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this board")

    board.is_deleted = True
    await _remove_from_order(current_user.id, board_id, db)
    await db.commit()

    # Deletion only concerns the owner: a single account can have several
    # open sessions (e.g. laptop + a meeting room computer), and all of them
    # need to drop the board even though only one of them triggered this.
    await manager.notify(current_user.id, board_notification("board_deleted", board_id, client_id))


async def _check_board_access(
    board_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> Board:
    """Return the board if the user is the owner or a shared member, else raise."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != current_user.id:
        share = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == current_user.id,
            )
        )
        if share.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return board


@router.get("/{board_id}/members", response_model=list[PersonRead])
async def list_board_members(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PersonRead]:
    """Return the users allowed to work with the board: its owner plus everyone it's shared with."""
    board = await _check_board_access(board_id, current_user, db)

    share_result = await db.execute(
        select(BoardShare.user_id).where(BoardShare.board_id == board_id)
    )
    member_ids = {board.owner_id, *share_result.scalars().all()}

    users_result = await db.execute(select(User).where(User.id.in_(member_ids)))
    users = list(users_result.scalars().all())

    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id.in_(member_ids))
    )
    prefs_by_id = {p.user_id: p for p in prefs_result.scalars()}

    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id.in_(member_ids))
    )
    avatar_ids = set(avatar_result.scalars().all())

    people = [
        PersonRead(
            id=user.id,
            display_name=user.display_name,
            initials=(
                prefs_by_id[user.id].initials
                if user.id in prefs_by_id and prefs_by_id[user.id].initials
                else _compute_initials(user.display_name)
            ),
            has_avatar=user.id in avatar_ids,
        )
        for user in users
    ]
    people.sort(key=lambda p: p.display_name.lower())
    return people


@router.post("/{board_id}/shares", response_model=PersonRead, status_code=status.HTTP_201_CREATED)
async def create_board_share(
    board_id: uuid.UUID,
    body: BoardShareCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> PersonRead:
    """Share the board with another user. Only the board owner may do this."""
    board = await _check_board_access(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can share this board")

    if body.user_id == board.owner_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The owner already has access to this board",
        )

    target_result = await db.execute(select(User).where(User.id == body.user_id))
    target_user = target_result.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    existing_result = await db.execute(
        select(BoardShare).where(
            BoardShare.board_id == board_id,
            BoardShare.user_id == body.user_id,
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Board is already shared with this user")

    db.add(BoardShare(board_id=board_id, user_id=body.user_id))
    await db.commit()

    await manager.notify_many(
        {current_user.id, target_user.id},
        board_notification("board_shared", board_id, client_id),
    )

    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == target_user.id)
    )
    prefs = prefs_result.scalar_one_or_none()
    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == target_user.id)
    )
    has_avatar = avatar_result.scalar_one_or_none() is not None

    return PersonRead(
        id=target_user.id,
        display_name=target_user.display_name,
        initials=(
            prefs.initials if prefs and prefs.initials else _compute_initials(target_user.display_name)
        ),
        has_avatar=has_avatar,
    )


@router.delete("/{board_id}/shares/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board_share(
    board_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Revoke a user's shared access to the board. Only the board owner may do this."""
    board = await _check_board_access(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can modify sharing")

    result = await db.execute(
        select(BoardShare).where(
            BoardShare.board_id == board_id,
            BoardShare.user_id == user_id,
        )
    )
    share = result.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board is not shared with this user")

    await db.delete(share)
    await db.commit()

    await manager.notify_many(
        {current_user.id, user_id},
        board_notification("board_unshared", board_id, client_id),
    )


@router.patch("/{board_id}", response_model=BoardRead)
async def update_board(
    board_id: uuid.UUID,
    body: BoardUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> BoardRead:
    """Update a board's name or archived status. Only the owner can update a board."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.is_deleted.is_(False))
    )
    board = result.scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can update this board")

    if body.name is not None:
        board.name = body.name

    archive_event: str | None = None
    if body.is_archived is not None:
        was_archived = board.is_archived
        board.is_archived = body.is_archived

        if body.is_archived and not was_archived:
            archive_event = "board_archived"
            # Archiving: remove from all order arrays
            await _remove_from_order(current_user.id, board_id, db)
        elif not body.is_archived and was_archived:
            archive_event = "board_unarchived"
            # Restoring: append back to the section the board belongs in
            section = "template_ids" if board.is_template else "owned_ids"
            await _append_to_order(current_user.id, section, board_id, db)

    await db.commit()
    await db.refresh(board)

    if archive_event is not None:
        # Archiving/restoring also hides/reveals the board in shared members'
        # lists (list_boards filters on is_archived), so they need to know too.
        recipients = await board_recipients(board_id, current_user.id, db)
        await manager.notify_many(recipients, board_notification(archive_event, board_id, client_id))

    pref_result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == current_user.id)
    )
    pref = pref_result.scalar_one_or_none()
    owner_initials = (
        pref.initials if (pref and pref.initials)
        else _compute_initials(current_user.display_name)
    )
    avatar_result = await db.execute(
        select(UserAvatar.user_id).where(UserAvatar.user_id == current_user.id)
    )
    owner_has_avatar = avatar_result.scalar_one_or_none() is not None

    star_result = await db.execute(
        select(UserBoardStar.board_id).where(
            UserBoardStar.user_id == current_user.id,
            UserBoardStar.board_id == board.id,
        )
    )
    starred: set[uuid.UUID] = {board.id} if star_result.scalar_one_or_none() else set()

    return _to_read(board, starred, current_user.display_name, owner_initials, owner_has_avatar)


@router.post("/{board_id}/duplicate", response_model=BoardRead, status_code=status.HTTP_201_CREATED)
async def duplicate_template(
    board_id: uuid.UUID,
    body: TemplateDuplicate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardRead:
    """Copy a template into a new template owned by the current user.

    Open to the owner and to anyone the template is shared with. The copy gets
    the template's live lists, their order and the caller's own colors (see
    :func:`_copy_template_into`), but none of its shares: it starts private to
    whoever duplicated it.
    """
    template = await _check_board_access(board_id, current_user, db)
    if not template.is_template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only templates can be duplicated")
    if template.is_archived:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template is archived")

    duplicate = Board(owner_id=current_user.id, name=body.name, is_template=True)
    db.add(duplicate)
    await db.flush()
    await _copy_template_into(template, duplicate, current_user.id, db)
    await _append_to_order(current_user.id, "template_ids", duplicate.id, db)

    await db.commit()
    await db.refresh(duplicate)

    return await _read_as_owner(duplicate, current_user, set(), db)


@router.post("/{board_id}/star", status_code=status.HTTP_204_NO_CONTENT)
async def star_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Star a board. Idempotent — starring an already-starred board is a no-op."""
    board = await _check_board_access(board_id, current_user, db)
    reject_if_template(board, "Templates cannot be starred")

    result = await db.execute(
        pg_insert(UserBoardStar)
        .values(user_id=current_user.id, board_id=board_id)
        .on_conflict_do_nothing()
    )

    if result.rowcount > 0:
        # Only update the order array when a new star was actually inserted.
        await _append_to_order(current_user.id, "starred_ids", board_id, db)

    await db.commit()


@router.delete("/{board_id}/star", status_code=status.HTTP_204_NO_CONTENT)
async def unstar_board(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a star from a board. Idempotent."""
    board = await _check_board_access(board_id, current_user, db)
    reject_if_template(board, "Templates cannot be starred")

    await db.execute(
        delete(UserBoardStar).where(
            UserBoardStar.user_id == current_user.id,
            UserBoardStar.board_id == board_id,
        )
    )

    await db.execute(
        update(UIBoardOrder)
        .where(UIBoardOrder.user_id == current_user.id)
        .values(
            starred_ids=func.array_remove(UIBoardOrder.starred_ids, board_id),
            updated_at=func.now(),
        )
    )

    await db.commit()


@router.get("/{board_id}/colors", response_model=BoardColorsRead)
async def get_board_colors(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BoardColorsRead:
    """Return every color the current user has personally set on this board
    (the board itself, its lists, and their cards) in one shot, so the
    frontend can render the whole board with its final colors from the
    first paint instead of one request per list/card.
    """
    await _check_board_access(board_id, current_user, db)

    board_color_result = await db.execute(
        select(UIBoardColor.color).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id == board_id,
        )
    )
    board_color = board_color_result.scalar_one_or_none()

    lists_result = await db.execute(
        select(UIListColor.list_id, UIListColor.color)
        .join(BoardList, BoardList.id == UIListColor.list_id)
        .where(BoardList.board_id == board_id, UIListColor.user_id == current_user.id)
    )
    list_colors = {str(list_id): color for list_id, color in lists_result.all()}

    cards_result = await db.execute(
        select(UICardColor.card_id, UICardColor.color)
        .join(Card, Card.id == UICardColor.card_id)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(BoardList.board_id == board_id, UICardColor.user_id == current_user.id)
    )
    card_colors = {str(card_id): color for card_id, color in cards_result.all()}

    return BoardColorsRead(board=board_color, lists=list_colors, cards=card_colors)


@router.get("/{board_id}/color", response_model=ColorRead)
async def get_board_color(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Return the current user's personal color choice for this board, if any."""
    await _check_board_access(board_id, current_user, db)
    result = await db.execute(
        select(UIBoardColor.color).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id == board_id,
        )
    )
    return ColorRead(color=result.scalar_one_or_none())


@router.put("/{board_id}/color", response_model=ColorRead)
async def set_board_color(
    board_id: uuid.UUID,
    body: ColorUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ColorRead:
    """Set the current user's personal color for this board.

    Purely a per-user display preference — the owner and every shared user
    each have their own, so this never affects what anyone else sees.
    """
    await _check_board_access(board_id, current_user, db)
    await db.execute(
        pg_insert(UIBoardColor)
        .values(user_id=current_user.id, board_id=board_id, color=body.color)
        .on_conflict_do_update(
            index_elements=["user_id", "board_id"],
            set_={"color": body.color, "updated_at": func.now()},
        )
    )
    await db.commit()
    return ColorRead(color=body.color)


@router.delete("/{board_id}/color", status_code=status.HTTP_204_NO_CONTENT)
async def clear_board_color(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Reset the current user's color for this board back to the default. Idempotent."""
    await _check_board_access(board_id, current_user, db)
    await db.execute(
        delete(UIBoardColor).where(
            UIBoardColor.user_id == current_user.id,
            UIBoardColor.board_id == board_id,
        )
    )
    await db.commit()
