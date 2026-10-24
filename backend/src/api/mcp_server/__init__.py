#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The MCP server at ``/mcp``: tools an assistant such as Claude calls to read
(and, with a writable connection, change) the boards a user chose for it.

:mod:`~src.api.mcp_server.server` builds it, :mod:`~src.api.mcp_server.context`
holds what every tool shares (the connection's grant, which boards it may
reach, turning errors into tool errors), and
:mod:`~src.api.mcp_server.read_tools` and
:mod:`~src.api.mcp_server.write_tools` the tools.
"""
