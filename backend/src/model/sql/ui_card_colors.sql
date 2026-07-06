
CREATE TABLE ui_card_colors (
	user_id UUID NOT NULL, 
	card_id UUID NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, card_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_card_colors OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_card_colors to kanbanmf_remoteuser;