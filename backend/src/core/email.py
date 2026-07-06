#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from datetime import datetime

from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType

from src.core.config import settings

_conf = ConnectionConfig(
    MAIL_USERNAME=settings.smtp_username,
    MAIL_PASSWORD=settings.smtp_password,
    MAIL_FROM=settings.smtp_from_email,
    MAIL_PORT=settings.smtp_port,
    MAIL_SERVER=settings.smtp_host,
    MAIL_FROM_NAME=settings.smtp_from_name,
    MAIL_STARTTLS=False,
    MAIL_SSL_TLS=True,
    USE_CREDENTIALS=True,
    VALIDATE_CERTS=True,
)

_SUBJECTS: dict[str, str] = {
    "en": "Verify your KanbanMF email address",
    "ca": "Verifica la teva adreça de correu electrònic a KanbanMF",
}

_BODIES: dict[str, str] = {
    "en": """\
Hello {display_name},

Welcome to KanbanMF! Please verify your email address by clicking the link below:

{verify_url}

This link expires in 24 hours.

If you did not create an account, you can safely ignore this email.

Best regards,
The KanbanMF Team
""",
    "ca": """\
Hola {display_name},

Benvingut/da a KanbanMF! Si us plau, verifica la teva adreça de correu electrònic fent clic a l'enllaç de sota:

{verify_url}

Aquest enllaç caduca en 24 hores.

Si no has creat cap compte, pots ignorar aquest correu.

Salutacions,
L'equip de KanbanMF
""",
}


async def send_verification_email(email: str, display_name: str, token: str, language: str = "en") -> None:
    lang = language if language in _BODIES else "en"
    verify_url = f"{settings.frontend_url}/verify-email?token={token}"

    message = MessageSchema(
        subject=_SUBJECTS[lang],
        recipients=[email],
        body=_BODIES[lang].format(display_name=display_name, verify_url=verify_url),
        subtype=MessageType.plain,
    )

    await FastMail(_conf).send_message(message)


_DUE_SUBJECTS: dict[str, str] = {
    "en": 'Reminder: "{card_name}" {phrase}',
    "ca": 'Recordatori: "{card_name}" {phrase}',
}

_DUE_BODIES: dict[str, str] = {
    "en": """\
Hello {display_name},

This is a reminder that your card "{card_name}" on board "{board_name}" {phrase}.

Due date: {due_date}

View the board:
{board_url}

Best regards,
The KanbanMF Team
""",
    "ca": """\
Hola {display_name},

Aquest és un recordatori que la teva tarja "{card_name}" del tauler "{board_name}" {phrase}.

Data de venciment: {due_date}

Consulta el tauler:
{board_url}

Salutacions,
L'equip de KanbanMF
""",
}


def _due_status_phrase(days_diff: int, language: str) -> str:
    """Localized phrase describing how a card relates to today, from days_diff
    (today's local date minus the due date: negative before, 0 on the day,
    positive after)."""
    if language == "ca":
        if days_diff < 0:
            n = abs(days_diff)
            return f"venç d'aquí a {n} dia{'s' if n != 1 else ''}"
        if days_diff == 0:
            return "venç avui"
        return f"porta {days_diff} dia{'s' if days_diff != 1 else ''} de retard"

    if days_diff < 0:
        n = abs(days_diff)
        return f"is due in {n} day{'s' if n != 1 else ''}"
    if days_diff == 0:
        return "is due today"
    return f"is {days_diff} day{'s' if days_diff != 1 else ''} overdue"


async def send_due_date_reminder_email(
    email: str,
    display_name: str,
    card_name: str,
    board_name: str,
    board_id: str,
    due_at: datetime,
    days_diff: int,
    language: str = "en",
) -> None:
    """Send a due-date reminder email for a card to one of its assignees."""
    lang = language if language in _DUE_BODIES else "en"
    phrase = _due_status_phrase(days_diff, lang)
    board_url = f"{settings.frontend_url}/boards/{board_id}"

    message = MessageSchema(
        subject=_DUE_SUBJECTS[lang].format(card_name=card_name, phrase=phrase),
        recipients=[email],
        body=_DUE_BODIES[lang].format(
            display_name=display_name,
            card_name=card_name,
            board_name=board_name,
            phrase=phrase,
            due_date=due_at.strftime("%Y-%m-%d %H:%M %Z"),
            board_url=board_url,
        ),
        subtype=MessageType.plain,
    )

    await FastMail(_conf).send_message(message)
