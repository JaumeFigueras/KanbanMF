
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