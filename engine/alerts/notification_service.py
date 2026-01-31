"""
Notification Service

Handles sending notifications via multiple channels:
- Telegram (existing)
- Web Push (new)
- Email (new)
- In-app notifications (new)
"""

import os
import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict, field
import httpx

from .alert_evaluator import AlertNotification, AlertCondition


# In-app notifications storage
NOTIFICATIONS_PATH = Path(__file__).parent / "in_app_notifications.json"


@dataclass
class InAppNotification:
    """In-app notification with read status"""
    id: str
    user_id: str
    symbol: str
    market: str
    title: str
    body: str
    emoji: str
    signal_type: str
    confidence: float
    timestamp: str
    read: bool = False
    dismissed: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


class InAppNotificationStore:
    """Stores in-app notifications"""

    def __init__(self, path: Path = NOTIFICATIONS_PATH):
        self.path = path
        self._notifications: List[InAppNotification] = []
        self._load()

    def _load(self):
        """Load from file"""
        if self.path.exists():
            try:
                with open(self.path, "r") as f:
                    data = json.load(f)
                    for n_data in data.get("notifications", []):
                        self._notifications.append(InAppNotification(**n_data))
            except (json.JSONDecodeError, KeyError, TypeError):
                pass

    def _save(self):
        """Save to file (keep last 200)"""
        recent = self._notifications[-200:]
        with open(self.path, "w") as f:
            json.dump({
                "notifications": [n.to_dict() for n in recent],
                "updated_at": datetime.now().isoformat()
            }, f, indent=2)

    def add(self, notification: InAppNotification):
        """Add a notification"""
        self._notifications.append(notification)
        self._save()

    def get_unread(self, user_id: str) -> List[InAppNotification]:
        """Get unread notifications for a user"""
        return [
            n for n in self._notifications
            if n.user_id == user_id and not n.read and not n.dismissed
        ]

    def get_all(self, user_id: str, limit: int = 50) -> List[InAppNotification]:
        """Get all notifications for a user"""
        return [n for n in self._notifications if n.user_id == user_id][-limit:]

    def mark_read(self, notification_id: str) -> bool:
        """Mark a notification as read"""
        for n in self._notifications:
            if n.id == notification_id:
                n.read = True
                self._save()
                return True
        return False

    def mark_all_read(self, user_id: str) -> int:
        """Mark all notifications as read for a user"""
        count = 0
        for n in self._notifications:
            if n.user_id == user_id and not n.read:
                n.read = True
                count += 1
        if count > 0:
            self._save()
        return count

    def dismiss(self, notification_id: str) -> bool:
        """Dismiss a notification"""
        for n in self._notifications:
            if n.id == notification_id:
                n.dismissed = True
                self._save()
                return True
        return False


class TelegramService:
    """Telegram notification service"""

    def __init__(self, token: Optional[str] = None, chat_id: Optional[str] = None):
        # Use environment variables or defaults
        self.token = token or os.getenv("TELEGRAM_BOT_TOKEN", "8299375257:AAGinhkj6V6qkHhGFXVq4y7Wiea4FfI_rz4")
        self.chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID", "5039747841")
        self.base_url = f"https://api.telegram.org/bot{self.token}"

    async def send(self, notification: AlertNotification) -> bool:
        """Send notification via Telegram"""
        message = f"{notification.emoji} <b>{notification.title}</b>\n\n{notification.body}"

        url = f"{self.base_url}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": message,
            "parse_mode": "HTML"
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload)
                return response.status_code == 200
        except Exception as e:
            print(f"Telegram send error: {e}")
            return False


class WebPushService:
    """Web Push notification service"""

    def __init__(self):
        self.vapid_private_key = os.getenv("VAPID_PRIVATE_KEY")
        self.vapid_claims = {
            "sub": f"mailto:{os.getenv('VAPID_EMAIL', 'admin@liquidityhunter.com')}"
        }
        # In-memory subscription store (would normally be in database)
        self._subscriptions: Dict[str, dict] = {}

    def register_subscription(self, user_id: str, subscription: dict):
        """Register a push subscription for a user"""
        self._subscriptions[user_id] = subscription

    def get_subscription(self, user_id: str) -> Optional[dict]:
        """Get push subscription for a user"""
        return self._subscriptions.get(user_id)

    async def send(self, user_id: str, notification: AlertNotification) -> bool:
        """Send web push notification"""
        subscription = self.get_subscription(user_id)
        if not subscription:
            return False

        if not self.vapid_private_key:
            print("VAPID_PRIVATE_KEY not configured")
            return False

        try:
            # Web Push requires pywebpush library
            from pywebpush import webpush, WebPushException

            payload = json.dumps({
                "title": notification.title,
                "body": notification.body[:100],
                "icon": "/logo.png",
                "badge": "/badge.png",
                "data": {
                    "symbol": notification.symbol,
                    "signal_type": notification.signal_type,
                    "url": f"/chart/{notification.symbol}"
                }
            })

            webpush(
                subscription_info=subscription,
                data=payload,
                vapid_private_key=self.vapid_private_key,
                vapid_claims=self.vapid_claims
            )
            return True

        except ImportError:
            print("pywebpush not installed - skipping web push")
            return False
        except Exception as e:
            print(f"Web push error: {e}")
            return False


