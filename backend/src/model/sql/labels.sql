
CREATE TABLE labels (
	id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_labels_id ON labels (id);
CREATE INDEX ix_labels_board_id ON labels (board_id);
ALTER TABLE public.labels OWNER TO kanbanmf_user;
GRANT SELECT on public.labels to kanbanmf_remoteuser;