
CREATE TABLE board_invitations (
	id UUID NOT NULL, 
	board_id UUID NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	invited_by_id UUID NOT NULL, 
	language VARCHAR(10) NOT NULL, 
	token VARCHAR(64) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_board_invitations_board_email UNIQUE (board_id, email), 
	CONSTRAINT ck_board_invitations_email_lowercase CHECK (email = lower(email)), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE, 
	FOREIGN KEY(invited_by_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (token)
)
WITH (OIDS = FALSE);
CREATE INDEX ix_board_invitations_id ON board_invitations (id);
CREATE INDEX ix_board_invitations_board_id ON board_invitations (board_id);
CREATE INDEX ix_board_invitations_email ON board_invitations (email);
ALTER TABLE public.board_invitations OWNER TO kanbanmf_user;
GRANT SELECT on public.board_invitations to kanbanmf_remoteuser;