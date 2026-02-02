#!/usr/bin/env python3
"""
Start candle builder service

Usage:
    python scripts/start_candle_builder.py

Builds OHLC candles from realtime ticks:
- 1min: Every minute
- 5min: Every 5 minutes
- 15min: Every 15 minutes
- 1h: Every hour
- 1D: At midnight UTC

Runs continuously - press Ctrl+C to stop
"""
import sys
import os
import logging
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")

# Ensure logs directory exists
logs_dir = project_root / "logs"
logs_dir.mkdir(exist_ok=True)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(logs_dir / 'candle_builder.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


def main():
    from engine.data.candle_builder import CandleBuilderService

    print("=" * 60)
    print("  LIQUIDITYHUNTER CANDLE BUILDER")
    print("  Aggregates ticks into OHLC candles")
    print("=" * 60)
    print()
    print("  Timeframes:")
    print("    - 1min:  Every minute")
    print("    - 5min:  Every 5 minutes")
    print("    - 15min: Every 15 minutes")
    print("    - 1h:    Every hour")
    print("    - 1D:    At midnight UTC")
    print()
    print("  Log file: logs/candle_builder.log")
    print()
    print("  Press Ctrl+C to stop")
    print("=" * 60)
    print()

    service = CandleBuilderService()

    try:
        service.start()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
