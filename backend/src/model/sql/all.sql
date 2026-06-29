
CREATE TABLE users (
	id UUID NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	display_name VARCHAR(100) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	is_verified BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id)
)
WITH (OIDS = FALSE);
CREATE UNIQUE INDEX ix_users_email ON users (email);
CREATE INDEX ix_users_id ON users (id);
ALTER TABLE public.users OWNER TO kanbanmf_user;
GRANT SELECT on public.users to kanbanmf_remoteuser;

CREATE TABLE user_avatars (
	user_id UUID NOT NULL, 
	data BYTEA NOT NULL, 
	mime_type VARCHAR(32) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id), 
	CONSTRAINT ck_avatar_max_size CHECK (octet_length(data) <= 102400), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.user_avatars OWNER TO kanbanmf_user;
GRANT SELECT on public.user_avatars to kanbanmf_remoteuser;
CREATE TYPE dateformat AS ENUM ('numeric', 'textual');

CREATE TABLE user_preferences (
	user_id UUID NOT NULL, 
	language_locale VARCHAR(10) NOT NULL, 
	number_locale VARCHAR(10) NOT NULL, 
	initials VARCHAR(3), 
	date_format dateformat DEFAULT 'numeric' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.user_preferences OWNER TO kanbanmf_user;
GRANT SELECT on public.user_preferences to kanbanmf_remoteuser;
CREATE TYPE authprovider AS ENUM ('local', 'google');

CREATE TABLE user_identities (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	provider authprovider NOT NULL, 
	provider_user_id VARCHAR(255), 
	access_token VARCHAR(2048), 
	refresh_token VARCHAR(2048), 
	token_expiry TIMESTAMP WITH TIME ZONE, 
	hashed_password VARCHAR(255), 
	verification_token VARCHAR(255), 
	verification_token_expiry TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_user_identities_user_id ON user_identities (user_id);
ALTER TABLE public.user_identities OWNER TO kanbanmf_user;
GRANT SELECT on public.user_identities to kanbanmf_remoteuser;

CREATE TABLE user_sessions (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	hashed_refresh_token VARCHAR(255) NOT NULL, 
	device_info VARCHAR(255), 
	is_active BOOLEAN NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	last_used_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_user_sessions_user_id ON user_sessions (user_id);
ALTER TABLE public.user_sessions OWNER TO kanbanmf_user;
GRANT SELECT on public.user_sessions to kanbanmf_remoteuser;

CREATE TABLE boards (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	is_archived BOOLEAN DEFAULT 'false' NOT NULL, 
	is_deleted BOOLEAN DEFAULT 'false' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_boards_id ON boards (id);
CREATE INDEX ix_boards_owner_id ON boards (owner_id);
ALTER TABLE public.boards OWNER TO kanbanmf_user;
GRANT SELECT on public.boards to kanbanmf_remoteuser;

CREATE TABLE board_shares (
	board_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	shared_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (board_id, user_id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.board_shares OWNER TO kanbanmf_user;
GRANT SELECT on public.board_shares to kanbanmf_remoteuser;

CREATE TABLE board_lists (
	id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	is_archived BOOLEAN DEFAULT 'false' NOT NULL, 
	is_deleted BOOLEAN DEFAULT 'false' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_board_lists_id ON board_lists (id);
CREATE INDEX ix_board_lists_board_id ON board_lists (board_id);
ALTER TABLE public.board_lists OWNER TO kanbanmf_user;
GRANT SELECT on public.board_lists to kanbanmf_remoteuser;

CREATE TABLE user_board_stars (
	user_id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	starred_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, board_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.user_board_stars OWNER TO kanbanmf_user;
GRANT SELECT on public.user_board_stars to kanbanmf_remoteuser;

CREATE TABLE ui_board_orders (
	user_id UUID NOT NULL, 
	starred_ids UUID[] DEFAULT '{}' NOT NULL, 
	owned_ids UUID[] DEFAULT '{}' NOT NULL, 
	shared_ids UUID[] DEFAULT '{}' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_board_orders OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_board_orders to kanbanmf_remoteuser;

CREATE TABLE ui_board_list_orders (
	board_id UUID NOT NULL, 
	list_ids UUID[] DEFAULT '{}' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (board_id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_board_list_orders OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_board_list_orders to kanbanmf_remoteuser;
