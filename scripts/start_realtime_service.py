#!/usr/bin/env python3
"""
Start 24/7 real-time data collection service

Combined service that runs:
1. RealtimeCollector - collects prices every 60 seconds
2. CandleBuilder - builds candles every minute

Usage:
    python scripts/start_realtime_service.py

Runs continuously - press Ctrl+C to stop
"""
import sys
import os
import time
import threading
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
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(logs_dir / 'realtime_service.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


def run_collector():
    """Run the real-time price collector"""
    from engine.data.realtime_collector import RealtimeCollector

    collector = RealtimeCollector(interval_seconds=60)
    collector.start()


def run_candle_builder():
    """Build candles periodically"""
    from engine.data.candle_builder import CandleBuilder

    builder = CandleBuilder()
    builder.ensure_tables()

    logger.info("Candle builder started - building every 60 seconds")

    while True:
        try:
            # Build 1-minute candles
            count = builder.build_candles('1min')
            if count > 0:
                logger.info(f"Built {count} 1min candles")

            # Build higher timeframes at appropriate intervals
            from datetime import datetime
            now = datetime.utcnow()

            # 5min candles every 5 minutes
            if now.minute % 5 == 0:
                builder.build_candles('5min')

            # 15min candles every 15 minutes
            if now.minute % 15 == 0:
                builder.build_candles('15min')

            # 1h candles every hour
            if now.minute == 0:
                builder.build_candles('1h')

            # 1D candles at midnight UTC
            if now.hour == 0 and now.minute == 0:
                builder.build_candles('1D')

            # Sleep until next minute
            sleep_seconds = 60 - now.second
            time.sleep(sleep_seconds)

        except Exception as e:
            logger.error(f"Candle builder error: {e}")
            time.sleep(10)


def main():
    print("=" * 60)
    print("  LIQUIDITYHUNTER 24/7 REAL-TIME SERVICE")
    print("  Combined Collector + Candle Builder")
    print("=" * 60)
    print()
    print("  Services:")
    print("    - Real-time Collector: Every 60 seconds")
    print("    - Candle Builder: 1min/5min/15min/1h/1D")
    print()
    print("  Log file: logs/realtime_service.log")
    print()
    print("  Press Ctrl+C to stop")
    print("=" * 60)
    print()

    # Start collector in a separate thread
    collector_thread = threading.Thread(target=run_collector, daemon=True, name="Collector")
    collector_thread.start()

    logger.info("Started collector thread")

    # Give collector time to initialize
    time.sleep(2)

    # Run candle builder in main thread
    try:
        run_candle_builder()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        sys.exit(0)


if __name__ == "__main__":
    main()
