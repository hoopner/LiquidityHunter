"""
Build OHLC candles from tick data
Aggregates real-time ticks into 1min/5min/15min/1h/1D candles
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, List
import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)


class CandleBuilder:
    """
    Builds OHLC candles from tick data

    Supports timeframes:
    - 1min: 1 minute candles
    - 5min: 5 minute candles
    - 15min: 15 minute candles
    - 1h: 1 hour candles
    - 1D: Daily candles
    """

    INTERVALS = {
        '1min': ('1 minute', 60),
        '5min': ('5 minutes', 300),
        '15min': ('15 minutes', 900),
        '1h': ('1 hour', 3600),
        '4h': ('4 hours', 14400),
        '1D': ('1 day', 86400),
    }

    def __init__(self):
        self._db_conn = None

    @property
    def db_conn(self):
        """Lazy-load database connection"""
        if self._db_conn is None:
            try:
                import psycopg2
                db_url = os.getenv('DATABASE_URL')
                if db_url:
                    self._db_conn = psycopg2.connect(db_url)
                    self._db_conn.autocommit = True
                    logger.info("CandleBuilder: Database connected")
            except Exception as e:
                logger.error(f"Database connection failed: {e}")
        return self._db_conn

    def build_candles(self, timeframe: str = '1min', symbol: str = None) -> int:
        """
        Aggregate ticks into OHLC candles

        Args:
            timeframe: Target timeframe (1min, 5min, 15min, 1h, 1D)
            symbol: Optional - build for specific symbol only

        Returns:
            Number of candles created/updated
        """
        if timeframe not in self.INTERVALS:
            raise ValueError(f"Invalid timeframe: {timeframe}. Use: {list(self.INTERVALS.keys())}")

        if not self.db_conn:
            logger.error("No database connection")
            return 0

        interval_sql, _ = self.INTERVALS[timeframe]

        try:
            cur = self.db_conn.cursor()

            # Build candles from unprocessed ticks
            # Using PostgreSQL date_trunc for time bucketing
            symbol_filter = "AND symbol = %s" if symbol else ""
            params = [symbol] if symbol else []

            query = f"""
                WITH tick_candles AS (
                    SELECT
                        symbol,
                        market,
                        date_trunc('{interval_sql}', timestamp_utc) as candle_time,
                        (array_agg(price ORDER BY timestamp_utc ASC))[1] as open,
                        MAX(price) as high,
                        MIN(price) as low,
                        (array_agg(price ORDER BY timestamp_utc DESC))[1] as close,
                        SUM(volume) as volume,
                        COUNT(*) as tick_count
                    FROM realtime_ticks
                    WHERE processed = false {symbol_filter}
                    GROUP BY symbol, market, date_trunc('{interval_sql}', timestamp_utc)
                )
                INSERT INTO ohlcv_candles (symbol, market, timeframe, timestamp, open, high, low, close, volume)
                SELECT
                    symbol,
                    market,
                    '{timeframe}',
                    candle_time,
                    open,
                    high,
                    low,
                    close,
                    volume
                FROM tick_candles
                ON CONFLICT (symbol, market, timeframe, timestamp) DO UPDATE
                SET
                    open = EXCLUDED.open,
                    high = GREATEST(ohlcv_candles.high, EXCLUDED.high),
                    low = LEAST(ohlcv_candles.low, EXCLUDED.low),
                    close = EXCLUDED.close,
                    volume = ohlcv_candles.volume + EXCLUDED.volume
                RETURNING symbol
            """

            cur.execute(query, params)
            count = cur.rowcount

            # Mark processed ticks
            if count > 0:
                mark_query = f"""
                    UPDATE realtime_ticks
                    SET processed = true
                    WHERE processed = false {symbol_filter}
                """
                cur.execute(mark_query, params)

            cur.close()

            if count > 0:
                logger.info(f"Built {count} {timeframe} candles")

            return count

        except Exception as e:
            logger.error(f"Candle build error: {e}")
            return 0

    def build_all_timeframes(self, symbol: str = None) -> dict:
        """Build candles for all timeframes"""
        results = {}
        for tf in self.INTERVALS.keys():
            results[tf] = self.build_candles(tf, symbol)
        return results

    def ensure_tables(self):
        """Create candle tables if they don't exist"""
        if not self.db_conn:
            return

        try:
            cur = self.db_conn.cursor()

            # OHLCV candles table (multi-timeframe)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ohlcv_candles (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    market VARCHAR(10) NOT NULL,
                    timeframe VARCHAR(10) NOT NULL,
                    timestamp TIMESTAMP NOT NULL,
                    open DECIMAL(15, 4) NOT NULL,
                    high DECIMAL(15, 4) NOT NULL,
                    low DECIMAL(15, 4) NOT NULL,
                    close DECIMAL(15, 4) NOT NULL,
                    volume BIGINT DEFAULT 0,
                    UNIQUE(symbol, market, timeframe, timestamp)
                )
            """)

            # Indexes
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_candles_lookup
                ON ohlcv_candles(symbol, market, timeframe, timestamp DESC)
            """)

            cur.close()
            logger.info("Candle tables verified")

        except Exception as e:
            logger.error(f"Table creation error: {e}")

    def get_candles(
        self,
        symbol: str,
        market: str,
        timeframe: str,
        limit: int = 500
    ) -> List[dict]:
        """Retrieve candles from database"""
        if not self.db_conn:
            return []

        try:
            cur = self.db_conn.cursor()
            cur.execute("""
                SELECT timestamp, open, high, low, close, volume
                FROM ohlcv_candles
                WHERE symbol = %s AND market = %s AND timeframe = %s
                ORDER BY timestamp DESC
                LIMIT %s
            """, (symbol, market, timeframe, limit))

            rows = cur.fetchall()
            cur.close()

            candles = [
                {
                    'time': row[0].isoformat(),
                    'open': float(row[1]),
                    'high': float(row[2]),
                    'low': float(row[3]),
                    'close': float(row[4]),
                    'volume': int(row[5]),
                }
                for row in reversed(rows)  # Chronological order
            ]

            return candles

        except Exception as e:
            logger.error(f"Candle retrieval error: {e}")
            return []


