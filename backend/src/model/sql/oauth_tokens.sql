
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