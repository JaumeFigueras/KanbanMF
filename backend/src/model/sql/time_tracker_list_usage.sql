
CREATE TABLE time_tracker_list_usage (
	user_id UUID NOT NULL, 
	list_id UUID NOT NULL, 
	usage_count INTEGER NOT NULL, 
	computed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (user_id, list_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(list_id) REFERENCES board_lists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.time_tracker_list_usage OWNER TO kanbanmf_user;
GRANT SELECT on public.time_tracker_list_usage to kanbanmf_remoteuser;