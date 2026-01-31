"""
Alert Condition Evaluator

Evaluates AI signals against user-defined conditions and triggers notifications.
"""

import json
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict, field

from .ai_signal_detector import AISignal, SignalType


# Storage paths
ALERT_CONDITIONS_PATH = Path(__file__).parent / "alert_conditions.json"
ALERT_HISTORY_PATH = Path(__file__).parent / "alert_history.json"


@dataclass
class AlertCondition:
    """User-defined alert condition"""
    id: str
    user_id: str
    symbol: str  # "*" for all symbols
    min_confidence: float = 70.0
    min_consensus: int = 2  # 2/3 or 3/3
    require_pattern: bool = False  # Require OB or FVG
    signal_types: List[str] = field(default_factory=lambda: ["strong_buy", "strong_sell"])
    enabled: bool = True

    # Notification channels
    telegram: bool = True
    web_push: bool = False
    email: bool = False
    in_app: bool = True

    # Cooldown in minutes
    cooldown_minutes: int = 30

    # Created/updated timestamps
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now().isoformat()
        if not self.updated_at:
            self.updated_at = datetime.now().isoformat()

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "AlertCondition":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class AlertNotification:
    """Generated notification from an alert"""
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
    data: Optional[dict] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AlertHistoryEntry:
    """Historical record of triggered alerts"""
    notification_id: str
    condition_id: str
    symbol: str
    market: str
    signal_type: str
    timestamp: str
    channels_sent: List[str] = field(default_factory=list)


class AlertConditionStore:
    """Manages alert conditions storage"""

    def __init__(self, path: Path = ALERT_CONDITIONS_PATH):
        self.path = path
        self._conditions: Dict[str, AlertCondition] = {}
        self._load()

    def _load(self):
        """Load conditions from file"""
        if self.path.exists():
            try:
                with open(self.path, "r") as f:
                    data = json.load(f)
                    for cond_data in data.get("conditions", []):
                        cond = AlertCondition.from_dict(cond_data)
                        self._conditions[cond.id] = cond
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Error loading alert conditions: {e}")

    def _save(self):
        """Save conditions to file"""
        data = {
            "conditions": [c.to_dict() for c in self._conditions.values()],
            "updated_at": datetime.now().isoformat()
        }
        with open(self.path, "w") as f:
            json.dump(data, f, indent=2)

    def get(self, condition_id: str) -> Optional[AlertCondition]:
        return self._conditions.get(condition_id)

    def get_all(self) -> List[AlertCondition]:
        return list(self._conditions.values())

    def get_by_user(self, user_id: str) -> List[AlertCondition]:
        return [c for c in self._conditions.values() if c.user_id == user_id]

    def get_by_symbol(self, symbol: str) -> List[AlertCondition]:
        """Get conditions matching a symbol (including wildcards)"""
        return [
            c for c in self._conditions.values()
            if c.enabled and (c.symbol == "*" or c.symbol == symbol)
        ]

    def add(self, condition: AlertCondition) -> AlertCondition:
        self._conditions[condition.id] = condition
        self._save()
        return condition

    def update(self, condition: AlertCondition) -> AlertCondition:
        condition.updated_at = datetime.now().isoformat()
        self._conditions[condition.id] = condition
        self._save()
        return condition

    def delete(self, condition_id: str) -> bool:
        if condition_id in self._conditions:
            del self._conditions[condition_id]
            self._save()
            return True
        return False


