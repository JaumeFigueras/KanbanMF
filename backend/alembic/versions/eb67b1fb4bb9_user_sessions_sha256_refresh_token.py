"""user sessions sha256 refresh token

Sessions are now looked up by the SHA-256 of their refresh token instead of
bcrypt-checking every session (security fix: one request could block the
server for seconds). The existing rows hold bcrypt hashes, which can't be
looked up, so they are deleted: everyone signs in again once.

Revision ID: eb67b1fb4bb9
Revises: 3f9ce74edc68
Create Date: 2026-10-25 00:43:55.022209

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eb67b1fb4bb9'
down_revision: Union[str, Sequence[str], None] = '3f9ce74edc68'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("DELETE FROM user_sessions")
    op.alter_column('user_sessions', 'hashed_refresh_token',
               existing_type=sa.VARCHAR(length=255),
               type_=sa.String(length=64),
               comment='SHA-256 (hex) of the refresh token, to look the session up by. Plain token is sent via HTTP-only cookie.',
               existing_comment='bcrypt hash of the refresh token. Plain token is sent via HTTP-only cookie.',
               existing_nullable=False)
    op.create_unique_constraint(
        'user_sessions_hashed_refresh_token_key', 'user_sessions', ['hashed_refresh_token']
    )


def downgrade() -> None:
    """Downgrade schema."""
    # SHA-256 rows mean nothing to the bcrypt code being restored.
    op.execute("DELETE FROM user_sessions")
    op.drop_constraint('user_sessions_hashed_refresh_token_key', 'user_sessions', type_='unique')
    op.alter_column('user_sessions', 'hashed_refresh_token',
               existing_type=sa.String(length=64),
               type_=sa.VARCHAR(length=255),
               comment='bcrypt hash of the refresh token. Plain token is sent via HTTP-only cookie.',
               existing_comment='SHA-256 (hex) of the refresh token, to look the session up by. Plain token is sent via HTTP-only cookie.',
               existing_nullable=False)
