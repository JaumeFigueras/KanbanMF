
CREATE TABLE boards (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	is_starred BOOLEAN DEFAULT 'false' NOT NULL, 
	is_archived BOOLEAN DEFAULT 'false' NOT NULL, 
	is_deleted BOOLEAN DEFAULT 'false' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_boards_owner_id ON boards (owner_id);
CREATE INDEX ix_boards_id ON boards (id);
ALTER TABLE public.boards OWNER TO kanbanmf_user;
GRANT SELECT on public.boards to kanbanmf_remoteuser;