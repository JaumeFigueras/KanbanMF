
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