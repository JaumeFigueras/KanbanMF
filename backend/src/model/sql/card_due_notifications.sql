
CREATE TABLE card_due_notifications (
	card_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	notification_date DATE NOT NULL, 
	sent_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (card_id, user_id, notification_date), 
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_due_notifications OWNER TO kanbanmf_user;
GRANT SELECT on public.card_due_notifications to kanbanmf_remoteuser;