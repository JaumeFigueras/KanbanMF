Production environment
======================

.. todo::

   **How to deploy it for real.** Planned contents:

   - Target platform: Debian, systemd, Apache as a reverse proxy, a dedicated
     PostgreSQL cluster.
   - Database cluster and role creation; running the migrations.
   - Building the frontend and where the static bundle is served from; why the
     frontend and API share a single origin.
   - The systemd unit and the Apache vhost, both adapted from ``deploy/``.
   - TLS, the WebSocket upgrade through the proxy, and the reverse-proxy
     headers the backend expects.
   - Production ``.env``: secrets, SMTP, Google OAuth redirect URIs.
   - Upgrading a running deployment, and backups.

   Source material: ``SETUP.md`` and ``deploy/`` at the repository root — fold
   them in here rather than maintaining two copies.
