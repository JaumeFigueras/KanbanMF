
CREATE TABLE cards (
	id UUID NOT NULL, 
	list_id UUID NOT NULL, 
	creator_id UUID, 
	name VARCHAR(255) NOT NULL, 
	description TEXT, 
	is_archived BOOLEAN DEFAULT 'false' NOT NULL, 
	is_deleted BOOLEAN DEFAULT 'false' NOT NULL, 
	start_at TIMESTAMP WITH TIME ZONE, 
	due_at TIMESTAMP WITH TIME ZONE, 
	end_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE, 
	FOREIGN KEY(creator_id) REFERENCES users (id) ON DELETE SET NULL
)
WITH (OIDS = FALSE);
CREATE INDEX ix_cards_id ON cards (id);
CREATE INDEX ix_cards_list_id ON cards (list_id);
CREATE INDEX ix_cards_creator_id ON cards (creator_id);
ALTER TABLE public.cards OWNER TO kanbanmf_user;
GRANT SELECT on public.cards to kanbanmf_remoteuser;