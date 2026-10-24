
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