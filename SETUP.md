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

#### Create the python virtual environment

```bash
# From the repo root — the virtualenv lives here, not inside backend/
python3 -m venv .venv
source .venv/bin/activate
pip3 install -r backend/requirements.txt
```

#### Load database schema

```bash
cd backend
cp .env.example .env
# Edit .env: at minimum set DATABASE_URL to your PostgreSQL instance and
# generate a real SECRET_KEY (openssl rand -hex 32). Google OAuth and SMTP
# are optional — leave them blank to disable Google sign-in / e-mail sending.

# Create the schema
alembic upgrade head
```

#### `.env` values that must change for production

The dev defaults in `.env.example` all point at `localhost`. For a real deployment behind
the domain you're putting in the Apache vhost, update these in `backend/.env`:

| Variable               | Production value                                                    |
|-------------------------|----------------------------------------------------------------------|
| `FRONTEND_URL`           | `https://kanban.example.com` — used for CORS and as the post-login redirect target after Google sign-in |
| `SECRET_KEY`             | A real secret: `openssl rand -hex 32` (never reuse the dev one)     |
| `GOOGLE_REDIRECT_URI`    | `https://kanban.example.com/api/v1/auth/google/callback` — must also be added to the authorized redirect URIs for this OAuth client in Google Cloud Console |
| `DATABASE_URL`           | Same PostgreSQL cluster/DB created above, but with production credentials |

The frontend itself needs no `.env` of its own: it talks to the API through relative URLs
(`/api/v1/...`), so it always calls back to whatever origin served the page — see
`frontend/src/api/client.ts`. There's nothing to point at a hostname or port.

#### Run backend FastAPI in production

Run under systemd rather than a bare `uvicorn` in a terminal, so it restarts on crash and
starts at boot without a login shell:

```bash
sudo cp deploy/kanbanmf-backend.service /etc/systemd/system/
sudo $EDITOR /etc/systemd/system/kanbanmf-backend.service
# Adjust User/Group/WorkingDirectory/ExecStart paths to match your layout —
# see the comments at the top of the file.
sudo systemctl daemon-reload
sudo systemctl enable --now kanbanmf-backend
sudo systemctl status kanbanmf-backend
```

It binds to `127.0.0.1:8000` only (never `0.0.0.0`) — the API is reachable exclusively
through the Apache reverse proxy set up below, never directly from the internet.

Run as a single process — don't add `--workers N`. The due-date notification scheduler
(`src/core/scheduler.py`) and the WebSocket connection registry (`src/core/ws_manager.py`)
both assume exactly one process: with multiple workers, the scheduler's hourly job would
fire once per worker, and a client's WebSocket could land on a worker that never sees a
given user's notifications.

#### Run frontend in production

There's no frontend *process* to run — it's a static single-page app. Build it once per
deploy and let Apache serve the output directory directly:

```bash
cd frontend
npm install
npm run build
# Output lands in frontend/dist/ — this is what the Apache DocumentRoot
# below points at. Re-run this (and reload nothing else) on every deploy
# that touches the frontend.
```

#### Update cron to load everything at reboot

Skip cron for this — systemd already covers it. The unit installed above has
`WantedBy=multi-user.target` and `Restart=on-failure`, so `systemctl enable` makes it start
at boot and come back on its own if it crashes, which a plain `@reboot` cron entry doesn't
give you. PostgreSQL's own systemd unit (`postgresql@15-kanbanmf`, from the cluster created
above) already starts at boot the same way; the backend unit's `After=`/`Wants=` just makes
sure it comes up after the database is available. There's no separate frontend process to
schedule at all (see above).

#### Setup apache2 to serve both with SSL

A ready-to-adapt vhost is at [`deploy/apache-kanbanmf.conf`](deploy/apache-kanbanmf.conf) —
copy it in, substitute `kanban.example.com` and the `/home/kanbanmf/...` paths for your own,
then enable it:

```bash
sudo a2enmod ssl proxy proxy_http proxy_wstunnel rewrite headers
sudo cp deploy/apache-kanbanmf.conf /etc/apache2/sites-available/kanbanmf.conf
sudo $EDITOR /etc/apache2/sites-available/kanbanmf.conf
sudo a2ensite kanbanmf
sudo systemctl reload apache2
```

It differs from a typical single-process Node app config in two ways, because KanbanMF
isn't one: the frontend is served as static files straight from `frontend/dist` (no process
to proxy to), and only requests under `/api/` are proxied to the backend — including a
dedicated `ws://` `ProxyPass` for the WebSocket endpoint, since it needs the
`Upgrade: websocket` handshake that a plain HTTP proxy can't handle. Everything that isn't a
real static file and isn't `/api/` falls back to `index.html`, so client-side routes like
`/boards/<id>` still work on a hard refresh.

Obtain the certificate with certbot's webroot plugin, pointed at the same directory the vhost's
`:80` block serves ACME challenges from:

```bash
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d kanban.example.com
```

#### Firewall

Only `80` and `443` should ever be reachable from the internet — everything else the app
needs (the backend on `127.0.0.1:8000`, PostgreSQL on its cluster port) is bound to loopback
already and doesn't need a firewall rule to stay private, but it's worth confirming nothing
else opened a port to `0.0.0.0` along the way:

```bash
sudo ufw default deny incoming
sudo ufw allow 22/tcp    # or your actual SSH port
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ss -tlnp           # sanity check: nothing else should be listening on a non-loopback address
```

Port `80` never serves the app — it only redirects to `443` and answers the ACME challenge
for certificate renewal.

#### Which URLs get exposed

With the setup above, there is exactly one public origin, all on the standard SSL port:

| URL | What serves it |
|-----|-----------------|
| `https://kanban.example.com/` | Apache, serving the built SPA from `frontend/dist` |
| `https://kanban.example.com/api/v1/*` | Apache, reverse-proxied to the backend on `127.0.0.1:8000` |
| `https://kanban.example.com/api/v1/ws` | Same, upgraded to a WebSocket |
| `http://kanban.example.com/` | Redirects to the `https://` origin above (or answers the ACME challenge) |

Nothing else is internet-reachable: the FastAPI backend, PostgreSQL, and the build tooling
all stay on loopback addresses behind Apache.