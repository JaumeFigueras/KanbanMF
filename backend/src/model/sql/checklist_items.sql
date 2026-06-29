
CREATE TABLE checklist_items (
	id UUID NOT NULL, 
	checklist_id UUID NOT NULL, 
	text VARCHAR(500) NOT NULL, 
	is_done BOOLEAN DEFAULT 'false' NOT NULL, 
	position INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(checklist_id) REFERENCES checklists (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
CREATE INDEX ix_checklist_items_checklist_id ON checklist_items (checklist_id);
CREATE INDEX ix_checklist_items_id ON checklist_items (id);
ALTER TABLE public.checklist_items OWNER TO kanbanmf_user;
GRANT SELECT on public.checklist_items to kanbanmf_remoteuser;