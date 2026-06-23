
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