"""add board templates

Revision ID: c7e94b2d18a5
Revises: a3f21c9b47de
Create Date: 2026-10-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c7e94b2d18a5'
down_revision: Union[str, Sequence[str], None] = 'a3f21c9b47de'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default backfills every existing board as a normal board and
    # every existing order row with an empty Templates section.
    op.add_column(
        'boards',
        sa.Column(
            'is_template',
            sa.Boolean(),
            server_default='false',
            nullable=False,
            comment='Template boards hold only lists, which are copied into boards created from them.',
        ),
    )
    op.add_column(
        'ui_board_orders',
        sa.Column(
            'template_ids',
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            server_default='{}',
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('ui_board_orders', 'template_ids')
    op.drop_column('boards', 'is_template')
