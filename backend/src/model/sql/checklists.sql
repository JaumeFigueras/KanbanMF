
CREATE TABLE checklists (
	id UUID NOT NULL, 
	card_id UUID NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	position INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_checklists_id ON checklists (id);
CREATE INDEX ix_checklists_card_id ON checklists (card_id);
ALTER TABLE public.checklists OWNER TO kanbanmf_user;
GRANT SELECT on public.checklists to kanbanmf_remoteuser;