# SETUP procedures of KanbanMF

## Old-fashioned deployment

### Debian

#### Backend and Frontend

Clone the project from git (use main repo or your own fork)

```bash
git clone https://github.com/JaumeFigueras/KanbanMF.git
```

#### PostgreSQL database

Create the database in PostgreSQL (I always prefer a custom cluster per project):
- Change the port to a port that fits you
- Change the directory to match your folder structure
- The remote user is optional, I add it to debug in a pre-production server with read-only privileges
- Use the postgres version according to your system

```bash
sudo pg_createcluster -d /home/postgresql-15/kanbanmf -l /home/postgresql-15/kanbanmf/kanbanmf.log -p 5445 --start --start-conf auto 15 kanbanmf
sudo su postgres
createuser -p 5445 -P kanbanmf_user
createuser -p 5445 -P kanbanmf_remoteuser
createdb -p 5445 -E UTF8 -O kanbanmf_user kanbanmf_db
exit
```
