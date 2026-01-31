"""Telegram Alert Bot for OB Retest Signals."""

import json
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, field, asdict
import httpx


# Config file path
CONFIG_PATH = Path(__file__).parent / "config.json"


@dataclass
class AlertSettings:
    """Alert configuration settings."""
    enabled: bool = True
    min_confluence: int = 80
    alert_types: List[str] = field(default_factory=lambda: ["retest", "new_ob", "breakout"])
    cooldown_minutes: int = 15

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "AlertSettings":
        return cls(
            enabled=data.get("enabled", True),
            min_confluence=data.get("min_confluence", 80),
            alert_types=data.get("alert_types", ["retest", "new_ob", "breakout"]),
            cooldown_minutes=data.get("cooldown_minutes", 15),
        )


def load_settings() -> AlertSettings:
    """Load settings from config file."""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                data = json.load(f)
                return AlertSettings.from_dict(data)
        except (json.JSONDecodeError, KeyError):
            pass
    return AlertSettings()


def save_settings(settings: AlertSettings) -> None:
    """Save settings to config file."""
    with open(CONFIG_PATH, "w") as f:
        json.dump(settings.to_dict(), f, indent=2)


class TelegramAlertBot:
    """Telegram bot for sending trading alerts."""

    def __init__(self):
        self.token = "8299375257:AAGinhkj6V6qkHhGFXVq4y7Wiea4FfI_rz4"
        self.chat_id = "5039747841"
        self.base_url = f"https://api.telegram.org/bot{self.token}"

        # Cooldown tracking: {symbol: last_alert_time}
        self._alert_history: Dict[str, datetime] = {}

        # Settings
        self.settings = load_settings()

    def reload_settings(self) -> AlertSettings:
        """Reload settings from config file."""
        self.settings = load_settings()
        return self.settings

    def is_on_cooldown(self, symbol: str, market: str) -> bool:
        """Check if symbol is on alert cooldown."""
        key = f"{market}:{symbol}"
        if key not in self._alert_history:
            return False

        last_alert = self._alert_history[key]
        cooldown = timedelta(minutes=self.settings.cooldown_minutes)
        return datetime.now() - last_alert < cooldown

    def mark_alerted(self, symbol: str, market: str) -> None:
        """Mark symbol as recently alerted."""
        key = f"{market}:{symbol}"
        self._alert_history[key] = datetime.now()

    async def send_message(self, message: str, parse_mode: str = "HTML") -> bool:
        """Send a message via Telegram."""
        url = f"{self.base_url}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": message,
            "parse_mode": parse_mode,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload)
                return response.status_code == 200
        except Exception as e:
            print(f"Telegram send error: {e}")
            return False

    def send_message_sync(self, message: str, parse_mode: str = "HTML") -> bool:
        """Synchronous version of send_message."""
        url = f"{self.base_url}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": message,
            "parse_mode": parse_mode,
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.post(url, json=payload)
                return response.status_code == 200
        except Exception as e:
            print(f"Telegram send error: {e}")
            return False

    def format_retest_alert(
        self,
        symbol: str,
        market: str,
        direction: str,
        zone_top: float,
        zone_bottom: float,
        score: int,
        price: float,
        volume_confirm: float = 0.0,
    ) -> str:
        """Format a retest alert message."""
        emoji = "🟢 LONG" if direction == "bull" else "🔴 SHORT"

        # Format price based on market
        if market == "KR":
            price_fmt = f"₩{price:,.0f}"
            zone_top_fmt = f"₩{zone_top:,.0f}"
            zone_bottom_fmt = f"₩{zone_bottom:,.0f}"
        else:
            price_fmt = f"${price:,.2f}"
            zone_top_fmt = f"${zone_top:,.2f}"
            zone_bottom_fmt = f"${zone_bottom:,.2f}"

        return f"""
{emoji} <b>OB Retest Alert!</b>

📈 <b>{symbol}</b> ({market})
방향: {direction.upper()}
OB 존: {zone_bottom_fmt} - {zone_top_fmt}
컨플루언스: {score}점
현재가: {price_fmt}
거래량 확인: {volume_confirm:.2f}x

⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
"""

    def format_test_alert(self) -> str:
        """Format a test alert message."""
        return f"""
✅ <b>LiquidityHunter 알림 테스트</b>

텔레그램 알림이 정상적으로 연결되었습니다!

설정:
- 최소 컨플루언스: {self.settings.min_confluence}점
- 쿨다운: {self.settings.cooldown_minutes}분
- 활성화됨: {'예' if self.settings.enabled else '아니오'}

⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
"""

    async def send_retest_alert(
        self,
        symbol: str,
        market: str,
        direction: str,
        zone_top: float,
        zone_bottom: float,
        score: int,
        price: float,
        volume_confirm: float = 0.0,
    ) -> bool:
        """Send a retest alert if conditions are met."""
        # Check if alerts are enabled
        if not self.settings.enabled:
            return False

        # Check minimum confluence
        if score < self.settings.min_confluence:
            return False

        # Check cooldown
        if self.is_on_cooldown(symbol, market):
            return False

        # Format and send
        message = self.format_retest_alert(
            symbol, market, direction, zone_top, zone_bottom,
            score, price, volume_confirm
        )

        success = await self.send_message(message)

        if success:
            self.mark_alerted(symbol, market)

        return success

    async def send_test_alert(self) -> bool:
        """Send a test alert."""
        message = self.format_test_alert()
        return await self.send_message(message)


# Global bot instance
_bot_instance: Optional[TelegramAlertBot] = None


def get_bot() -> TelegramAlertBot:
    """Get or create the global bot instance."""
    global _bot_instance
    if _bot_instance is None:
        _bot_instance = TelegramAlertBot()
    return _bot_instance
