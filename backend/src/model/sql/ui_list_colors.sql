
CREATE TABLE ui_list_colors (
	user_id UUID NOT NULL, 
	list_id UUID NOT NULL, 
	color VARCHAR(50) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id, list_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.ui_list_colors OWNER TO kanbanmf_user;
GRANT SELECT on public.ui_list_colors to kanbanmf_remoteuser;