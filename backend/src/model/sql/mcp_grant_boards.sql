
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