class EmailService:
    """Email notification service"""

    def __init__(self):
        self.smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", 587))
        self.smtp_user = os.getenv("SMTP_USER")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.from_email = os.getenv("FROM_EMAIL", "alerts@liquidityhunter.com")
        # In-memory email store (would normally be in database)
        self._user_emails: Dict[str, str] = {}

    def register_email(self, user_id: str, email: str):
        """Register email for a user"""
        self._user_emails[user_id] = email

    def get_email(self, user_id: str) -> Optional[str]:
        """Get email for a user"""
        return self._user_emails.get(user_id)

    async def send(self, user_id: str, notification: AlertNotification) -> bool:
        """Send email notification"""
        user_email = self.get_email(user_id)
        if not user_email:
            return False

        if not self.smtp_user or not self.smtp_password:
            print("SMTP credentials not configured")
            return False

        try:
            import aiosmtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            msg = MIMEMultipart("alternative")
            msg["Subject"] = notification.title
            msg["From"] = f"LiquidityHunter <{self.from_email}>"
            msg["To"] = user_email

            # Plain text version
            text_body = f"{notification.title}\n\n{notification.body}"

            # HTML version
            html_body = f"""
            <html>
              <body style="font-family: Arial, sans-serif; background: #1a1a2e; color: #eee; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #4ade80;">{notification.emoji} {notification.title}</h2>
                  <div style="background: #16213e; padding: 15px; border-radius: 8px; border-left: 4px solid #4ade80;">
                    <pre style="white-space: pre-wrap; color: #eee; margin: 0;">{notification.body}</pre>
                  </div>
                  <p style="margin-top: 20px;">
                    <a href="https://liquidityhunter.com/chart/{notification.symbol}"
                       style="background: #4ade80; color: #1a1a2e; padding: 12px 24px;
                              text-decoration: none; border-radius: 6px; display: inline-block;
                              font-weight: bold;">
                      차트 보기
                    </a>
                  </p>
                  <p style="color: #888; font-size: 12px; margin-top: 30px;">
                    LiquidityHunter AI Trading Alerts
                  </p>
                </div>
              </body>
            </html>
            """

            msg.attach(MIMEText(text_body, "plain"))
            msg.attach(MIMEText(html_body, "html"))

            await aiosmtplib.send(
                msg,
                hostname=self.smtp_host,
                port=self.smtp_port,
                username=self.smtp_user,
                password=self.smtp_password,
                use_tls=True
            )
            return True

        except ImportError:
            print("aiosmtplib not installed - skipping email")
            return False
        except Exception as e:
            print(f"Email send error: {e}")
            return False


class NotificationService:
    """
    Master notification service that coordinates all channels.
    """

    def __init__(self):
        self.telegram = TelegramService()
        self.web_push = WebPushService()
        self.email = EmailService()
        self.in_app_store = InAppNotificationStore()

    async def send_notification(
        self,
        notification: AlertNotification,
        condition: AlertCondition
    ) -> Dict[str, bool]:
        """
        Send notification via all enabled channels.

        Args:
            notification: The notification to send
            condition: The condition that triggered it (contains channel preferences)

        Returns:
            Dictionary of channel -> success status
        """
        results = {}
        tasks = []

        # In-app (always save)
        if condition.in_app:
            in_app = InAppNotification(
                id=notification.id,
                user_id=notification.user_id,
                symbol=notification.symbol,
                market=notification.market,
                title=notification.title,
                body=notification.body,
                emoji=notification.emoji,
                signal_type=notification.signal_type,
                confidence=notification.confidence,
                timestamp=notification.timestamp
            )
            self.in_app_store.add(in_app)
            results["in_app"] = True

        # Telegram
        if condition.telegram:
            tasks.append(("telegram", self.telegram.send(notification)))

        # Web Push
        if condition.web_push:
            tasks.append(("web_push", self.web_push.send(notification.user_id, notification)))

        # Email
        if condition.email:
            tasks.append(("email", self.email.send(notification.user_id, notification)))

        # Execute all channel sends in parallel
        if tasks:
            channel_results = await asyncio.gather(
                *[t[1] for t in tasks],
                return_exceptions=True
            )
            for (channel, _), result in zip(tasks, channel_results):
                if isinstance(result, Exception):
                    results[channel] = False
                else:
                    results[channel] = result

        return results

    def get_unread_notifications(self, user_id: str) -> List[InAppNotification]:
        """Get unread in-app notifications"""
        return self.in_app_store.get_unread(user_id)

    def get_all_notifications(self, user_id: str, limit: int = 50) -> List[InAppNotification]:
        """Get all in-app notifications for a user"""
        return self.in_app_store.get_all(user_id, limit)

    def mark_notification_read(self, notification_id: str) -> bool:
        """Mark a notification as read"""
        return self.in_app_store.mark_read(notification_id)

    def mark_all_read(self, user_id: str) -> int:
        """Mark all notifications as read"""
        return self.in_app_store.mark_all_read(user_id)

    def dismiss_notification(self, notification_id: str) -> bool:
        """Dismiss a notification"""
        return self.in_app_store.dismiss(notification_id)

    def register_push_subscription(self, user_id: str, subscription: dict):
        """Register web push subscription"""
        self.web_push.register_subscription(user_id, subscription)

    def register_email(self, user_id: str, email: str):
        """Register email for user"""
        self.email.register_email(user_id, email)


# Global instance
_notification_service: Optional[NotificationService] = None


def get_notification_service() -> NotificationService:
    """Get or create the global notification service"""
    global _notification_service
    if _notification_service is None:
        _notification_service = NotificationService()
    return _notification_service
