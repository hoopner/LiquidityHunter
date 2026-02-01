#!/usr/bin/env python3
"""
Collect 5 years of historical data for 200 stocks
Run: python scripts/collect_historical_data.py

This will download:
- 100 Korean stocks (KOSPI + KOSDAQ)
- 100 US stocks (S&P 500 + NASDAQ)
- 5 years of daily OHLCV data each

Estimated time: 30-60 minutes
Estimated records: ~250,000
"""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

from engine.data.historical_collector import HistoricalDataCollector
from engine.data.database import check_connection, get_db_info
import asyncio

if __name__ == "__main__":
    print("=" * 60)
    print("LIQUIDITYHUNTER HISTORICAL DATA COLLECTION")
    print("=" * 60)
    print()

    # Check database connection
    print("Checking database connection...")
    if not check_connection():
        print("❌ Database connection failed!")
        print("   Make sure PostgreSQL is running and DATABASE_URL is set")
        sys.exit(1)

    info = get_db_info()
    print(f"✓ PostgreSQL {info.get('postgresql_version', 'unknown')[:30]}...")
    print(f"✓ TimescaleDB {info.get('timescaledb_version', 'not installed')}")
    print(f"✓ Current rows: {info.get('ohlcv_rows', 0):,}")
    print()

    print("This will download 5 years of data for 200 stocks.")
    print("Estimated time: 30-60 minutes")
    print()

    response = input("Continue? (y/n): ")
    if response.lower() != 'y':
        print("Aborted.")
        sys.exit(0)

    print()

    # Run collection
    collector = HistoricalDataCollector()
    total = asyncio.run(collector.collect_all_data())

    # Show final stats
    print()
    print("Final database status:")
    info = get_db_info()
    print(f"  Total rows: {info.get('ohlcv_rows', 0):,}")
    print(f"  Hypertable size: {info.get('hypertable_size', 'unknown')}")
    print()
    print("Done! Data is now in PostgreSQL.")
