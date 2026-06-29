
CREATE TABLE ui_board_list_orders (
	board_id UUID NOT NULL, 
	list_ids UUID[] DEFAULT '{}' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (board_id), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_board_list_orders OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_board_list_orders to kanbanmf_remoteuser;