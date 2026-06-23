#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from fastapi import APIRouter

from src.api.v1 import users
from src.api.v1.auth import google, local

router = APIRouter(prefix="/api/v1")

router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(local.router, prefix="/auth/local", tags=["auth:local"])
router.include_router(google.router, prefix="/auth/google", tags=["auth:google"])
