
CREATE TABLE card_labels (
	card_id UUID NOT NULL,
	label_id UUID NOT NULL,
	PRIMARY KEY (card_id, label_id),
	FOREIGN KEY(card_id) REFERENCES cards (id) ON DELETE CASCADE,
	FOREIGN KEY(label_id) REFERENCES labels (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.card_labels OWNER TO kanbanmf_user;
GRANT SELECT on public.card_labels to kanbanmf_remoteuser;