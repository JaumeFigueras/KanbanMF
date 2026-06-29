
CREATE TABLE card_members (
	card_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	added_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (card_id, user_id), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_members OWNER TO kanbanmf_user;
GRANT SELECT on public.card_members to kanbanmf_remoteuser;