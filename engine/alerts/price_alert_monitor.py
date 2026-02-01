"""
Price Alert Monitor

Monitors prices and triggers alerts when conditions are met.
Supports various alert types: above/below, percentage change, volume spike.
"""

import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict, field
from enum import Enum


# Storage path
PRICE_ALERTS_PATH = Path(__file__).parent / "price_alerts.json"


class PriceAlertType(Enum):
    ABOVE = "above"  # Price crosses above threshold
    BELOW = "below"  # Price crosses below threshold
    CHANGE_UP = "change_up"  # Price increases by %
    CHANGE_DOWN = "change_down"  # Price decreases by %
    LEVEL_BREAK = "level_break"  # Breaks technical level
    VOLUME_SPIKE = "volume_spike"  # Unusual volume


@dataclass
class PriceAlert:
    """Price alert condition"""
    id: str
    user_id: str
    symbol: str
    market: str
    alert_type: str  # PriceAlertType value
    threshold: float  # Price or percentage
    reference_price: Optional[float] = None  # For % changes
    enabled: bool = True
    repeating: bool = False  # One-time or repeating
    cooldown_minutes: int = 60
    notification_channels: List[str] = field(default_factory=lambda: ["telegram", "in_app"])
    created_at: str = ""
    last_triggered: Optional[str] = None
    trigger_count: int = 0

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now().isoformat()

    def check_condition(self, current_price: float, current_volume: Optional[float] = None) -> bool:
        """Check if alert condition is met"""
        if not self.enabled:
            return False

        # Check cooldown for repeating alerts
        if self.last_triggered:
            if not self.repeating:
                return False  # One-time alert already triggered

            last_time = datetime.fromisoformat(self.last_triggered)
            minutes_since = (datetime.now() - last_time).total_seconds() / 60
            if minutes_since < self.cooldown_minutes:
                return False  # Still in cooldown

        # Check condition based on type
        alert_type = PriceAlertType(self.alert_type)

        if alert_type == PriceAlertType.ABOVE:
            return current_price >= self.threshold

        elif alert_type == PriceAlertType.BELOW:
            return current_price <= self.threshold

        elif alert_type == PriceAlertType.CHANGE_UP:
            if not self.reference_price or self.reference_price == 0:
                return False
            change_pct = ((current_price - self.reference_price) / self.reference_price) * 100
            return change_pct >= self.threshold

        elif alert_type == PriceAlertType.CHANGE_DOWN:
            if not self.reference_price or self.reference_price == 0:
                return False
            change_pct = ((self.reference_price - current_price) / self.reference_price) * 100
            return change_pct >= self.threshold

        elif alert_type == PriceAlertType.VOLUME_SPIKE:
            if not current_volume:
                return False
            # Threshold is multiplier (e.g., 2.0 = 2x normal)
            # Would need average volume to compare
            return False

        return False

    def to_dict(self) -> dict:
        """Convert to dictionary for API response"""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "PriceAlert":
        """Create from dictionary"""
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


class PriceAlertStore:
    """Persistent storage for price alerts"""

    def __init__(self, path: Path = PRICE_ALERTS_PATH):
        self.path = path
        self._alerts: Dict[str, PriceAlert] = {}  # id -> alert
        self._by_symbol: Dict[str, List[str]] = {}  # symbol -> [alert_ids]
        self._load()

    def _load(self):
        """Load alerts from file"""
        if self.path.exists():
            try:
                with open(self.path, "r") as f:
                    data = json.load(f)
                    for alert_data in data.get("alerts", []):
                        alert = PriceAlert.from_dict(alert_data)
                        self._alerts[alert.id] = alert
                        if alert.symbol not in self._by_symbol:
                            self._by_symbol[alert.symbol] = []
                        self._by_symbol[alert.symbol].append(alert.id)
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                print(f"Error loading price alerts: {e}")

    def _save(self):
        """Save alerts to file"""
        data = {
            "alerts": [a.to_dict() for a in self._alerts.values()],
            "updated_at": datetime.now().isoformat()
        }
        with open(self.path, "w") as f:
            json.dump(data, f, indent=2)

    def add(self, alert: PriceAlert) -> PriceAlert:
        """Add a new alert"""
        self._alerts[alert.id] = alert
        if alert.symbol not in self._by_symbol:
            self._by_symbol[alert.symbol] = []
        self._by_symbol[alert.symbol].append(alert.id)
        self._save()
        return alert

    def get(self, alert_id: str) -> Optional[PriceAlert]:
        """Get alert by ID"""
        return self._alerts.get(alert_id)

    def get_by_symbol(self, symbol: str) -> List[PriceAlert]:
        """Get all alerts for a symbol"""
        alert_ids = self._by_symbol.get(symbol, [])
        return [self._alerts[aid] for aid in alert_ids if aid in self._alerts]

    def get_by_user(self, user_id: str) -> List[PriceAlert]:
        """Get all alerts for a user"""
        return [a for a in self._alerts.values() if a.user_id == user_id]

    def get_all(self) -> List[PriceAlert]:
        """Get all alerts"""
        return list(self._alerts.values())

    def update(self, alert: PriceAlert) -> PriceAlert:
        """Update an alert"""
        self._alerts[alert.id] = alert
        self._save()
        return alert

    def delete(self, alert_id: str) -> bool:
        """Delete an alert"""
        if alert_id not in self._alerts:
            return False

        alert = self._alerts[alert_id]
        del self._alerts[alert_id]

        if alert.symbol in self._by_symbol:
            self._by_symbol[alert.symbol] = [
                aid for aid in self._by_symbol[alert.symbol] if aid != alert_id
            ]

        self._save()
        return True