class AlertHistoryStore:
    """Manages alert history storage"""

    def __init__(self, path: Path = ALERT_HISTORY_PATH):
        self.path = path
        self._history: List[AlertHistoryEntry] = []
        self._cooldowns: Dict[str, datetime] = {}  # symbol:condition_id -> last_alert_time
        self._load()

    def _load(self):
        """Load history from file"""
        if self.path.exists():
            try:
                with open(self.path, "r") as f:
                    data = json.load(f)
                    for entry_data in data.get("history", []):
                        entry = AlertHistoryEntry(**entry_data)
                        self._history.append(entry)
                        # Rebuild cooldowns
                        key = f"{entry.symbol}:{entry.condition_id}"
                        entry_time = datetime.fromisoformat(entry.timestamp)
                        if key not in self._cooldowns or entry_time > self._cooldowns[key]:
                            self._cooldowns[key] = entry_time
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                print(f"Error loading alert history: {e}")

    def _save(self):
        """Save history to file (keep last 1000 entries)"""
        recent_history = self._history[-1000:]
        data = {
            "history": [asdict(e) for e in recent_history],
            "updated_at": datetime.now().isoformat()
        }
        with open(self.path, "w") as f:
            json.dump(data, f, indent=2)

    def is_on_cooldown(self, symbol: str, condition_id: str, cooldown_minutes: int) -> bool:
        """Check if a symbol/condition is on cooldown"""
        key = f"{symbol}:{condition_id}"
        if key not in self._cooldowns:
            return False

        last_alert = self._cooldowns[key]
        cooldown = timedelta(minutes=cooldown_minutes)
        return datetime.now() - last_alert < cooldown

    def add_entry(self, entry: AlertHistoryEntry):
        """Add a history entry and update cooldown"""
        self._history.append(entry)
        key = f"{entry.symbol}:{entry.condition_id}"
        self._cooldowns[key] = datetime.now()
        self._save()

    def get_recent(self, limit: int = 50) -> List[AlertHistoryEntry]:
        """Get recent history entries"""
        return self._history[-limit:]

    def get_by_symbol(self, symbol: str, limit: int = 20) -> List[AlertHistoryEntry]:
        """Get history for a specific symbol"""
        return [e for e in self._history if e.symbol == symbol][-limit:]


def should_trigger_alert(signal: AISignal, condition: AlertCondition) -> bool:
    """
    Check if signal meets user's alert conditions.

    Args:
        signal: AI signal to evaluate
        condition: User's alert condition

    Returns:
        True if alert should be triggered
    """
    if not condition.enabled:
        return False

    # Check signal type
    if signal.signal_type.value not in condition.signal_types:
        return False

    # Check minimum consensus
    if signal.consensus.agreement < condition.min_consensus:
        return False

    # Check minimum confidence
    if signal.confidence < condition.min_confidence:
        return False

    # Check pattern requirement
    if condition.require_pattern:
        if signal.pattern_alignment.technical_confluence < 1:
            return False

    return True


def create_notification(
    condition: AlertCondition,
    signal: AISignal
) -> AlertNotification:
    """
    Create notification message from a signal.

    Args:
        condition: Alert condition that triggered
        signal: AI signal data

    Returns:
        AlertNotification object
    """
    signal_type = signal.signal_type
    confidence = signal.confidence
    agreement = signal.consensus.agreement
    symbol = signal.symbol
    market = signal.market

    # Title and emoji
    if signal_type == SignalType.STRONG_BUY:
        title = f"🚀 {symbol} 강한 매수 시그널!"
        emoji = "🟢"
    elif signal_type == SignalType.STRONG_SELL:
        title = f"⚠️ {symbol} 강한 매도 시그널!"
        emoji = "🔴"
    elif signal_type == SignalType.MODERATE_BUY:
        title = f"📈 {symbol} 매수 시그널"
        emoji = "🟢"
    elif signal_type == SignalType.MODERATE_SELL:
        title = f"📉 {symbol} 매도 시그널"
        emoji = "🔴"
    else:
        title = f"⚠️ {symbol} AI 의견 불일치"
        emoji = "⚪"

    # Body
    body_parts = [
        f"시장: {market}",
        f"AI 합의도: {agreement}/3",
        f"신뢰도: {confidence:.1f}%",
        ""
    ]

    # Add reasoning
    body_parts.extend(signal.reasoning)

    # Add trading levels if available
    levels = signal.trading_levels
    if levels.entry is not None:
        body_parts.extend([
            "",
            f"📍 진입: {levels.entry:,.0f}",
            f"🛑 손절: {levels.stop:,.0f}",
        ])
        if levels.targets:
            targets_str = " / ".join(f"{t:,.0f}" for t in levels.targets[:2])
            body_parts.append(f"🎯 목표: {targets_str}")
        if levels.risk_reward > 0:
            body_parts.append(f"📊 R:R = {levels.risk_reward}")

    body = "\n".join(body_parts)

    # Generate unique ID
    notification_id = f"{signal.timestamp.strftime('%Y%m%d%H%M%S')}_{symbol}_{condition.id[:8]}"

    return AlertNotification(
        id=notification_id,
        user_id=condition.user_id,
        symbol=symbol,
        market=market,
        title=title,
        body=body,
        emoji=emoji,
        signal_type=signal_type.value,
        confidence=confidence,
        timestamp=signal.timestamp.isoformat(),
        data=signal.to_dict()
    )


