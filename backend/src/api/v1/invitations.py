#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Board invitations: sharing a board with an e-mail address that has no account yet.

``router`` is nested under a board and is for its owner only. ``public_router``
serves the sign-up page, which has no logged-in user, the details of the
invitation link it was opened from.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_client_id, get_current_user, get_db, reject_if_template
from src.api.v1.boards import _check_board_access, _person_read
from src.core.email import email_enabled, send_board_invitation_email
from src.core.ws_manager import manager
from src.core.ws_notify import board_notification
from src.model.board import Board
from src.model.board_invitation import INVITATION_TTL, BoardInvitation
from src.model.board_share import BoardShare
from src.model.user import User
from src.schemas.invitation import BoardInvitationCreate, BoardInvitationRead, InvitationPreview

logger = logging.getLogger(__name__)

router = APIRouter()
public_router = APIRouter()


async def _owned_board(board_id: uuid.UUID, current_user: User, db: AsyncSession) -> Board:
    """Return the board if the current user owns it; members get 403 like the share routes."""
    board = await _check_board_access(board_id, current_user, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can modify sharing")
    return board


@router.get("", response_model=list[BoardInvitationRead])
async def list_board_invitations(
    board_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BoardInvitation]:
    """List the board's pending invitations, oldest first. Expired ones are left out."""
    await _owned_board(board_id, current_user, db)
    result = await db.execute(
        select(BoardInvitation)
        .where(
            BoardInvitation.board_id == board_id,
            BoardInvitation.expires_at > datetime.now(timezone.utc),
        )
        .order_by(BoardInvitation.created_at.asc())
    )
    return list(result.scalars().all())


@router.post("", response_model=BoardInvitationRead, status_code=status.HTTP_201_CREATED)
async def create_board_invitation(
    board_id: uuid.UUID,
    body: BoardInvitationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> BoardInvitation:
    """Invite an e-mail address with no account to the board, and e-mail them a sign-up link.

    If the address already belongs to an account the invitation isn't made:
    the 409 reply's detail is ``{"code": "user_exists", "person": ...,
    "already_shared": ...}`` so the dialog can offer to share with that user
    directly instead. That check runs before the SMTP one, so it works even
    with e-mail switched off.
    """
    board = await _owned_board(board_id, current_user, db)
    reject_if_template(board, "Templates can't be shared by invitation")

    user_result = await db.execute(select(User).where(func.lower(User.email) == body.email))
    existing_user = user_result.scalar_one_or_none()
    if existing_user is not None:
        if existing_user.id == board.owner_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The owner already has access to this board",
            )
        share_result = await db.execute(
            select(BoardShare.board_id).where(
                BoardShare.board_id == board_id,
                BoardShare.user_id == existing_user.id,
            )
        )
        person = await _person_read(existing_user, db)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "user_exists",
                "person": person.model_dump(mode="json"),
                "already_shared": share_result.scalar_one_or_none() is not None,
            },
        )

    now = datetime.now(timezone.utc)
    pending_result = await db.execute(
        select(BoardInvitation).where(
            BoardInvitation.board_id == board_id,
            BoardInvitation.email == body.email,
        )
    )
    pending = pending_result.scalar_one_or_none()
    if pending is not None:
        if pending.expires_at > now:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "already_invited"},
            )
        # Expired but not cleaned up yet: it doesn't count, so replace it.
        await db.delete(pending)
        await db.flush()

    if not email_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E-mail sending is not configured",
        )

    invitation = BoardInvitation(
        board_id=board_id,
        email=body.email,
        invited_by_id=current_user.id,
        language=body.language,
    )
    db.add(invitation)
    await db.flush()

    # Sent before the commit so a failed e-mail leaves no invitation behind
    # that the invitee could never have received.
    try:
        await send_board_invitation_email(
            email=invitation.email,
            inviter_name=current_user.display_name,
            board_name=board.name,
            token=invitation.token,
            expires_in_days=INVITATION_TTL.days,
            language=invitation.language,
        )
    except Exception:
        logger.exception("Failed to send board invitation e-mail")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The invitation e-mail could not be sent",
        )

    await db.commit()
    await db.refresh(invitation)

    await manager.notify(
        current_user.id,
        board_notification("board_invitations_changed", board_id, client_id),
    )
    return invitation


@router.delete("/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board_invitation(
    board_id: uuid.UUID,
    invitation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
) -> None:
    """Cancel a pending invitation. The link in the e-mail stops working."""
    await _owned_board(board_id, current_user, db)
    result = await db.execute(
        select(BoardInvitation).where(
            BoardInvitation.id == invitation_id,
            BoardInvitation.board_id == board_id,
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    await db.delete(invitation)
    await db.commit()

    await manager.notify(
        current_user.id,
        board_notification("board_invitations_changed", board_id, client_id),
    )


@public_router.get("/{token}", response_model=InvitationPreview)
async def get_invitation_preview(token: str, db: AsyncSession = Depends(get_db)) -> InvitationPreview:
    """Describe the invitation behind a sign-up link. No login: the invitee has no account yet.

    Unknown, cancelled and expired tokens, and invitations to a board that
    has since been deleted, all give the same 404.
    """
    result = await db.execute(
        select(BoardInvitation, Board.name, User.display_name)
        .join(Board, Board.id == BoardInvitation.board_id)
        .join(User, User.id == BoardInvitation.invited_by_id)
        .where(
            BoardInvitation.token == token,
            BoardInvitation.expires_at > datetime.now(timezone.utc),
            Board.is_deleted.is_(False),
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    invitation, board_name, inviter_name = row
    return InvitationPreview(email=invitation.email, board_name=board_name, inviter_name=inviter_name)
