#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from fastapi import APIRouter

from src.api.v1 import boards, cards, checklists, labels, lists, users, ws
from src.api.v1.auth import google, local

router = APIRouter(prefix="/api/v1")

router.include_router(ws.router, tags=["ws"])
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(boards.router, prefix="/boards", tags=["boards"])
router.include_router(lists.router, prefix="/boards/{board_id}/lists", tags=["lists"])
router.include_router(labels.router, prefix="/boards/{board_id}/labels", tags=["labels"])
router.include_router(cards.router, prefix="/boards/{board_id}/lists/{list_id}/cards", tags=["cards"])
router.include_router(
    checklists.router,
    prefix="/boards/{board_id}/lists/{list_id}/cards/{card_id}/checklists",
    tags=["checklists"],
)
router.include_router(local.router, prefix="/auth/local", tags=["auth:local"])
router.include_router(google.router, prefix="/auth/google", tags=["auth:google"])
