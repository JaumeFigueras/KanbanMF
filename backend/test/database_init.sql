-- database_init.sql
SET timezone='UTC';

DO
$do$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_catalog.pg_roles  -- SELECT list can be empty for this
    	WHERE rolname = 'kanbanmf_user') THEN
            CREATE ROLE kanbanmf_user WITH PASSWORD '1234';
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO kanbanmf_user;
   END IF;
END
$do$;

DO
$do$
BEGIN
   IF NOT EXISTS (
		SELECT FROM pg_catalog.pg_roles  -- SELECT list can be empty for this
    	WHERE rolname = 'kanbanmf_remoteuser') THEN
            CREATE ROLE kanbanmf_remoteuser WITH PASSWORD '1234';
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO kanbanmf_remoteuser;
   END IF;
END
$do$;

ALTER DATABASE test OWNER TO kanbanmf_user;
SET SESSION AUTHORIZATION kanbanmf_user;
