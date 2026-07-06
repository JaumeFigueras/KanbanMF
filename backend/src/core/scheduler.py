#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""In-process hourly scheduler for due-date e-mail notifications.

Runs inside the FastAPI process itself (wired into its lifespan in
src.main) rather than as a separate cron job plus standalone script, so
there is nothing extra to deploy, and it reuses the app's own DB config,
async session factory and e-mail sending code as-is.

If this app is ever scaled to multiple replicas, guard the job body with a
Postgres advisory lock (pg_try_advisory_lock) so only one replica executes
it per tick — with a single replica (the case today) that's unnecessary.
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from src.core.notifications import send_due_date_notifications

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
    scheduler.start()


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
