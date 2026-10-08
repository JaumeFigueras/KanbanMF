#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from fastapi import APIRouter

from src.core.email import email_enabled
from src.schemas.config import AppConfigRead

router = APIRouter()


@router.get("", response_model=AppConfigRead)
async def get_config() -> AppConfigRead:
    """Optional server features, so the UI can disable what isn't available.

    Public: nothing here is sensitive, and the sign-up page may need it too.
    """
    return AppConfigRead(email_enabled=email_enabled())
