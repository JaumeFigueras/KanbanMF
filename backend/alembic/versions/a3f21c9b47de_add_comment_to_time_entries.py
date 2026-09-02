"""add comment to time entries

Revision ID: a3f21c9b47de
Revises: 57558eec81f6
Create Date: 2026-09-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a3f21c9b47de'
down_revision: Union[str, Sequence[str], None] = '57558eec81f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable rather than NOT NULL DEFAULT '': existing entries genuinely
    # have no note, and NULL is the one value that says so — a blank note and
    # no note shouldn't be two different states in the table.
    op.add_column(
        'time_entries',
        sa.Column(
            'comment',
            sa.Text(),
            nullable=True,
            comment='Free note the user wrote about this stretch of work. Not copied from the card.',
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('time_entries', 'comment')
