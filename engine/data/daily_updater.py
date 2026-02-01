#!/usr/bin/env python3
"""
Daily Data Updater for LiquidityHunter
Automatically updates stock data every night

Runs: Daily at 1:00 AM
Updates: Previous trading day's data for all stocks
"""

import os
import sys
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional, Dict
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")

import psycopg2
from psycopg2.extras import execute_batch
import yfinance as yf


class DailyUpdater:
    """
    Updates all stocks with yesterday's data
    Much faster than full historical collection
    """

    def __init__(self):
        self.db_url = os.getenv('DATABASE_URL')
        if not self.db_url:
            raise ValueError("DATABASE_URL not found in environment")

        self.log_file = project_root / "logs" / "daily_update.log"
        self.log_file.parent.mkdir(exist_ok=True)

        # Rate limiting
        self.batch_size = 10
        self.delay_between_batches = 1.0  # seconds

    def log(self, message: str):
        """Write to log file and print"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_msg = f"[{timestamp}] {message}"
        print(log_msg)

        with open(self.log_file, 'a') as f:
            f.write(log_msg + "\n")

    def get_all_symbols(self) -> List[tuple]:
        """Get all unique symbols from database"""
        conn = psycopg2.connect(self.db_url)
        cur = conn.cursor()

        try:
            cur.execute("""
                SELECT DISTINCT symbol, market
                FROM ohlcv_data
                ORDER BY market, symbol
            """)
            symbols = cur.fetchall()
            self.log(f"Found {len(symbols)} symbols to update")
            return symbols

        finally:
            cur.close()
            conn.close()

    def get_yfinance_symbol(self, symbol: str, market: str) -> str:
        """Convert to yfinance symbol format"""
        if market == "KR":
            # Korean stocks: KOSPI uses .KS, KOSDAQ uses .KQ
            # Most 6-digit codes starting with 0-2 are KOSPI
            if symbol.startswith(('0', '1', '2')):
                return f"{symbol}.KS"
            else:
                return f"{symbol}.KQ"
        else:
            # US stocks don't need suffix
            return symbol

    def download_latest_data(self, symbol: str, market: str) -> Optional[Dict]:
        """
        Download recent data for a symbol
        Returns latest trading day's OHLCV data
        """
        try:
            yf_symbol = self.get_yfinance_symbol(symbol, market)

            # Download last 5 days (to ensure we get latest trading day)
            ticker = yf.Ticker(yf_symbol)
            hist = ticker.history(period="5d")

            if hist.empty:
                return None

            # Get most recent bar
            latest = hist.iloc[-1]
            latest_date = hist.index[-1]

            return {
                'timestamp': latest_date.to_pydatetime().replace(tzinfo=None),
                'symbol': symbol,
                'market': market,
                'open': float(latest['Open']),
                'high': float(latest['High']),
                'low': float(latest['Low']),
                'close': float(latest['Close']),
                'volume': int(latest['Volume'])
            }

        except Exception as e:
            self.log(f"  Error downloading {symbol}: {e}")
            return None

    def store_data(self, data: Dict) -> bool:
        """Store single bar in database with upsert"""
        conn = psycopg2.connect(self.db_url)
        cur = conn.cursor()

        try:
            cur.execute(
                """
                INSERT INTO ohlcv_data
                (timestamp, symbol, market, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (timestamp, symbol, market) DO UPDATE SET
                    open = EXCLUDED.open,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    close = EXCLUDED.close,
                    volume = EXCLUDED.volume
                """,
                (
                    data['timestamp'],
                    data['symbol'],
                    data['market'],
                    data['open'],
                    data['high'],
                    data['low'],
                    data['close'],
                    data['volume']
                )
            )
            conn.commit()
            return True

        except Exception as e:
            conn.rollback()
            self.log(f"  Error storing {data['symbol']}: {e}")
            return False

        finally:
            cur.close()
            conn.close()

    def check_last_update(self, symbol: str, market: str) -> Optional[datetime]:
        """Get the last update timestamp for a symbol"""
        conn = psycopg2.connect(self.db_url)
        cur = conn.cursor()

        try:
            cur.execute(
                """
                SELECT MAX(timestamp) FROM ohlcv_data
                WHERE symbol = %s AND market = %s
                """,
                (symbol, market)
            )
            result = cur.fetchone()
            return result[0] if result else None

        finally:
            cur.close()
            conn.close()

    async def update_all(self):
        """Update all symbols with latest data"""
        self.log("=" * 80)
        self.log("DAILY UPDATE STARTED")
        self.log(f"Database: {self.db_url.split('@')[-1] if '@' in self.db_url else 'local'}")
        self.log("=" * 80)

        start_time = datetime.now()

        # Get symbols
        symbols = self.get_all_symbols()

        if not symbols:
            self.log("No symbols found in database!")
            return

        # Update each symbol
        success_count = 0
        skip_count = 0
        fail_count = 0

        for i, (symbol, market) in enumerate(symbols):
            # Check if already updated today
            last_update = self.check_last_update(symbol, market)
            today = datetime.now().date()

            if last_update and last_update.date() >= today - timedelta(days=1):
                # Skip if updated within last day (weekend/holiday handling)
                skip_count += 1
                continue

            # Download latest
            data = self.download_latest_data(symbol, market)

            if data:
                # Store
                if self.store_data(data):
                    success_count += 1
                    price_str = f"{data['close']:,.0f}" if market == "KR" else f"${data['close']:.2f}"
                    self.log(f"  [{i+1}/{len(symbols)}] {symbol} ({market}): {price_str}")
                else:
                    fail_count += 1
            else:
                fail_count += 1

            # Rate limiting: pause every batch
            if (i + 1) % self.batch_size == 0:
                await asyncio.sleep(self.delay_between_batches)

        # Summary
        elapsed = (datetime.now() - start_time).total_seconds()

        self.log("")
        self.log("=" * 80)
        self.log("DAILY UPDATE COMPLETE")
        self.log(f"  Updated: {success_count}")
        self.log(f"  Skipped (already current): {skip_count}")
        self.log(f"  Failed: {fail_count}")
        self.log(f"  Total time: {elapsed:.1f}s")
        self.log("=" * 80)

        return {
            'success': success_count,
            'skipped': skip_count,
            'failed': fail_count,
            'elapsed': elapsed
        }


async def main():
    """Main entry point"""
    try:
        updater = DailyUpdater()
        await updater.update_all()
    except Exception as e:
        print(f"[ERROR] Daily update failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
