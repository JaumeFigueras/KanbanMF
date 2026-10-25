#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for src.core.config: the settings refuse a SECRET_KEY that can't be
a real secret, and a signing algorithm other than HMAC."""

import secrets

import pytest
from pydantic import ValidationError

from src.core.config import SECRET_KEY_MIN_LENGTH, Settings


def _settings(**overrides) -> Settings:
    """Settings from these values only: no backend/.env, and the environment
    variables the test suite sets are overridden."""
    values = {"database_url": "postgresql+psycopg://u:p@localhost/db", "smtp_port": 25,
              "secret_key": secrets.token_hex(32)}
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize("key", [
    "change-me-in-production",       # the old .env.example
    "Change-Me-In-Production ",      # the same, give or take case and spaces
    "",                              # the new .env.example, left blank
    "x" * (SECRET_KEY_MIN_LENGTH - 1),
])
def test_config_01(key: str) -> None:
    """
    Verify an empty, short or example SECRET_KEY stops the settings from
    loading, with a message that says how to make a real one and doesn't
    repeat the key (errors end up in logs).

    Parameters
    ----------
    key : str
        The SECRET_KEY tried.

    Raises
    ------
    AssertionError
        If the key is accepted, or the message doesn't help or shows it.
    """
    with pytest.raises(ValidationError) as error:
        _settings(secret_key=key)
    assert "openssl rand -hex 32" in str(error.value)
    assert not key.strip() or key.strip() not in str(error.value)


def test_config_02() -> None:
    """
    Verify a generated key (openssl rand -hex 32: 64 characters) and one of
    exactly the minimum length are accepted.

    Raises
    ------
    AssertionError
        If a real key is refused.
    """
    key = secrets.token_hex(32)
    assert _settings(secret_key=key).secret_key == key
    assert _settings(secret_key="k" * SECRET_KEY_MIN_LENGTH).secret_key == "k" * SECRET_KEY_MIN_LENGTH


@pytest.mark.parametrize("algorithm", ["none", "RS256", "ES256"])
def test_config_03(algorithm: str) -> None:
    """
    Verify ALGORITHM only takes the HMAC algorithms: never "none", and not
    the public-key ones, which a shared secret can't sign.

    Parameters
    ----------
    algorithm : str
        The ALGORITHM tried.

    Raises
    ------
    AssertionError
        If the algorithm is accepted.
    """
    with pytest.raises(ValidationError):
        _settings(algorithm=algorithm)
    assert _settings(algorithm="HS512").algorithm == "HS512"
