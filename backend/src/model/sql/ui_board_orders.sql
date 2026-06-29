
CREATE TABLE ui_board_orders (
	user_id UUID NOT NULL, 
	starred_ids UUID[] DEFAULT '{}' NOT NULL, 
	owned_ids UUID[] DEFAULT '{}' NOT NULL, 
	shared_ids UUID[] DEFAULT '{}' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_board_orders OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_board_orders to kanbanmf_remoteuser;