# Background candle builder service
class CandleBuilderService:
    """
    Runs candle building on a schedule

    - 1min candles: Every minute
    - 5min candles: Every 5 minutes
    - 15min candles: Every 15 minutes
    - 1h candles: Every hour
    - 1D candles: Every day at midnight UTC
    """

    def __init__(self):
        self.builder = CandleBuilder()
        self.running = False
        self.last_build = {}

    def start(self):
        """Start the candle builder service"""
        import time

        self.running = True
        self.builder.ensure_tables()

        logger.info("Candle builder service started")

        while self.running:
            try:
                now = datetime.utcnow()

                # Build 1min candles every minute
                self.builder.build_candles('1min')

                # Build 5min candles every 5 minutes
                if now.minute % 5 == 0:
                    self.builder.build_candles('5min')

                # Build 15min candles every 15 minutes
                if now.minute % 15 == 0:
                    self.builder.build_candles('15min')

                # Build 1h candles every hour
                if now.minute == 0:
                    self.builder.build_candles('1h')

                # Build 1D candles at midnight UTC
                if now.hour == 0 and now.minute == 0:
                    self.builder.build_candles('1D')

                # Sleep until next minute
                sleep_seconds = 60 - now.second
                time.sleep(sleep_seconds)

            except KeyboardInterrupt:
                self.running = False
            except Exception as e:
                logger.error(f"Builder service error: {e}")
                time.sleep(10)

        logger.info("Candle builder service stopped")

    def stop(self):
        """Stop the service"""
        self.running = False


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    service = CandleBuilderService()
    service.start()
