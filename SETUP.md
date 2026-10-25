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

If you created the remote user, give it read access once the schema exists (after `alembic upgrade head`,
below) — but not to the four tables that hold credentials: password hashes (`user_identities`) and the hashes of
session and OAuth tokens. Run it again after a migration that adds tables (`GRANT ... ON ALL TABLES` covers only
the tables that exist):

```bash
sudo -u postgres psql -p 5445 -d kanbanmf_db <<'SQL'
GRANT CONNECT ON DATABASE kanbanmf_db TO kanbanmf_remoteuser;
GRANT USAGE ON SCHEMA public TO kanbanmf_remoteuser;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO kanbanmf_remoteuser;
REVOKE SELECT ON user_identities, user_sessions, oauth_tokens, oauth_authorization_codes FROM kanbanmf_remoteuser;
SQL
```

The search uses PostgreSQL's `unaccent` extension (it comes with PostgreSQL; nothing to install). The migrations
create it, and since PostgreSQL 13 the database owner — `kanbanmf_user` above — is allowed to, so with this setup
there's nothing to do. With PostgreSQL 12 or older, or a database the application's user doesn't own, create it
once as `postgres` before running the migrations:

```bash
sudo -u postgres psql -p 5445 -d kanbanmf_db -c "CREATE EXTENSION IF NOT EXISTS unaccent;"
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

#### `backend/.env` values that must change for production

The dev defaults in `.env.example` all point at `localhost`. For a real deployment behind
the domain you're putting in the Apache vhost, update these in `backend/.env`:

| Variable               | Production value                                                    |
|-------------------------|----------------------------------------------------------------------|
| `FRONTEND_URL`           | `https://kanban.example.com` — used for CORS, as the post-login redirect target after Google sign-in, and as the OAuth issuer of the MCP server (whose address is `FRONTEND_URL/mcp`), so it must be the exact public `https://` origin, with no trailing slash |
| `SECRET_KEY`             | A real secret: `openssl rand -hex 32` (never reuse the dev one). The backend and Alembic refuse an empty, short (under 32 characters) or example key, so `make deploy` stops at the migration step until it is set |
| `GOOGLE_REDIRECT_URI`    | `https://kanban.example.com/api/v1/auth/google/callback` — must also be added to the authorized redirect URIs for this OAuth client in Google Cloud Console |
| `DATABASE_URL`           | Same PostgreSQL cluster/DB created above, but with production credentials |
| `EMAIL_SENDER`           | Worth setting explicitly, e.g. `Kanban Reminder system <kanban@example.com>` — if the SMTP account you authenticate as (`SMTP_USERNAME`) isn't the address you want recipients to see, leaving `EMAIL_SENDER` blank and falling back to `SMTP_FROM_EMAIL` risks SPF/DKIM misalignment and spam classification |

The frontend itself needs no `backend/.env` of its own: it talks to the API through relative URLs
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

