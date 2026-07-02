#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the Pydantic schemas in src/schemas/user.py.

These are pure schema/validation tests: no database, no HTTP layer, no
fixtures beyond plain Python objects. That mirrors how test/model/test_user.py
tests the ORM layer in isolation — this file does the same for the request/
response contracts (UserRead, UserUpdate, ChangePasswordRequest,
UserPreferencesUpdate), independent of any endpoint that happens to use them.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from src.model.user_preferences import DateFormat
from src.schemas.user import (
    ChangePasswordRequest,
    UserPreferencesUpdate,
    UserRead,
    UserUpdate,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_read_kwargs(**overrides) -> dict:
    """Return the minimal set of required UserRead kwargs, overridden by kwargs."""
    defaults = dict(
        id=uuid.uuid4(),
        email="user@example.com",
        display_name="Test User",
        is_active=True,
        is_verified=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return defaults


# ===========================================================================
# UserRead
# ===========================================================================

# ---------------------------------------------------------------------------
# 01 – Minimal construction uses the schema's documented defaults
# ---------------------------------------------------------------------------

def test_user_schema_01() -> None:
    """
    Verify UserRead applies its declared defaults when optional fields are
    omitted: language_locale/number_locale default to "en", date_format
    defaults to NUMERIC, initials defaults to None, auth_providers to [].

    This is the shape returned for a user who has no UserPreferences row yet
    and has never logged in with any provider (see _build_user_read in
    src/api/v1/users.py, which falls back to these same literal defaults).

    Raises
    ------
    AssertionError
        If any default value doesn't match the schema's declared default.
    """
    user = UserRead(**_user_read_kwargs())

    assert user.language_locale == "en"
    assert user.number_locale == "en"
    assert user.date_format == DateFormat.NUMERIC
    assert user.initials is None
    assert user.auth_providers == []


# ---------------------------------------------------------------------------
# 02 – Every optional field can be explicitly overridden
# ---------------------------------------------------------------------------

def test_user_schema_02() -> None:
    """
    Verify every field with a default can still be set explicitly, and that
    the value provided is preserved rather than silently replaced by the
    default.

    Raises
    ------
    AssertionError
        If an explicitly provided value is not preserved as given.
    """
    user = UserRead(**_user_read_kwargs(
        language_locale="ca_ES",
        number_locale="ca_ES",
        date_format="textual",
        initials="AB",
        auth_providers=["local", "google"],
    ))

    assert user.language_locale == "ca_ES"
    assert user.number_locale == "ca_ES"
    assert user.date_format == DateFormat.TEXTUAL
    assert user.initials == "AB"
    assert user.auth_providers == ["local", "google"]


# ---------------------------------------------------------------------------
# 03 – A required field with no default cannot be omitted
# ---------------------------------------------------------------------------

def test_user_schema_03() -> None:
    """
    Verify omitting a required field (email) raises a ValidationError,
    distinguishing "required" fields from the "optional, defaulted" ones
    covered above.

    Raises
    ------
    AssertionError
        If constructing without `email` does NOT raise.
    """
    kwargs = _user_read_kwargs()
    del kwargs["email"]

    with pytest.raises(ValidationError):
        UserRead(**kwargs)


# ---------------------------------------------------------------------------
# 04 – A value that can't be parsed into the declared type is rejected
# ---------------------------------------------------------------------------

def test_user_schema_04() -> None:
    """
    Verify a malformed UUID string for `id` raises a ValidationError, since
    `id` is typed as uuid.UUID and pydantic validates/coerces it.

    Raises
    ------
    AssertionError
        If constructing with a non-UUID string for `id` does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserRead(**_user_read_kwargs(id="not-a-uuid"))


# ---------------------------------------------------------------------------
# 05 – date_format is constrained to the DateFormat enum
# ---------------------------------------------------------------------------

def test_user_schema_05() -> None:
    """
    Verify a date_format value outside the DateFormat enum ("numeric" /
    "textual") raises a ValidationError rather than being stored as an
    arbitrary string.

    Raises
    ------
    AssertionError
        If constructing with an unknown date_format does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserRead(**_user_read_kwargs(date_format="bogus"))


# ---------------------------------------------------------------------------
# 06 – from_attributes lets UserRead be built directly from an ORM-like object
# ---------------------------------------------------------------------------

def test_user_schema_06() -> None:
    """
    Verify model_config = {"from_attributes": True} allows UserRead to be
    built via model_validate() from any object exposing the right attributes
    (e.g. a SQLAlchemy User row), not only from a dict of keyword arguments.
    This is the mechanism _build_user_read() and every other *Read schema in
    this codebase rely on to convert ORM rows into API responses.

    Raises
    ------
    AssertionError
        If model_validate() does not read attributes off the object, or
        reads the wrong ones.
    """
    fake_orm_row = SimpleNamespace(**_user_read_kwargs())

    user = UserRead.model_validate(fake_orm_row)

    assert user.id == fake_orm_row.id
    assert user.email == fake_orm_row.email
    assert user.display_name == fake_orm_row.display_name


# ---------------------------------------------------------------------------
# 07 – JSON-mode serialization produces wire-safe types
# ---------------------------------------------------------------------------

def test_user_schema_07() -> None:
    """
    Verify model_dump(mode="json") converts the UUID and datetime fields into
    plain strings — this is what FastAPI actually sends over the wire for a
    UserRead response, as opposed to model_dump()'s default Python-object mode.

    Raises
    ------
    AssertionError
        If the JSON-mode dump still contains non-JSON-native Python objects.
    """
    user = UserRead(**_user_read_kwargs())

    dumped = user.model_dump(mode="json")

    assert isinstance(dumped["id"], str)
    assert isinstance(dumped["created_at"], str)
    assert dumped["date_format"] == "numeric"


# ===========================================================================
# UserUpdate
# ===========================================================================

# ---------------------------------------------------------------------------
# 08 – Both fields are optional; an empty update is valid
# ---------------------------------------------------------------------------

def test_user_schema_08() -> None:
    """
    Verify UserUpdate can be constructed with no fields at all: both
    display_name and email default to None, meaning "leave this unchanged"
    to the PUT /me endpoint that consumes this schema.

    Raises
    ------
    AssertionError
        If the defaults are not both None.
    """
    update = UserUpdate()

    assert update.display_name is None
    assert update.email is None


# ---------------------------------------------------------------------------
# 09 – A valid display_name passes through unchanged
# ---------------------------------------------------------------------------

def test_user_schema_09() -> None:
    """
    Verify a non-blank display_name is accepted and stored as given.

    Raises
    ------
    AssertionError
        If the value is altered or rejected.
    """
    update = UserUpdate(display_name="New Name")

    assert update.display_name == "New Name"


# ---------------------------------------------------------------------------
# 10 – A blank (whitespace-only) display_name is rejected
# ---------------------------------------------------------------------------

def test_user_schema_10() -> None:
    """
    Verify a whitespace-only display_name raises a ValidationError, via the
    display_name_not_empty field_validator.

    Raises
    ------
    AssertionError
        If constructing with "   " does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserUpdate(display_name="   ")


# ---------------------------------------------------------------------------
# 11 – display_name=None bypasses the blank-string check entirely
# ---------------------------------------------------------------------------

def test_user_schema_11() -> None:
    """
    Verify display_name=None does not trigger the blank-string validator.
    None carries the meaning "don't change this field" (see update_me() in
    src/api/v1/users.py, which only assigns when body.display_name is not
    None) — it must never be confused with "set it to an empty string",
    which the validator above correctly rejects.

    Raises
    ------
    AssertionError
        If constructing with display_name=None raises.
    """
    update = UserUpdate(display_name=None)

    assert update.display_name is None


# ---------------------------------------------------------------------------
# 12 – A well-formed email is accepted
# ---------------------------------------------------------------------------

def test_user_schema_12() -> None:
    """
    Verify a valid email address passes pydantic's built-in EmailStr check.

    Raises
    ------
    AssertionError
        If a valid email is rejected.
    """
    update = UserUpdate(email="someone@example.com")

    assert update.email == "someone@example.com"


# ---------------------------------------------------------------------------
# 13 – A malformed email is rejected
# ---------------------------------------------------------------------------

def test_user_schema_13() -> None:
    """
    Verify a malformed email address raises a ValidationError. This exercises
    pydantic's own EmailStr validation, not custom code in this schema — but
    it's part of UserUpdate's observable contract, so it's covered here.

    Raises
    ------
    AssertionError
        If constructing with "not-an-email" does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserUpdate(email="not-an-email")


# ===========================================================================
# ChangePasswordRequest
# ===========================================================================

# ---------------------------------------------------------------------------
# 14 – Both fields are required and accepted as plain strings
# ---------------------------------------------------------------------------

def test_user_schema_14() -> None:
    """
    Verify ChangePasswordRequest accepts old_password and new_password as
    opaque strings with no transformation.

    Raises
    ------
    AssertionError
        If the values are not stored unchanged.
    """
    body = ChangePasswordRequest(old_password="old-pw", new_password="new-pw")

    assert body.old_password == "old-pw"
    assert body.new_password == "new-pw"


# ---------------------------------------------------------------------------
# 15 – old_password has no default and is required
# ---------------------------------------------------------------------------

def test_user_schema_15() -> None:
    """
    Verify omitting old_password raises a ValidationError.

    Raises
    ------
    AssertionError
        If omitting old_password does NOT raise.
    """
    with pytest.raises(ValidationError):
        ChangePasswordRequest(new_password="new-pw")


# ---------------------------------------------------------------------------
# 16 – new_password has no default and is required
# ---------------------------------------------------------------------------

def test_user_schema_16() -> None:
    """
    Verify omitting new_password raises a ValidationError.

    Raises
    ------
    AssertionError
        If omitting new_password does NOT raise.
    """
    with pytest.raises(ValidationError):
        ChangePasswordRequest(old_password="old-pw")


# ---------------------------------------------------------------------------
# 17 – No strength/length rule exists at the schema level (documents intent)
# ---------------------------------------------------------------------------

def test_user_schema_17() -> None:
    """
    Verify an empty-string new_password is currently accepted by the schema.

    This is not an endorsed behavior so much as a record of the current,
    intentional contract: ChangePasswordRequest has no length/complexity
    validator today, so any password-strength rule would need to live
    elsewhere (there is none right now). If that changes, this test should
    start failing and be updated deliberately, rather than the gap going
    unnoticed.

    Raises
    ------
    AssertionError
        If an empty new_password is unexpectedly rejected.
    """
    body = ChangePasswordRequest(old_password="old-pw", new_password="")

    assert body.new_password == ""


# ===========================================================================
# UserPreferencesUpdate
# ===========================================================================

# ---------------------------------------------------------------------------
# 18 – All fields are optional; an empty update is valid
# ---------------------------------------------------------------------------

def test_user_schema_18() -> None:
    """
    Verify UserPreferencesUpdate can be constructed with no fields at all —
    every field defaults to None ("leave unchanged"), mirroring how
    update_my_preferences() in src/api/v1/users.py only assigns fields that
    are not None.

    Raises
    ------
    AssertionError
        If any default is not None.
    """
    update = UserPreferencesUpdate()

    assert update.initials is None
    assert update.language_locale is None
    assert update.number_locale is None
    assert update.date_format is None


# ---------------------------------------------------------------------------
# 19 – initials=None skips the initials_valid validator entirely
# ---------------------------------------------------------------------------

def test_user_schema_19() -> None:
    """
    Verify initials=None is accepted as-is and does not run the blank/length/
    alnum checks below (those only apply once a value is actually provided).

    Raises
    ------
    AssertionError
        If constructing with initials=None raises or alters the value.
    """
    update = UserPreferencesUpdate(initials=None)

    assert update.initials is None


# ---------------------------------------------------------------------------
# 20 – Lowercase initials are normalized to uppercase
# ---------------------------------------------------------------------------

def test_user_schema_20() -> None:
    """
    Verify initials are uppercased, so "ab" and "AB" are stored identically.

    Raises
    ------
    AssertionError
        If "ab" is not converted to "AB".
    """
    update = UserPreferencesUpdate(initials="ab")

    assert update.initials == "AB"


# ---------------------------------------------------------------------------
# 21 – Surrounding whitespace is stripped before any other check
# ---------------------------------------------------------------------------

def test_user_schema_21() -> None:
    """
    Verify leading/trailing whitespace around initials is stripped prior to
    the blank/length/alnum checks and the final uppercasing.

    Raises
    ------
    AssertionError
        If "  ab  " is not normalized to "AB".
    """
    update = UserPreferencesUpdate(initials="  ab  ")

    assert update.initials == "AB"


# ---------------------------------------------------------------------------
# 22 – Whitespace-only initials are rejected as blank
# ---------------------------------------------------------------------------

def test_user_schema_22() -> None:
    """
    Verify initials="   " raises a ValidationError ("initials cannot be
    blank"), since stripping it first leaves an empty string.

    Raises
    ------
    AssertionError
        If constructing with "   " does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserPreferencesUpdate(initials="   ")


# ---------------------------------------------------------------------------
# 23 – Exactly 3 characters is the accepted boundary
# ---------------------------------------------------------------------------

def test_user_schema_23() -> None:
    """
    Verify a 3-character initials value is accepted — the documented maximum
    length (see boards.initialsHint in the frontend: "Up to 3 letters").

    Raises
    ------
    AssertionError
        If "abc" is rejected, or altered beyond uppercasing.
    """
    update = UserPreferencesUpdate(initials="abc")

    assert update.initials == "ABC"


# ---------------------------------------------------------------------------
# 24 – More than 3 characters is rejected
# ---------------------------------------------------------------------------

def test_user_schema_24() -> None:
    """
    Verify a 4-character initials value raises a ValidationError ("initials
    must be 3 characters or fewer") — one character past the boundary above.

    Raises
    ------
    AssertionError
        If "abcd" does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserPreferencesUpdate(initials="abcd")


# ---------------------------------------------------------------------------
# 25 – Non-alphanumeric characters are rejected
# ---------------------------------------------------------------------------

def test_user_schema_25() -> None:
    """
    Verify initials containing a non-alphanumeric character (e.g. a hyphen)
    raise a ValidationError ("initials must contain only letters or digits").

    Raises
    ------
    AssertionError
        If "A-1" does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserPreferencesUpdate(initials="A-1")


# ---------------------------------------------------------------------------
# 26 – Digits are allowed alongside letters
# ---------------------------------------------------------------------------

def test_user_schema_26() -> None:
    """
    Verify initials made of letters and digits (e.g. "a1") are valid — the
    validator only requires str.isalnum(), not letters-only, so this is
    distinct from the rejection case above.

    Raises
    ------
    AssertionError
        If "a1" is rejected.
    """
    update = UserPreferencesUpdate(initials="a1")

    assert update.initials == "A1"


# ---------------------------------------------------------------------------
# 27 – date_format accepts a valid enum value
# ---------------------------------------------------------------------------

def test_user_schema_27() -> None:
    """
    Verify date_format="textual" is parsed into DateFormat.TEXTUAL.

    Raises
    ------
    AssertionError
        If the value is not converted to the enum member.
    """
    update = UserPreferencesUpdate(date_format="textual")

    assert update.date_format == DateFormat.TEXTUAL


# ---------------------------------------------------------------------------
# 28 – date_format rejects a value outside the enum
# ---------------------------------------------------------------------------

def test_user_schema_28() -> None:
    """
    Verify an unrecognized date_format string raises a ValidationError.

    Raises
    ------
    AssertionError
        If "bogus" does NOT raise.
    """
    with pytest.raises(ValidationError):
        UserPreferencesUpdate(date_format="bogus")


# ---------------------------------------------------------------------------
# 29 – language_locale / number_locale accept any string (no validator)
# ---------------------------------------------------------------------------

def test_user_schema_29() -> None:
    """
    Verify language_locale and number_locale have no format validator at the
    schema level — any non-empty string passes through unchanged. This
    documents the current, intentionally unconstrained contract for these
    two fields (unlike initials and date_format, which are validated above).

    Raises
    ------
    AssertionError
        If an arbitrary locale string is rejected or altered.
    """
    update = UserPreferencesUpdate(language_locale="xx_YY", number_locale="zz")

    assert update.language_locale == "xx_YY"
    assert update.number_locale == "zz"
