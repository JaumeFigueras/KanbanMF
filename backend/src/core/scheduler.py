#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""In-process scheduler: hourly due-date e-mail notifications, cleanup
of expired board invitations and of expired OAuth rows, plus the nightly (02:00) rebuild of the time
tracker's usage ranking, which is also built once at startup if it's empty.

Runs inside the FastAPI process itself (wired into its lifespan in
src.main) rather than as a separate cron job plus standalone script, so
there is nothing extra to deploy, and it reuses the app's own DB config,
async session factory and e-mail sending code as-is.

If this app is ever scaled to multiple replicas, guard the job body with a
Postgres advisory lock (pg_try_advisory_lock) so only one replica executes
it per tick — with a single replica (the case today) that's unnecessary.
"""

from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from src.core.invitations import delete_expired_invitations
from src.core.notifications import send_due_date_notifications
from src.core.oauth import delete_expired_oauth_rows
from src.core.time_tracker_ranking import ensure_time_tracker_ranking, rebuild_time_tracker_ranking

scheduler = AsyncIOScheduler()


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        send_due_date_notifications,
        trigger=CronTrigger(minute=0),
        id="due_date_notifications",
        replace_existing=True,
    )
    scheduler.add_job(
        delete_expired_invitations,
        trigger=CronTrigger(minute=30),
        id="expired_invitations_cleanup",
        replace_existing=True,
    )
    scheduler.add_job(
        delete_expired_oauth_rows,
        trigger=CronTrigger(minute=45),
        id="expired_oauth_cleanup",
        replace_existing=True,
    )
    # 02:00 in the server's local time — one ranking snapshot for all users.
    scheduler.add_job(
        rebuild_time_tracker_ranking,
        trigger=CronTrigger(hour=2, minute=0),
        id="time_tracker_ranking",
        replace_existing=True,
    )
    # A one-off run as soon as the scheduler starts, in the background so a
    # slow or failing database never holds up the app's startup.
    scheduler.add_job(
        ensure_time_tracker_ranking,
        next_run_time=datetime.now(),
        id="time_tracker_ranking_initial",
        replace_existing=True,
    )
    scheduler.start()


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
