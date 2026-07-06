
CREATE TABLE ui_board_colors (
	user_id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, board_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_board_colors OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_board_colors to kanbanmf_remoteuser;