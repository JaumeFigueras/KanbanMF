#!/usr/bin/env python3
# -*- coding: utf-8 -*-

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