The unit also passes `--ws-max-size 4096`: the app sends only one short message up its
WebSocket (the access token, as it connects; after that it only listens for "something
changed" messages), so there's no reason to let a client make the backend buffer
uvicorn's default of 16 MB per message.

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

Apache adds an `X-Forwarded-For` header with the client's address, and the backend's rate limits
(on sign-in, sign-up and the like) count per address from it: uvicorn trusts that header only from
`127.0.0.1`, its default. Keep the backend listening on `127.0.0.1` behind Apache, as the unit file
does — exposed directly, or behind another proxy, every client would look like the same address or
could choose its own.

Three more paths go to the backend, for the MCP server Claude connects to: `/mcp` itself, and
the two OAuth discovery documents `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`, which the RFCs place at the root of the site. Only
those two under `/.well-known` — certbot's `acme-challenge` must keep being served from disk.

The vhost also sends security headers on every response (they need `mod_headers`, enabled above):
HSTS, `X-Frame-Options: DENY` with CSP `frame-ancestors 'none'` (no other site may frame the app — in
particular the page where users let Claude reach their boards), `nosniff`, `Referrer-Policy: same-origin`,
`Cross-Origin-Opener-Policy`, a `Permissions-Policy` turning off camera, microphone and the like, and a
`Content-Security-Policy` that lets the page run scripts only from this site. **Replace
`kanban.example.com` in the CSP's `wss://` too.** HSTS tells browsers to use only HTTPS for a year: keep
HTTPS working for that long. To hide Apache's version from response headers as well, set
`ServerTokens Prod` in `/etc/apache2/conf-available/security.conf` (it's a server-wide setting). Check the
headers with:

```bash
curl -sI https://kanban.example.com/ | grep -iE 'strict|frame|content-security|nosniff|referrer'
```

`LimitRequestBody 1048576` refuses any request body over 1 MiB with `413` before it reaches the
backend (Apache's own default is 1 GiB). The biggest legitimate body is an avatar (100 KB). The
backend has the same ceiling of its own (`src/core/body_limit.py`), and each text field its own
maximum length. Debian also enables `mod_reqtimeout` by default, which drops clients that send a
request too slowly; leave it on.

Obtain the certificate with certbot's webroot plugin, pointed at the same directory the vhost's
`:80` block serves ACME challenges from:

```bash
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d kanban.example.com
```

If `DocumentRoot` lives under a user's home directory (as in the example config), Apache will
403 with `AH00035: ... search permissions are missing on a component of the path` — Debian's
default home directory mode (`750`) blocks `www-data` from traversing into it at all. Check
exactly which path component is the problem with `namei -l /path/to/frontend/dist`, then grant
*search only* (not read) on each directory from the home dir down to `frontend/`, and
read+traverse recursively on `frontend/dist` itself (that's public content anyway — it's
literally what gets served to browsers):

```bash
chmod o+x /home/kanbanmf /home/kanbanmf/soft /home/kanbanmf/soft/KanbanMF \
          /home/kanbanmf/soft/KanbanMF/frontend
chmod -R o+rX /home/kanbanmf/soft/KanbanMF/frontend/dist
```

Don't `chmod -R` anything higher up the tree than that — `backend/.env` holds the DB password,
`SECRET_KEY`, SMTP password and Google OAuth secret, and must stay unreadable to anyone but the
user the backend runs as.

**Tighter alternative — group instead of other.** `o+x` opens traversal to *every* local
account on the box, not just Apache. Scoping it to a group instead means only the accounts you
explicitly add can reach it — everyone else stays denied:

```bash
# Directories under /home/kanbanmf are owned kanbanmf:kanbanmf (Debian gives
# each user a private group by default) — add www-data as a member of it.
sudo usermod -aG kanbanmf www-data

chmod g+x /home/kanbanmf /home/kanbanmf/soft /home/kanbanmf/soft/KanbanMF \
          /home/kanbanmf/soft/KanbanMF/frontend
chmod -R g+rX /home/kanbanmf/soft/KanbanMF/frontend/dist

# Not `reload` — group membership is read once at process start, and reload
# doesn't re-exec the long-lived master process, so it'd keep the old list.
sudo systemctl restart apache2
```

Either way, also tighten `backend/.env` itself — a directory's `x` bit only gates *reaching* a file;
the file's own permissions decide whether its content can be read once there, and the default
umask leaves a freshly-created `backend/.env` group/world-readable:

```bash
chmod 600 backend/.env
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

#### Connecting Claude (MCP)

Nothing to switch on: once the vhost above is in place, Claude connects to
`https://kanban.example.com/mcp`. Check from anywhere that the discovery documents answer:

```bash
curl https://kanban.example.com/.well-known/oauth-authorization-server   # JSON, issuer = FRONTEND_URL
curl -i -X POST https://kanban.example.com/mcp                           # 401 with WWW-Authenticate
```

- Claude's web, desktop and mobile apps talk to the server from Anthropic's network
  (`160.79.104.0/21`). A firewall, WAF or fail2ban rule in front of Apache must let it reach
  `/mcp`, `/.well-known/oauth-*` and `/api/v1/oauth/*`.
- Claude Code identifies itself with a document on `claude.ai`, which the backend fetches, so
  the server needs outgoing HTTPS. `OAUTH_CIMD_ALLOWED_HOSTS` in `backend/.env` lists the hosts
  such documents may come from (default `claude.ai,claude.com`); there's normally no reason to
  change it.
- Each user connects Claude themselves and chooses which of their own boards it may reach — see
  the user manual's *Connecting Claude* page.

#### Which URLs get exposed

With the setup above, there is exactly one public origin, all on the standard SSL port:

| URL | What serves it |
|-----|-----------------|
| `https://kanban.example.com/` | Apache, serving the built SPA from `frontend/dist` |
| `https://kanban.example.com/api/v1/*` | Apache, reverse-proxied to the backend on `127.0.0.1:8000` |
| `https://kanban.example.com/api/v1/ws` | Same, upgraded to a WebSocket |
| `https://kanban.example.com/mcp` | Apache, reverse-proxied to the backend: the MCP server (needs an OAuth access token) |
| `https://kanban.example.com/.well-known/oauth-*` | Same: the two OAuth discovery documents MCP clients read first |
| `http://kanban.example.com/` | Redirects to the `https://` origin above (or answers the ACME challenge) |

Nothing else is internet-reachable: the FastAPI backend, PostgreSQL, and the build tooling
all stay on loopback addresses behind Apache.