class AlertEvaluator:
    """Main alert evaluation service"""

    def __init__(self):
        self.condition_store = AlertConditionStore()
        self.history_store = AlertHistoryStore()
        self._notification_callbacks: List[callable] = []

    def register_notification_callback(self, callback: callable):
        """Register a callback to be called when notifications are created"""
        self._notification_callbacks.append(callback)

    async def evaluate_signal(self, signal: AISignal) -> List[AlertNotification]:
        """
        Evaluate signal against all conditions and create notifications.

        Args:
            signal: AI signal to evaluate

        Returns:
            List of triggered notifications
        """
        notifications = []

        # Get matching conditions
        conditions = self.condition_store.get_by_symbol(signal.symbol)

        for condition in conditions:
            # Check cooldown
            if self.history_store.is_on_cooldown(
                signal.symbol,
                condition.id,
                condition.cooldown_minutes
            ):
                continue

            # Check if should trigger
            if should_trigger_alert(signal, condition):
                # Create notification
                notification = create_notification(condition, signal)
                notifications.append(notification)

                # Record in history
                history_entry = AlertHistoryEntry(
                    notification_id=notification.id,
                    condition_id=condition.id,
                    symbol=signal.symbol,
                    market=signal.market,
                    signal_type=signal.signal_type.value,
                    timestamp=signal.timestamp.isoformat(),
                    channels_sent=[]
                )
                self.history_store.add_entry(history_entry)

                # Call registered callbacks
                for callback in self._notification_callbacks:
                    try:
                        if asyncio.iscoroutinefunction(callback):
                            await callback(notification, condition)
                        else:
                            callback(notification, condition)
                    except Exception as e:
                        print(f"Notification callback error: {e}")

        return notifications

    def add_condition(self, condition: AlertCondition) -> AlertCondition:
        """Add a new alert condition"""
        return self.condition_store.add(condition)

    def update_condition(self, condition: AlertCondition) -> AlertCondition:
        """Update an existing condition"""
        return self.condition_store.update(condition)

    def delete_condition(self, condition_id: str) -> bool:
        """Delete a condition"""
        return self.condition_store.delete(condition_id)

    def get_conditions(self, user_id: Optional[str] = None) -> List[AlertCondition]:
        """Get all conditions or conditions for a user"""
        if user_id:
            return self.condition_store.get_by_user(user_id)
        return self.condition_store.get_all()

    def get_history(self, symbol: Optional[str] = None, limit: int = 50) -> List[AlertHistoryEntry]:
        """Get alert history"""
        if symbol:
            return self.history_store.get_by_symbol(symbol, limit)
        return self.history_store.get_recent(limit)


# Global instance
_evaluator: Optional[AlertEvaluator] = None


def get_evaluator() -> AlertEvaluator:
    """Get or create the global evaluator instance"""
    global _evaluator
    if _evaluator is None:
        _evaluator = AlertEvaluator()
    return _evaluator
