#!/usr/bin/env python3
"""
Test SMA Scanner with PostgreSQL integration
Expected: 30-60x faster than yfinance
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from dotenv import load_dotenv
load_dotenv()

from engine.screener.full_market_scanner import FullMarketScanner
import asyncio
import time

async def test():
    print("=" * 60)
    print("SMA SCANNER - DATABASE PERFORMANCE TEST")
    print("=" * 60)
    print()

    scanner = FullMarketScanner()
    print(f"Database mode: {scanner._use_database}")
    print(f"MAX_WORKERS: {scanner.MAX_WORKERS}")
    print(f"BATCH_SIZE: {scanner.BATCH_SIZE}")
    print()

    # Test Korean market
    print("Scanning Korean market...")
    start = time.time()
    kr_results = await scanner.scan_market_parallel(
        'KR',
        signal_types=['golden_cross', 'bullish_alignment'],
        force_refresh=True
    )
    kr_time = time.time() - start
    print(f"  Found {len(kr_results)} signals in {kr_time:.2f}s")

    # Test US market
    print()
    print("Scanning US market...")
    start = time.time()
    us_results = await scanner.scan_market_parallel(
        'US',
        signal_types=['golden_cross', 'bullish_alignment'],
        force_refresh=True
    )
    us_time = time.time() - start
    print(f"  Found {len(us_results)} signals in {us_time:.2f}s")

    # Summary
    total_time = kr_time + us_time
    print()
    print("=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Korean signals: {len(kr_results)}")
    print(f"US signals: {len(us_results)}")
    print(f"Total signals: {len(kr_results) + len(us_results)}")
    print()
    print(f"Korean scan time: {kr_time:.2f}s")
    print(f"US scan time: {us_time:.2f}s")
    print(f"Total time: {total_time:.2f}s")
    print()
    print(f"Expected with yfinance: ~60-120s")
    print(f"Speedup: {60/total_time:.0f}x faster!" if total_time > 0 else "N/A")
    print("=" * 60)

    # Show sample results
    if kr_results:
        print()
        print("Sample Korean result:")
        r = kr_results[0]
        print(f"  Symbol: {r.symbol}")
        print(f"  Signal: {r.signal_type}")
        print(f"  Price: {r.current_price:,.0f}")
        print(f"  SMA20: {r.sma20:,.0f}")
        print(f"  SMA200: {r.sma200:,.0f}")

    if us_results:
        print()
        print("Sample US result:")
        r = us_results[0]
        print(f"  Symbol: {r.symbol}")
        print(f"  Signal: {r.signal_type}")
        print(f"  Price: ${r.current_price:,.2f}")
        print(f"  SMA20: ${r.sma20:,.2f}")
        print(f"  SMA200: ${r.sma200:,.2f}")

if __name__ == "__main__":
    asyncio.run(test())
