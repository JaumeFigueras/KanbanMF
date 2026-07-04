
CREATE TABLE ui_list_card_orders (
	list_id UUID NOT NULL, 
	card_ids UUID[] DEFAULT '{}' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (list_id), 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_list_card_orders OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_list_card_orders to kanbanmf_remoteuser;