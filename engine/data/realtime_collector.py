"""
24/7 Real-time data collector for ALL stocks
Runs continuously, collects data every minute
"""
import time
import logging
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)


class RealtimeCollector:
    """
    24/7 Real-time price collector

    Features:
    - Collects ALL symbols from database (not hardcoded)
    - Detects extended hours (pre-market, after-hours)
    - Stores in UTC (no timezone issues)
    - Auto-retry on errors
    """

    def __init__(self, interval_seconds: int = 60):
        self.interval = interval_seconds
        self.running = False
        self.stats = {
            'ticks_collected': 0,
            'errors': 0,
            'start_time': None,
        }

        # Lazy-load dependencies
        self._kis_client = None
        self._db_conn = None

        # Load symbols from database
        self.symbols_kr: List[str] = []
        self.symbols_us: List[str] = []

    @property
    def kis_client(self):
        """Lazy-load KIS client"""
        if self._kis_client is None:
            try:
                from engine.data.kis_api import KISClient
                self._kis_client = KISClient()
                logger.info("KIS client initialized")
            except Exception as e:
                logger.warning(f"KIS client not available: {e}")
        return self._kis_client

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
                    logger.info("Database connected")
                    self._ensure_tables()
            except Exception as e:
                logger.error(f"Database connection failed: {e}")
        return self._db_conn

    def _ensure_tables(self):
        """Create necessary tables if they don't exist"""
        if not self.db_conn:
            return

        try:
            cur = self.db_conn.cursor()

            # Real-time tick data table with extended hours flag
            cur.execute("""
                CREATE TABLE IF NOT EXISTS realtime_ticks (
                    id BIGSERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    market VARCHAR(10) NOT NULL,
                    price DECIMAL(15, 4) NOT NULL,
                    volume BIGINT DEFAULT 0,
                    timestamp_utc TIMESTAMP NOT NULL,
                    is_extended_hours BOOLEAN DEFAULT false,
                    processed BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(symbol, market, timestamp_utc)
                )
            """)

            # Indexes for performance
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_ticks_symbol_time
                ON realtime_ticks(symbol, timestamp_utc DESC)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_ticks_time
                ON realtime_ticks(timestamp_utc DESC)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_ticks_processed
                ON realtime_ticks(processed) WHERE processed = false
            """)

            cur.close()
            logger.info("Database tables verified")

        except Exception as e:
            logger.error(f"Table creation error: {e}")

    def _load_symbols_from_db(self):
        """Load ALL symbols from database"""
        if not self.db_conn:
            return

        try:
            cur = self.db_conn.cursor()

            # Get KR symbols
            cur.execute("SELECT DISTINCT symbol FROM ohlcv_data WHERE market = 'KR' ORDER BY symbol")
            self.symbols_kr = [row[0] for row in cur.fetchall()]

            # Get US symbols
            cur.execute("SELECT DISTINCT symbol FROM ohlcv_data WHERE market = 'US' ORDER BY symbol")
            self.symbols_us = [row[0] for row in cur.fetchall()]

            cur.close()
            logger.info(f"Loaded {len(self.symbols_kr)} KR + {len(self.symbols_us)} US symbols from database")

        except Exception as e:
            logger.error(f"Failed to load symbols: {e}")

    def _is_extended_hours(self, market: str, timestamp: datetime) -> bool:
        """Check if timestamp is during extended hours"""
        try:
            import pytz

            if market == 'KR':
                # KR regular hours: 09:00-15:30 KST
                kr_tz = pytz.timezone('Asia/Seoul')
                local_time = timestamp.astimezone(kr_tz)
                hour = local_time.hour
                minute = local_time.minute
                weekday = local_time.weekday()

                # Weekend
                if weekday >= 5:
                    return True
                # Before 9:00 or after 15:30
                if hour < 9 or (hour == 15 and minute >= 30) or hour >= 16:
                    return True
                return False

            else:  # US
                # US regular hours: 09:30-16:00 EST/EDT
                us_tz = pytz.timezone('America/New_York')
                local_time = timestamp.astimezone(us_tz)
                hour = local_time.hour
                minute = local_time.minute
                weekday = local_time.weekday()

                # Weekend
                if weekday >= 5:
                    return True
                # Before 9:30 or after 16:00
                if hour < 9 or (hour == 9 and minute < 30) or hour >= 16:
                    return True
                return False

        except Exception:
            return False

    def start(self):
        """Start continuous collection"""
        self.running = True
        self.stats['start_time'] = datetime.now(timezone.utc)

        # Initialize database and load symbols
        _ = self.db_conn
        self._load_symbols_from_db()

        total_symbols = len(self.symbols_kr) + len(self.symbols_us)

        logger.info("=" * 60)
        logger.info("🚀 24/7 REAL-TIME COLLECTOR STARTED")
        logger.info(f"📊 Monitoring: {len(self.symbols_kr)} KR + {len(self.symbols_us)} US = {total_symbols} total")
        logger.info(f"⏱️  Interval: {self.interval} seconds")
        logger.info("=" * 60)

        while self.running:
            try:
                start_time = time.time()
                self.collect_all()
                elapsed = time.time() - start_time

                # Sleep remaining time
                sleep_time = max(0, self.interval - elapsed)
                if sleep_time > 0:
                    time.sleep(sleep_time)

            except KeyboardInterrupt:
                logger.info("\n⏹️  Stopping collector...")
                self.running = False
            except Exception as e:
                self.stats['errors'] += 1
                logger.error(f"❌ Collection error: {e}")
                time.sleep(5)

        self._shutdown()

    def stop(self):
        """Stop the collector gracefully"""
        self.running = False

    def _shutdown(self):
        """Clean shutdown"""
        logger.info("=" * 60)
        logger.info("COLLECTOR SHUTDOWN")
        logger.info(f"  Total ticks: {self.stats['ticks_collected']}")
        logger.info(f"  Errors: {self.stats['errors']}")
        if self.stats['start_time']:
            runtime = datetime.now(timezone.utc) - self.stats['start_time']
            logger.info(f"  Runtime: {runtime}")
        logger.info("=" * 60)

        if self._db_conn:
            self._db_conn.close()

    def collect_all(self):
        """Collect prices for ALL symbols"""
        timestamp = datetime.now(timezone.utc)
        collected = {'kr': 0, 'us': 0, 'failed': 0}

        # Korean stocks
        for symbol in self.symbols_kr:
            try:
                price_data = self._get_price(symbol, 'KR')
                if price_data:
                    self._save_tick(symbol, 'KR', price_data, timestamp)
                    collected['kr'] += 1
                else:
                    collected['failed'] += 1
            except Exception as e:
                collected['failed'] += 1
                logger.debug(f"Failed {symbol} KR: {e}")

        # US stocks
        for symbol in self.symbols_us:
            try:
                price_data = self._get_price(symbol, 'US')
                if price_data:
                    self._save_tick(symbol, 'US', price_data, timestamp)
                    collected['us'] += 1
                else:
                    collected['failed'] += 1
            except Exception as e:
                collected['failed'] += 1
                logger.debug(f"Failed {symbol} US: {e}")

        total = collected['kr'] + collected['us']
        self.stats['ticks_collected'] += total

        logger.info(f"✅ Collected: {collected['kr']} KR + {collected['us']} US = {total} total (failed: {collected['failed']})")

    def _get_price(self, symbol: str, market: str) -> Optional[Dict[str, Any]]:
        """Get current price from KIS API"""
        if not self.kis_client:
            return None

        try:
            price_data = self.kis_client.get_current_price(symbol, market)
            if price_data and 'price' in price_data:
                return {
                    'price': float(price_data['price']),
                    'volume': int(price_data.get('volume', 0)),
                }
        except Exception as e:
            logger.debug(f"Price fetch error for {symbol}: {e}")

        return None

    def _save_tick(self, symbol: str, market: str, price_data: Dict[str, Any], timestamp: datetime):
        """Save tick to database"""
        if not self.db_conn:
            return

        is_extended = self._is_extended_hours(market, timestamp)

        try:
            cur = self.db_conn.cursor()
            cur.execute("""
                INSERT INTO realtime_ticks (symbol, market, price, volume, timestamp_utc, is_extended_hours)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (symbol, market, timestamp_utc) DO UPDATE
                SET price = EXCLUDED.price, volume = EXCLUDED.volume
            """, (
                symbol,
                market,
                price_data['price'],
                price_data.get('volume', 0),
                timestamp,
                is_extended
            ))
            cur.close()
        except Exception as e:
            logger.error(f"Database save error: {e}")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.FileHandler('logs/realtime_collector.log'),
            logging.StreamHandler()
        ]
    )

    collector = RealtimeCollector(interval_seconds=60)
    collector.start()
