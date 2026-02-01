#!/usr/bin/env python3
"""
Test historical data collector with 5 stocks
Run: python scripts/test_collector.py
"""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

from engine.data.historical_collector import HistoricalDataCollector
import asyncio

if __name__ == "__main__":
    # Test with just 5 stocks
    collector = HistoricalDataCollector()
    collector.kr_stocks = ["005930.KS", "000660.KS"]  # 2 Korean
    collector.us_stocks = ["AAPL", "MSFT", "NVDA"]    # 3 US

    print("Testing with 5 stocks...")
    print()

    asyncio.run(collector.collect_all_data())

    # Verify data in database
    print("\nVerifying data in database...")
    from engine.data.database import get_data_summary
    summary = get_data_summary()
    print(summary.to_string())
