#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from pydantic import BaseModel


class AppConfigRead(BaseModel):
    """Server features the frontend needs to know about before using them."""

    email_enabled: bool
