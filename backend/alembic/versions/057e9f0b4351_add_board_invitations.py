"""add board invitations

Revision ID: 057e9f0b4351
Revises: c7e94b2d18a5
Create Date: 2026-10-08 23:08:54.304632

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '057e9f0b4351'
down_revision: Union[str, Sequence[str], None] = 'c7e94b2d18a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('board_invitations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('board_id', sa.UUID(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False, comment='Invited address, lowercase. Matched against users.email case-insensitively.'),
    sa.Column('invited_by_id', sa.UUID(), nullable=False, comment='The board owner who sent the invitation.'),
    sa.Column('language', sa.String(length=10), nullable=False, comment='Language the invitation e-mail was written in (en, ca).'),
    sa.Column('token', sa.String(length=64), nullable=False, comment='Random token for the sign-up link in the invitation e-mail.'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False, comment='After this the invitation is ignored and deleted by the hourly cleanup.'),
    sa.CheckConstraint('email = lower(email)', name='ck_board_invitations_email_lowercase'),
    sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['invited_by_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('board_id', 'email', name='uq_board_invitations_board_email'),
    sa.UniqueConstraint('token')
    )
    op.create_index(op.f('ix_board_invitations_board_id'), 'board_invitations', ['board_id'], unique=False)
    op.create_index(op.f('ix_board_invitations_email'), 'board_invitations', ['email'], unique=False)
    op.create_index(op.f('ix_board_invitations_id'), 'board_invitations', ['id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_board_invitations_id'), table_name='board_invitations')
    op.drop_index(op.f('ix_board_invitations_email'), table_name='board_invitations')
    op.drop_index(op.f('ix_board_invitations_board_id'), table_name='board_invitations')
    op.drop_table('board_invitations')
