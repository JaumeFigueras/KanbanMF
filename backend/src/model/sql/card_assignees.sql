
CREATE TABLE card_assignees (
	card_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	assigned_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (card_id, user_id), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_assignees OWNER TO kanbanmf_user;
GRANT SELECT on public.card_assignees to kanbanmf_remoteuser;