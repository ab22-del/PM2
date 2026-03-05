"""
Email Service for PropManage
Sends violation and fine notification emails to tenants.
Falls back gracefully when SMTP is not configured (records notification in DB only).
"""

import os
import smtplib
import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from sqlalchemy.orm import Session
from models import Notification


# SMTP Configuration from environment variables
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "noreply@propmanage.com")
SMTP_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Send an email via SMTP. Returns True if successful."""
    if not SMTP_ENABLED:
        print(f"[Email] SMTP not configured. Would send to {to_email}: {subject}")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, to_email, msg.as_string())
        return True
    except Exception as e:
        print(f"[Email] Failed to send email to {to_email}: {e}")
        return False


def send_and_record_email(
    db: Session,
    user_id: int,
    property_id: Optional[int],
    to_email: str,
    subject: str,
    html_body: str,
) -> Notification:
    """Send an email and record it as a notification in the database."""
    sent = _send_email(to_email, subject, html_body)

    notif = Notification(
        user_id=user_id,
        property_id=property_id,
        type="email",
        recipient_email=to_email,
        subject=subject,
        message=html_body[:500],  # Store truncated version
        status="sent" if sent else "recorded",
        sent_at=datetime.datetime.utcnow() if sent else None,
    )
    db.add(notif)
    db.commit()
    return notif


def send_violation_email(
    db: Session,
    user_id: int,
    property_id: int,
    to_email: str,
    tenant_name: str,
    property_name: str,
    violation_type: str,
    description: str,
    violation_date: str,
) -> Notification:
    """Send a violation notice email to a tenant."""
    subject = f"Parking Violation Notice - {property_name}"
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">PropManage</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Property Management Platform</p>
        </div>
        <div style="border: 1px solid #E5E7EB; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
            <h2 style="color: #DC2626; margin-top: 0;">Violation Notice</h2>
            <p>Dear {tenant_name},</p>
            <p>This is to inform you that a <strong>{violation_type}</strong> violation has been recorded against your account at <strong>{property_name}</strong>.</p>
            <div style="background: #FEF2F2; border-left: 4px solid #DC2626; padding: 16px; margin: 16px 0; border-radius: 4px;">
                <p style="margin: 0; font-weight: 600; color: #991B1B;">Violation Details:</p>
                <p style="margin: 8px 0 0; color: #7F1D1D;">{description}</p>
                <p style="margin: 8px 0 0; font-size: 14px; color: #991B1B;">Date: {violation_date}</p>
            </div>
            <p>Your property manager will review this violation and determine the appropriate action. You may be subject to a fine as outlined in your lease agreement.</p>
            <p>If you have questions, please contact your property manager.</p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;">
            <p style="font-size: 12px; color: #9CA3AF;">This is an automated message from PropManage. Please do not reply to this email.</p>
        </div>
    </body>
    </html>
    """
    return send_and_record_email(db, user_id, property_id, to_email, subject, html_body)


def send_fine_email(
    db: Session,
    user_id: int,
    property_id: int,
    to_email: str,
    tenant_name: str,
    property_name: str,
    fine_amount: float,
    reason: str,
    violation_description: str,
) -> Notification:
    """Send a fine notice email to a tenant."""
    subject = f"Fine Notice - ${fine_amount:.2f} - {property_name}"
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">PropManage</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Property Management Platform</p>
        </div>
        <div style="border: 1px solid #E5E7EB; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
            <h2 style="color: #DC2626; margin-top: 0;">Fine Notice</h2>
            <p>Dear {tenant_name},</p>
            <p>A fine has been issued on your account at <strong>{property_name}</strong>.</p>
            <div style="background: #FEF2F2; border-left: 4px solid #DC2626; padding: 16px; margin: 16px 0; border-radius: 4px;">
                <p style="margin: 0; font-size: 28px; font-weight: 800; color: #DC2626;">${fine_amount:.2f}</p>
                <p style="margin: 8px 0 0; font-weight: 600; color: #991B1B;">Reason:</p>
                <p style="margin: 4px 0 0; color: #7F1D1D;">{reason}</p>
                <p style="margin: 8px 0 0; font-weight: 600; color: #991B1B;">Original Violation:</p>
                <p style="margin: 4px 0 0; color: #7F1D1D;">{violation_description}</p>
            </div>
            <p>Please contact your property manager to arrange payment or if you wish to dispute this fine.</p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;">
            <p style="font-size: 12px; color: #9CA3AF;">This is an automated message from PropManage. Please do not reply to this email.</p>
        </div>
    </body>
    </html>
    """
    return send_and_record_email(db, user_id, property_id, to_email, subject, html_body)
