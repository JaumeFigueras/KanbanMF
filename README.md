# KanbanMF
Simple Kanban application (Minimalist and Fast)


# Old-fashioned Setup

## Database
Create the database in PostgreSQL (I always prefer a custom cluster per project):
- Change the port to a port that fits you
- Change the directory to match your folder structure
- The remote user is optional, I add it to debug in a pre-production server with read-only privileges

```bash
$ sudo pg_createcluster -d /home/postgresql-15/kanbanmf -l /home/postgresql-15/kanbanmf/kanbanmf.log -p 5445 --start --start-conf auto 15 kanbanmf
$ sudo -i -u postgres
$ createuser -p 5445 -P kanbanmf_user
$ createuser -p 5445 -P kanbanmf_remoteuser
$ createdb -p 5445 -E UTF8 -O kanbanmf_user kanbanmf_db
$ exit

