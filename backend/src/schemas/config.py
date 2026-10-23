#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Response body for the public server configuration."""

from pydantic import BaseModel


class AppConfigRead(BaseModel):
    """Server features the frontend needs to know about before using them."""

    email_enabled: bool
