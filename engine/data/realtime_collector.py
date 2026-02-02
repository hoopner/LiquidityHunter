"""
24/7 Real-time data collector
Runs continuously, collects data every minute
No timezone calculations - stores everything in UTC
"""
import time
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
import os
import sys

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)


class RealtimeCollector:
    """
    Collects real-time price data 24/7

    Features:
    - Continuous collection every N seconds
    - Handles pre-market and after-hours
    - Stores in UTC (no timezone conversion needed)
    - Auto-retry on errors
    """

    def __init__(
        self,
        symbols_kr: List[str],
        symbols_us: List[str],
        interval_seconds: int = 60
    ):
        self.symbols_kr = symbols_kr
        self.symbols_us = symbols_us
        self.interval = interval_seconds
        self.running = False
        self.stats = {
            'ticks_collected': 0,
            'errors': 0,
            'start_time': None,
        }

        # Lazy-load dependencies to avoid import errors
        self._kis_client = None
        self._db_conn = None

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
                self._kis_client = None
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
                    logger.info("Database connection established")
                    self._ensure_tables()
            except Exception as e:
                logger.error(f"Database connection failed: {e}")
                self._db_conn = None
        return self._db_conn

    def _ensure_tables(self):
        """Create necessary tables if they don't exist"""
        if not self.db_conn:
            return

        try:
            cur = self.db_conn.cursor()

            # Real-time tick data table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS realtime_ticks (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    market VARCHAR(10) NOT NULL,
                    price DECIMAL(15, 4) NOT NULL,
                    volume BIGINT DEFAULT 0,
                    timestamp_utc TIMESTAMP NOT NULL,
                    processed BOOLEAN DEFAULT false,
                    UNIQUE(symbol, market, timestamp_utc)
                )
            """)

            # Indexes for performance
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_ticks_symbol_time
                ON realtime_ticks(symbol, timestamp_utc DESC)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_ticks_processed
                ON realtime_ticks(processed) WHERE processed = false
            """)

            logger.info("Database tables verified")
            cur.close()

        except Exception as e:
            logger.error(f"Table creation error: {e}")

    def start(self):
        """Start continuous collection"""
        self.running = True
        self.stats['start_time'] = datetime.utcnow()

        logger.info("=" * 60)
        logger.info("REAL-TIME COLLECTOR STARTED - 24/7 MODE")
        logger.info(f"  KR symbols: {len(self.symbols_kr)}")
        logger.info(f"  US symbols: {len(self.symbols_us)}")
        logger.info(f"  Interval: {self.interval} seconds")
        logger.info("=" * 60)

        while self.running:
            try:
                self.collect_tick()
                time.sleep(self.interval)
            except KeyboardInterrupt:
                logger.info("Received shutdown signal...")
                self.running = False
            except Exception as e:
                self.stats['errors'] += 1
                logger.error(f"Collection error: {e}")
                time.sleep(5)  # Brief pause on error

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
            runtime = datetime.utcnow() - self.stats['start_time']
            logger.info(f"  Runtime: {runtime}")
        logger.info("=" * 60)

        if self._db_conn:
            self._db_conn.close()

    def collect_tick(self):
        """Collect one round of data from all symbols"""
        timestamp = datetime.utcnow()
        collected = 0

        # Korean stocks
        for symbol in self.symbols_kr:
            try:
                price_data = self._get_price(symbol, 'KR')
                if price_data:
                    self._save_tick(symbol, 'KR', price_data, timestamp)
                    collected += 1
            except Exception as e:
                logger.debug(f"Error collecting {symbol} KR: {e}")

        # US stocks
        for symbol in self.symbols_us:
            try:
                price_data = self._get_price(symbol, 'US')
                if price_data:
                    self._save_tick(symbol, 'US', price_data, timestamp)
                    collected += 1
            except Exception as e:
                logger.debug(f"Error collecting {symbol} US: {e}")

        self.stats['ticks_collected'] += collected
        logger.info(f"[{timestamp.strftime('%H:%M:%S')}] Collected {collected}/{len(self.symbols_kr) + len(self.symbols_us)} ticks")

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

    def _save_tick(
        self,
        symbol: str,
        market: str,
        price_data: Dict[str, Any],
        timestamp: datetime
    ):
        """Save tick to database"""
        if not self.db_conn:
            return

        try:
            cur = self.db_conn.cursor()
            cur.execute("""
                INSERT INTO realtime_ticks (symbol, market, price, volume, timestamp_utc)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (symbol, market, timestamp_utc) DO UPDATE
                SET price = EXCLUDED.price, volume = EXCLUDED.volume
            """, (
                symbol,
                market,
                price_data['price'],
                price_data.get('volume', 0),
                timestamp
            ))
            cur.close()
        except Exception as e:
            logger.error(f"Database save error: {e}")

    def get_stats(self) -> Dict[str, Any]:
        """Get collector statistics"""
        return {
            **self.stats,
            'running': self.running,
            'symbols_kr': len(self.symbols_kr),
            'symbols_us': len(self.symbols_us),
        }


# For direct execution
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    collector = RealtimeCollector(
        symbols_kr=['005930', '000660'],
        symbols_us=['AAPL', 'MSFT'],
        interval_seconds=60
    )
    collector.start()
