
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
	timezone VARCHAR(50) DEFAULT 'UTC' NOT NULL, 
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
	hashed_refresh_token VARCHAR(64) NOT NULL, 
	device_info VARCHAR(255), 
	is_active BOOLEAN NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	last_used_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (hashed_refresh_token)
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
	is_template BOOLEAN DEFAULT 'false' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_boards_owner_id ON boards (owner_id);
CREATE INDEX ix_boards_id ON boards (id);
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


CREATE TABLE board_invitations (
	id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	invited_by_id UUID NOT NULL, 
	language VARCHAR(10) NOT NULL, 
	token VARCHAR(64) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_board_invitations_board_email UNIQUE (board_id, email), 
	CONSTRAINT ck_board_invitations_email_lowercase CHECK (email = lower(email)), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE, 
	FOREIGN KEY(invited_by_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (token)
)
WITH (OIDS = FALSE);
CREATE INDEX ix_board_invitations_id ON board_invitations (id);
CREATE INDEX ix_board_invitations_board_id ON board_invitations (board_id);
CREATE INDEX ix_board_invitations_email ON board_invitations (email);
ALTER TABLE public.board_invitations OWNER TO kanbanmf_user;
GRANT SELECT on public.board_invitations to kanbanmf_remoteuser;

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
CREATE INDEX ix_board_lists_board_id ON board_lists (board_id);
CREATE INDEX ix_board_lists_id ON board_lists (id);
ALTER TABLE public.board_lists OWNER TO kanbanmf_user;
GRANT SELECT on public.board_lists to kanbanmf_remoteuser;

CREATE TABLE board_notification_settings (
	board_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	is_enabled BOOLEAN DEFAULT 'false' NOT NULL, 
	notify_hour SMALLINT DEFAULT '9' NOT NULL, 
	notify_weekdays SMALLINT DEFAULT '31' NOT NULL, 
	overdue_repeat_after_days SMALLINT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (board_id, user_id), 
	CONSTRAINT ck_board_notification_settings_notify_hour_range CHECK (notify_hour >= 0 AND notify_hour <= 23), 
	CONSTRAINT ck_board_notification_settings_notify_weekdays_range CHECK (notify_weekdays >= 1 AND notify_weekdays <= 127), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.board_notification_settings OWNER TO kanbanmf_user;
GRANT SELECT on public.board_notification_settings to kanbanmf_remoteuser;

CREATE TABLE board_notification_offsets (
	board_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	offset_days SMALLINT NOT NULL, 
	PRIMARY KEY (board_id, user_id, offset_days), 
	FOREIGN KEY(board_id, user_id) REFERENCES board_notification_settings (board_id, user_id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.board_notification_offsets OWNER TO kanbanmf_user;
GRANT SELECT on public.board_notification_offsets to kanbanmf_remoteuser;

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
	template_ids UUID[] DEFAULT '{}' NOT NULL, 
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

CREATE TABLE ui_board_colors (
	user_id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, board_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_board_colors OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_board_colors to kanbanmf_remoteuser;

CREATE TABLE labels (
	id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	position INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_labels_board_id ON labels (board_id);
CREATE INDEX ix_labels_id ON labels (id);
ALTER TABLE public.labels OWNER TO kanbanmf_user;
GRANT SELECT on public.labels to kanbanmf_remoteuser;

CREATE TABLE cards (
	id UUID NOT NULL, 
	list_id UUID NOT NULL, 
	creator_id UUID, 
	replaced_by_id UUID, 
	name VARCHAR(255) NOT NULL, 
	description TEXT, 
	is_archived BOOLEAN DEFAULT 'false' NOT NULL, 
	is_deleted BOOLEAN DEFAULT 'false' NOT NULL, 
	start_at TIMESTAMP WITH TIME ZONE, 
	due_at TIMESTAMP WITH TIME ZONE, 
	end_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE, 
	FOREIGN KEY(creator_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(replaced_by_id) REFERENCES cards (id) ON DELETE SET NULL
)
WITH (OIDS = FALSE);
CREATE INDEX ix_cards_id ON cards (id);
CREATE INDEX ix_cards_list_id ON cards (list_id);
CREATE INDEX ix_cards_creator_id ON cards (creator_id);
ALTER TABLE public.cards OWNER TO kanbanmf_user;
GRANT SELECT on public.cards to kanbanmf_remoteuser;

CREATE TABLE card_members (
	card_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	added_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (card_id, user_id), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_members OWNER TO kanbanmf_user;
GRANT SELECT on public.card_members to kanbanmf_remoteuser;

CREATE TABLE card_assignees (
	card_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	assigned_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (card_id, user_id), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_assignees OWNER TO kanbanmf_user;
GRANT SELECT on public.card_assignees to kanbanmf_remoteuser;

CREATE TABLE card_labels (
	card_id UUID NOT NULL, 
	label_id UUID NOT NULL, 
	PRIMARY KEY (card_id, label_id), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE, 
	FOREIGN KEY(label_id) REFERENCES labels (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_labels OWNER TO kanbanmf_user;
GRANT SELECT on public.card_labels to kanbanmf_remoteuser;

CREATE TABLE card_due_notifications (
	card_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	notification_date DATE NOT NULL, 
	sent_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (card_id, user_id, notification_date), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_due_notifications OWNER TO kanbanmf_user;
GRANT SELECT on public.card_due_notifications to kanbanmf_remoteuser;

CREATE TABLE ui_card_colors (
	user_id UUID NOT NULL, 
	card_id UUID NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, card_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_card_colors OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_card_colors to kanbanmf_remoteuser;

CREATE TABLE ui_list_card_orders (
	list_id UUID NOT NULL, 
	card_ids UUID[] DEFAULT '{}' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (list_id), 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_list_card_orders OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_list_card_orders to kanbanmf_remoteuser;

CREATE TABLE ui_list_colors (
	user_id UUID NOT NULL, 
	list_id UUID NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, list_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_list_colors OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_list_colors to kanbanmf_remoteuser;

CREATE TABLE checklists (
	id UUID NOT NULL, 
	card_id UUID NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	position INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_checklists_id ON checklists (id);
CREATE INDEX ix_checklists_card_id ON checklists (card_id);
ALTER TABLE public.checklists OWNER TO kanbanmf_user;
GRANT SELECT on public.checklists to kanbanmf_remoteuser;

CREATE TABLE checklist_items (
	id UUID NOT NULL, 
	checklist_id UUID NOT NULL, 
	text VARCHAR(500) NOT NULL, 
	is_done BOOLEAN DEFAULT 'false' NOT NULL, 
	position INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(checklist_id) REFERENCES checklists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_checklist_items_checklist_id ON checklist_items (checklist_id);
CREATE INDEX ix_checklist_items_id ON checklist_items (id);
ALTER TABLE public.checklist_items OWNER TO kanbanmf_user;
GRANT SELECT on public.checklist_items to kanbanmf_remoteuser;


CREATE TABLE time_entries (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	started_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	ended_at TIMESTAMP WITH TIME ZONE, 
	board_id UUID, 
	list_id UUID, 
	card_id UUID, 
	board_name VARCHAR(255) NOT NULL, 
	card_name VARCHAR(255) NOT NULL, 
	labels JSONB DEFAULT '[]' NOT NULL, 
	comment TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_time_entries_end_after_start CHECK (ended_at IS NULL OR ended_at > started_at), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_time_entries_user_id ON time_entries (user_id);
CREATE INDEX ix_time_entries_user_id_started_at ON time_entries (user_id, started_at);
CREATE INDEX ix_time_entries_id ON time_entries (id);
CREATE UNIQUE INDEX ux_time_entries_one_running_per_user ON time_entries (user_id) WHERE ended_at IS NULL;
ALTER TABLE public.time_entries OWNER TO kanbanmf_user;
GRANT SELECT on public.time_entries to kanbanmf_remoteuser;

CREATE TABLE time_tracker_board_usage (
	user_id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	usage_count INTEGER NOT NULL, 
	computed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (user_id, board_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.time_tracker_board_usage OWNER TO kanbanmf_user;
GRANT SELECT on public.time_tracker_board_usage to kanbanmf_remoteuser;

CREATE TABLE time_tracker_list_usage (
	user_id UUID NOT NULL, 
	list_id UUID NOT NULL, 
	usage_count INTEGER NOT NULL, 
	computed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (user_id, list_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.time_tracker_list_usage OWNER TO kanbanmf_user;
GRANT SELECT on public.time_tracker_list_usage to kanbanmf_remoteuser;

CREATE TABLE oauth_clients (
	id UUID NOT NULL, 
	client_id VARCHAR(512) NOT NULL, 
	registration VARCHAR(10) NOT NULL, 
	client_name VARCHAR(200) NOT NULL, 
	redirect_uris TEXT[] NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	metadata_fetched_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_oauth_clients_registration CHECK (registration IN ('dcr', 'cimd')), 
	UNIQUE (client_id)
)
WITH (OIDS = FALSE);
ALTER TABLE public.oauth_clients OWNER TO kanbanmf_user;
GRANT SELECT on public.oauth_clients to kanbanmf_remoteuser;

CREATE TABLE mcp_grants (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	client_id UUID NOT NULL, 
	read_only BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	last_used_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(client_id) REFERENCES oauth_clients (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_mcp_grants_user_id ON mcp_grants (user_id);
CREATE INDEX ix_mcp_grants_client_id ON mcp_grants (client_id);
ALTER TABLE public.mcp_grants OWNER TO kanbanmf_user;
GRANT SELECT on public.mcp_grants to kanbanmf_remoteuser;

CREATE TABLE mcp_grant_boards (
	grant_id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	PRIMARY KEY (grant_id, board_id), 
	FOREIGN KEY(grant_id) REFERENCES mcp_grants (id) ON DELETE CASCADE, 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.mcp_grant_boards OWNER TO kanbanmf_user;
GRANT SELECT on public.mcp_grant_boards to kanbanmf_remoteuser;

CREATE TABLE oauth_authorization_requests (
	id UUID NOT NULL, 
	client_id UUID NOT NULL, 
	redirect_uri TEXT NOT NULL, 
	state TEXT, 
	code_challenge VARCHAR(128) NOT NULL, 
	resource TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(client_id) REFERENCES oauth_clients (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.oauth_authorization_requests OWNER TO kanbanmf_user;
GRANT SELECT on public.oauth_authorization_requests to kanbanmf_remoteuser;

CREATE TABLE oauth_authorization_codes (
	code_hash VARCHAR(64) NOT NULL, 
	grant_id UUID NOT NULL, 
	redirect_uri TEXT NOT NULL, 
	code_challenge VARCHAR(128) NOT NULL, 
	resource TEXT NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (code_hash), 
	FOREIGN KEY(grant_id) REFERENCES mcp_grants (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.oauth_authorization_codes OWNER TO kanbanmf_user;
GRANT SELECT on public.oauth_authorization_codes to kanbanmf_remoteuser;

CREATE TABLE oauth_tokens (
	id UUID NOT NULL, 
	grant_id UUID NOT NULL, 
	access_token_hash VARCHAR(64) NOT NULL, 
	refresh_token_hash VARCHAR(64) NOT NULL, 
	resource TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	access_expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	refresh_expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	rotated_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(grant_id) REFERENCES mcp_grants (id) ON DELETE CASCADE, 
	UNIQUE (access_token_hash), 
	UNIQUE (refresh_token_hash)
)
WITH (OIDS = FALSE);
CREATE INDEX ix_oauth_tokens_grant_id ON oauth_tokens (grant_id);
ALTER TABLE public.oauth_tokens OWNER TO kanbanmf_user;
GRANT SELECT on public.oauth_tokens to kanbanmf_remoteuser;
