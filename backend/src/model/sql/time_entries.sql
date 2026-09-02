
CREATE TABLE time_entries (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	started_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	ended_at TIMESTAMP WITH TIME ZONE, 
	board_name VARCHAR(255) NOT NULL, 
	card_name VARCHAR(255) NOT NULL, 
	labels JSONB DEFAULT '[]' NOT NULL, 
	comment TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_time_entries_end_after_start CHECK (ended_at IS NULL OR ended_at > started_at), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_time_entries_user_id ON time_entries (user_id);
CREATE UNIQUE INDEX ux_time_entries_one_running_per_user ON time_entries (user_id) WHERE ended_at IS NULL;
CREATE INDEX ix_time_entries_id ON time_entries (id);
ALTER TABLE public.time_entries OWNER TO kanbanmf_user;
GRANT SELECT on public.time_entries to kanbanmf_remoteuser;