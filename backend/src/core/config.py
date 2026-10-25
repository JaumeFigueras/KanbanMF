#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Application settings, read from the environment and ``backend/.env``.

Environment variables take precedence over the file. ``DATABASE_URL``,
``SECRET_KEY`` and ``SMTP_PORT`` have no default, so the backend refuses to
start without them. It also refuses a ``SECRET_KEY`` that can't be a real
secret: shorter than 32 characters, or a value copied from an example.
"""

from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py -> src/core/ -> src/ -> backend/ -> backend/.env (3 parents, not
# 4 — this used to point one level too high, at the repo root instead of
# backend/, silently finding no .env there and leaving every setting to its
# default/missing).
_ENV_FILE = Path(__file__).parent.parent.parent / ".env"

# HS256 wants a key of at least 32 bytes (RFC 7518, section 3.2);
# ``openssl rand -hex 32`` gives 64 characters.
SECRET_KEY_MIN_LENGTH = 32
# Values from examples and guides, which anyone could sign tokens with.
_EXAMPLE_SECRET_KEYS = {"change-me-in-production", "changeme", "secret", "your-secret-key"}


class Settings(BaseSettings):
    """Every setting, one attribute per environment variable of the same name
    (case-insensitive). Google OAuth and SMTP are optional: leave them blank to
    turn those features off."""

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        # A refused value isn't repeated in the error: it may be a secret
        # (a too-short SECRET_KEY, a password), and errors end up in logs.
        hide_input_in_errors=True,
    )

    # Application
    app_name: str = "KanbanMF"
    frontend_url: str = "http://localhost:5173"

    # Database (async psycopg3 driver)
    database_url: str

    # JWT
    # Signs every access token: whoever knows it can sign in as anyone.
    secret_key: str
    # HMAC only: tokens are signed and checked with the same secret, and
    # nothing here may switch signing off ("none").
    algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    access_token_expire_minutes: int = 15

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"
    google_auth_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_token_url: str = "https://oauth2.googleapis.com/token"
    google_userinfo_url: str = "https://openidconnect.googleapis.com/v1/userinfo"

    # MCP server OAuth. Hosts allowed to serve a Client ID Metadata Document
    # (a client whose client_id is an HTTPS URL, as Claude Code's is), comma
    # separated. The authorization server fetches that URL, so only trusted
    # hosts are accepted; clients that register instead (Dynamic Client
    # Registration, as Claude's web and desktop apps do) need no entry here.
    oauth_cimd_allowed_hosts: str = "claude.ai,claude.com"

    # SMTP / Email
    smtp_host: str = ""
    smtp_port: int
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = ""
    # Overrides both smtp_from_name/smtp_from_email as the outgoing "From"
    # header, e.g. "Kanban Reminder system <kanban@example.com>" — useful
    # when the SMTP account you authenticate as isn't the address you want
    # recipients to see (a mismatch there is a common cause of messages
    # getting flagged as spam). Leave blank to keep using
    # smtp_from_name/smtp_from_email as-is — see src/core/email.py.
    email_sender: str = ""

    @field_validator("secret_key")
    @classmethod
    def secret_key_is_secret(cls, v: str) -> str:
        """Refuse a key anyone could know or guess. It used to be accepted,
        so a server started with the example's value issued tokens that
        anybody could forge."""
        if v.strip().lower() in _EXAMPLE_SECRET_KEYS or len(v) < SECRET_KEY_MIN_LENGTH:
            raise ValueError(
                f"SECRET_KEY must be a real secret of at least {SECRET_KEY_MIN_LENGTH} characters, "
                "not an example value. Generate one with: openssl rand -hex 32"
            )
        return v


settings = Settings()
