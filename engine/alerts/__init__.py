"""Alert system for LiquidityHunter."""

from .telegram_bot import TelegramAlertBot, AlertSettings, load_settings, save_settings, get_bot
from .ai_signal_detector import (
    AISignal,
    SignalType,
    AIDirection,
    AIConsensus,
    PatternAlignment,
    TradingLevels,
    detect_ai_signal,
)
from .alert_evaluator import (
    AlertCondition,
    AlertNotification,
    AlertHistoryEntry,
    AlertEvaluator,
    get_evaluator,
)
from .notification_service import (
    NotificationService,
    InAppNotification,
    get_notification_service,
)

__all__ = [
    # Telegram bot
    "TelegramAlertBot",
    "AlertSettings",
    "load_settings",
    "save_settings",
    "get_bot",
    # AI Signal Detection
    "AISignal",
    "SignalType",
    "AIDirection",
    "AIConsensus",
    "PatternAlignment",
    "TradingLevels",
    "detect_ai_signal",
    # Alert Evaluation
    "AlertCondition",
    "AlertNotification",
    "AlertHistoryEntry",
    "AlertEvaluator",
    "get_evaluator",
    # Notification Service
    "NotificationService",
    "InAppNotification",
    "get_notification_service",
]
