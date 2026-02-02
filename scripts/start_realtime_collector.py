#!/usr/bin/env python3
"""
Start 24/7 real-time data collector

Usage:
    python scripts/start_realtime_collector.py

Runs continuously - press Ctrl+C to stop

Features:
- Collects price data every 60 seconds
- Handles KR and US markets
- Includes pre-market and after-hours
- Auto-retry on errors
- Logs to logs/realtime_collector.log
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
        logging.FileHandler(logs_dir / 'realtime_collector.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


def load_watchlist_symbols():
    """Load symbols from watchlist files"""
    kr_symbols = []
    us_symbols = []

    # Load KR watchlist
    kr_file = project_root / "data" / "kr_watchlist.txt"
    if kr_file.exists():
        with open(kr_file, 'r') as f:
            kr_symbols = [line.strip() for line in f if line.strip()]

    # Load US watchlist
    us_file = project_root / "data" / "us_watchlist.txt"
    if us_file.exists():
        with open(us_file, 'r') as f:
            us_symbols = [line.strip() for line in f if line.strip()]

    return kr_symbols, us_symbols


def main():
    from engine.data.realtime_collector import RealtimeCollector

    # Load symbols from watchlist or use defaults
    kr_symbols, us_symbols = load_watchlist_symbols()

    # Default symbols if watchlist is empty
    if not kr_symbols:
        kr_symbols = [
            '005930',  # Samsung Electronics
            '000660',  # SK Hynix
            '035420',  # NAVER
            '005380',  # Hyundai Motor
            '051910',  # LG Chem
            '006400',  # Samsung SDI
            '035720',  # Kakao
            '028260',  # Samsung C&T
            '012330',  # Hyundai Mobis
            '003670',  # POSCO
        ]

    if not us_symbols:
        us_symbols = [
            'AAPL',    # Apple
            'MSFT',    # Microsoft
            'GOOGL',   # Google
            'AMZN',    # Amazon
            'NVDA',    # NVIDIA
            'META',    # Meta
            'TSLA',    # Tesla
            'BRK-B',   # Berkshire
            'JPM',     # JP Morgan
            'V',       # Visa
        ]

    print("=" * 60)
    print("  LIQUIDITYHUNTER REAL-TIME COLLECTOR")
    print("  24/7 Continuous Data Collection")
    print("=" * 60)
    print()
    print(f"  KR Symbols ({len(kr_symbols)}):")
    for sym in kr_symbols[:5]:
        print(f"    - {sym}")
    if len(kr_symbols) > 5:
        print(f"    ... and {len(kr_symbols) - 5} more")
    print()
    print(f"  US Symbols ({len(us_symbols)}):")
    for sym in us_symbols[:5]:
        print(f"    - {sym}")
    if len(us_symbols) > 5:
        print(f"    ... and {len(us_symbols) - 5} more")
    print()
    print("  Interval: 60 seconds")
    print("  Log file: logs/realtime_collector.log")
    print()
    print("  Press Ctrl+C to stop")
    print("=" * 60)
    print()

    collector = RealtimeCollector(
        symbols_kr=kr_symbols,
        symbols_us=us_symbols,
        interval_seconds=60
    )

    try:
        collector.start()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
