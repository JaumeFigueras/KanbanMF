
CREATE TABLE board_shares (
	board_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	shared_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (board_id, user_id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.board_shares OWNER TO kanbanmf_user;
GRANT SELECT on public.board_shares to kanbanmf_remoteuser;