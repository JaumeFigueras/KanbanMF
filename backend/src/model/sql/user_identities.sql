CREATE TYPE authprovider AS ENUM ('local', 'google');

CREATE TABLE user_identities (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	provider authprovider NOT NULL, 
	provider_user_id VARCHAR(255), 
	hashed_password VARCHAR(255), 
	hashed_verification_token VARCHAR(64), 
	verification_token_expiry TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (hashed_verification_token)
)
WITH (OIDS = FALSE);
CREATE INDEX ix_user_identities_user_id ON user_identities (user_id);
ALTER TABLE public.user_identities OWNER TO kanbanmf_user;