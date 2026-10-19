"""add notify_weekdays to board notification settings

Revision ID: f83f4cc7666c
Revises: 057e9f0b4351
Create Date: 2026-10-19 11:04:44.429002

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f83f4cc7666c'
down_revision: Union[str, Sequence[str], None] = '057e9f0b4351'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing settings were created when e-mails went out every day, so
    # backfill them with every weekday (127) to keep their behaviour
    # unchanged; only rows created from now on default to Monday-Friday (31).
    op.add_column('board_notification_settings', sa.Column('notify_weekdays', sa.SmallInteger(), server_default='127', nullable=False, comment="Bitmask of ISO weekdays on which notifications may be sent, in this user's own timezone: bit 0 = Monday ... bit 6 = Sunday. Defaults to Monday-Friday (31); 127 is every day."))
    op.create_check_constraint('ck_board_notification_settings_notify_weekdays_range', 'board_notification_settings', 'notify_weekdays >= 1 AND notify_weekdays <= 127')
    op.alter_column('board_notification_settings', 'notify_weekdays',
               existing_type=sa.SmallInteger(),
               existing_nullable=False,
               server_default='31')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_board_notification_settings_notify_weekdays_range', 'board_notification_settings', type_='check')
    op.drop_column('board_notification_settings', 'notify_weekdays')