class PriceAlertMonitor:
    """Monitor prices and trigger alerts"""

    def __init__(self):
        self.store = PriceAlertStore()
        self._notification_callbacks: List[callable] = []

    def register_notification_callback(self, callback: callable):
        """Register callback for when alerts trigger"""
        self._notification_callbacks.append(callback)

    def add_alert(self, alert: PriceAlert) -> PriceAlert:
        """Add alert to monitor"""
        return self.store.add(alert)

    def get_alert(self, alert_id: str) -> Optional[PriceAlert]:
        """Get alert by ID"""
        return self.store.get(alert_id)

    def get_alerts_for_symbol(self, symbol: str) -> List[PriceAlert]:
        """Get all alerts for a symbol"""
        return self.store.get_by_symbol(symbol)

    def get_alerts_for_user(self, user_id: str) -> List[PriceAlert]:
        """Get all alerts for a user"""
        return self.store.get_by_user(user_id)

    def update_alert(self, alert: PriceAlert) -> PriceAlert:
        """Update an alert"""
        return self.store.update(alert)

    def delete_alert(self, alert_id: str) -> bool:
        """Delete an alert"""
        return self.store.delete(alert_id)

    async def check_price(
        self,
        symbol: str,
        price: float,
        volume: Optional[float] = None
    ) -> List[PriceAlert]:
        """Check all alerts for a symbol against current price"""
        alerts = self.store.get_by_symbol(symbol)
        triggered_alerts = []

        for alert in alerts:
            if alert.check_condition(price, volume):
                # Alert triggered!
                alert.last_triggered = datetime.now().isoformat()
                alert.trigger_count += 1

                # Disable if one-time
                if not alert.repeating:
                    alert.enabled = False

                self.store.update(alert)
                triggered_alerts.append(alert)

                # Create and send notification
                notification = self.create_notification(alert, price)

                # Call registered callbacks
                for callback in self._notification_callbacks:
                    try:
                        import asyncio
                        if asyncio.iscoroutinefunction(callback):
                            await callback(notification, alert)
                        else:
                            callback(notification, alert)
                    except Exception as e:
                        print(f"Notification callback error: {e}")

        return triggered_alerts

    def create_notification(self, alert: PriceAlert, current_price: float) -> dict:
        """Create notification message for triggered price alert"""
        symbol = alert.symbol
        alert_type = PriceAlertType(alert.alert_type)

        # Format price based on market
        if alert.market == "KR":
            price_fmt = f"{current_price:,.0f}원"
            threshold_fmt = f"{alert.threshold:,.0f}원"
        else:
            price_fmt = f"${current_price:,.2f}"
            threshold_fmt = f"${alert.threshold:,.2f}"

        # Title and body based on alert type
        if alert_type == PriceAlertType.ABOVE:
            title = f"🚀 {symbol} 목표가 도달!"
            body = f"현재가 {price_fmt}\n설정가 {threshold_fmt} 이상 도달"
            emoji = "🟢"

        elif alert_type == PriceAlertType.BELOW:
            title = f"⚠️ {symbol} 지지선 이탈!"
            body = f"현재가 {price_fmt}\n설정가 {threshold_fmt} 이하 하락"
            emoji = "🔴"

        elif alert_type == PriceAlertType.CHANGE_UP:
            if alert.reference_price:
                change = ((current_price - alert.reference_price) / alert.reference_price) * 100
                title = f"📈 {symbol} +{change:.1f}% 상승!"
                body = f"기준가 대비 {alert.threshold}% 이상 상승\n현재가: {price_fmt}"
            else:
                title = f"📈 {symbol} 상승 알림"
                body = f"현재가: {price_fmt}"
            emoji = "🟢"

        elif alert_type == PriceAlertType.CHANGE_DOWN:
            if alert.reference_price:
                change = ((alert.reference_price - current_price) / alert.reference_price) * 100
                title = f"📉 {symbol} -{change:.1f}% 하락!"
                body = f"기준가 대비 {alert.threshold}% 이상 하락\n현재가: {price_fmt}"
            else:
                title = f"📉 {symbol} 하락 알림"
                body = f"현재가: {price_fmt}"
            emoji = "🔴"

        else:
            title = f"🔔 {symbol} 가격 알림"
            body = f"현재가: {price_fmt}"
            emoji = "📊"

        return {
            "id": f"price_{alert.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "user_id": alert.user_id,
            "symbol": symbol,
            "market": alert.market,
            "title": title,
            "body": body,
            "emoji": emoji,
            "signal_type": "price_alert",
            "confidence": 100.0,
            "timestamp": datetime.now().isoformat(),
            "data": {
                "alert_id": alert.id,
                "alert_type": alert.alert_type,
                "threshold": alert.threshold,
                "reference_price": alert.reference_price,
                "current_price": current_price
            }
        }


# Global monitor instance
_price_monitor: Optional[PriceAlertMonitor] = None


def get_price_monitor() -> PriceAlertMonitor:
    """Get or create the global price monitor"""
    global _price_monitor
    if _price_monitor is None:
        _price_monitor = PriceAlertMonitor()
    return _price_monitor
