"""add unaccent extension

Revision ID: d4cde8633be7
Revises: 79a43700af0b
Create Date: 2026-10-23 19:32:38.834884

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4cde8633be7'
down_revision: Union[str, Sequence[str], None] = '79a43700af0b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # The card search compares unaccent(...) of both sides. unaccent is a
    # trusted extension since PostgreSQL 13: the database owner can create it
    # without being superuser (see SETUP.md for other setups).
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP EXTENSION IF EXISTS unaccent")
