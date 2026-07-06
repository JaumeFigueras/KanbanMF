
CREATE TABLE board_notification_settings (
	board_id UUID NOT NULL, 
	is_enabled BOOLEAN DEFAULT 'false' NOT NULL, 
	notify_hour SMALLINT DEFAULT '9' NOT NULL, 
	overdue_repeat_after_days SMALLINT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (board_id), 
	CONSTRAINT ck_board_notification_settings_notify_hour_range CHECK (notify_hour >= 0 AND notify_hour <= 23), 
	FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.board_notification_settings OWNER TO kanbanmf_user;
GRANT SELECT on public.board_notification_settings to kanbanmf_remoteuser;