"""hash verification and invitation tokens, drop google tokens

Security fix: the e-mail verification token and the board invitation token
were stored as they are sent, so anyone who could read those tables had
working links. Only their SHA-256 is stored now, like the session and OAuth
tokens. Existing rows are hashed in place, so links already sent keep
working.

Google's access and refresh tokens were stored too, though nothing used them
after sign-in; the columns are dropped.

Revision ID: 1f834ef99eb1
Revises: eb67b1fb4bb9
Create Date: 2026-10-25 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1f834ef99eb1'
down_revision: Union[str, Sequence[str], None] = 'eb67b1fb4bb9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The same hex SHA-256 as src.core.security.hash_token. sha256() is built into
# PostgreSQL 11 and later.
_SHA256 = "encode(sha256(convert_to({column}, 'UTF8')), 'hex')"


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        "UPDATE user_identities SET verification_token = "
        + _SHA256.format(column="verification_token")
        + " WHERE verification_token IS NOT NULL"
    )
    op.alter_column('user_identities', 'verification_token',
               new_column_name='hashed_verification_token',
               existing_type=sa.VARCHAR(length=255),
               type_=sa.String(length=64),
               comment='SHA-256 (hex) of the one-time token sent by email. Cleared after successful verification.',
               existing_comment='One-time token sent by email. Cleared after successful verification.',
               existing_nullable=True)
    op.create_unique_constraint(
        'user_identities_hashed_verification_token_key', 'user_identities', ['hashed_verification_token']
    )
    op.drop_column('user_identities', 'access_token')
    op.drop_column('user_identities', 'refresh_token')
    op.drop_column('user_identities', 'token_expiry')

    op.execute("UPDATE board_invitations SET token = " + _SHA256.format(column="token"))
    op.alter_column('board_invitations', 'token',
               new_column_name='hashed_token',
               existing_type=sa.String(length=64),
               comment="SHA-256 (hex) of the random token in the invitation e-mail's sign-up link.",
               existing_comment='Random token for the sign-up link in the invitation e-mail.',
               existing_nullable=False)
    op.execute(
        "ALTER TABLE board_invitations RENAME CONSTRAINT board_invitations_token_key "
        "TO board_invitations_hashed_token_key"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # A hash can't be turned back into the token it came from: pending
    # invitations are deleted, and pending verifications lose their link
    # (the account can sign up again once the link would have expired).
    op.execute("DELETE FROM board_invitations")
    op.execute(
        "ALTER TABLE board_invitations RENAME CONSTRAINT board_invitations_hashed_token_key "
        "TO board_invitations_token_key"
    )
    op.alter_column('board_invitations', 'hashed_token',
               new_column_name='token',
               existing_type=sa.String(length=64),
               comment='Random token for the sign-up link in the invitation e-mail.',
               existing_comment="SHA-256 (hex) of the random token in the invitation e-mail's sign-up link.",
               existing_nullable=False)

    op.add_column('user_identities', sa.Column('token_expiry', sa.DateTime(timezone=True), nullable=True))
    op.add_column('user_identities', sa.Column('refresh_token', sa.String(length=2048), nullable=True))
    op.add_column('user_identities', sa.Column('access_token', sa.String(length=2048), nullable=True))
    op.drop_constraint('user_identities_hashed_verification_token_key', 'user_identities', type_='unique')
    op.execute("UPDATE user_identities SET hashed_verification_token = NULL")
    op.alter_column('user_identities', 'hashed_verification_token',
               new_column_name='verification_token',
               existing_type=sa.String(length=64),
               type_=sa.VARCHAR(length=255),
               comment='One-time token sent by email. Cleared after successful verification.',
               existing_comment='SHA-256 (hex) of the one-time token sent by email. Cleared after successful verification.',
               existing_nullable=True)
