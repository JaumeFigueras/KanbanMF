
CREATE TABLE board_lists (
	id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	is_archived BOOLEAN DEFAULT 'false' NOT NULL, 
	is_deleted BOOLEAN DEFAULT 'false' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_board_lists_id ON board_lists (id);
CREATE INDEX ix_board_lists_board_id ON board_lists (board_id);
ALTER TABLE public.board_lists OWNER TO kanbanmf_user;
GRANT SELECT on public.board_lists to kanbanmf_remoteuser;