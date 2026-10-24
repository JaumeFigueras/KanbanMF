
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