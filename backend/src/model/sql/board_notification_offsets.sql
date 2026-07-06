
CREATE TABLE board_notification_offsets (
	board_id UUID NOT NULL, 
	offset_days SMALLINT NOT NULL, 
	PRIMARY KEY (board_id, offset_days), 
	FOREIGN KEY(board_id) REFERENCES board_notification_settings (board_id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.board_notification_offsets OWNER TO kanbanmf_user;
GRANT SELECT on public.board_notification_offsets to kanbanmf_remoteuser;