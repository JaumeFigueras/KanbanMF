
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