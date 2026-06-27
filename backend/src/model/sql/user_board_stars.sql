
CREATE TABLE user_board_stars (
	user_id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	starred_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, board_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.user_board_stars OWNER TO kanbanmf_user;
GRANT SELECT on public.user_board_stars to kanbanmf_remoteuser;