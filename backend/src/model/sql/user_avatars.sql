
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