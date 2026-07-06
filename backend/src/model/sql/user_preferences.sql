CREATE TYPE dateformat AS ENUM ('numeric', 'textual');

CREATE TABLE user_preferences (
	user_id UUID NOT NULL, 
	language_locale VARCHAR(10) NOT NULL, 
	number_locale VARCHAR(10) NOT NULL, 
	initials VARCHAR(3), 
	date_format dateformat DEFAULT 'numeric' NOT NULL, 
	timezone VARCHAR(50) DEFAULT 'UTC' NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
WITH (OIDS = FALSE);
ALTER TABLE public.user_preferences OWNER TO kanbanmf_user;
GRANT SELECT on public.user_preferences to kanbanmf_remoteuser;