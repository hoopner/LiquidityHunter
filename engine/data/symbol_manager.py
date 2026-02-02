"""
Dynamic Symbol Manager - Auto-add any stock on demand

NO HARDCODED LISTS - supports unlimited stocks
When user views any stock, it's automatically added to tracking
"""

import logging
import os
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


class SymbolManager:
    """Manage symbols dynamically - add any stock on demand"""

    def __init__(self):
        self._db_conn = None

    @property
    def db_conn(self):
        """Lazy-load database connection"""
        if self._db_conn is None:
            try:
                import psycopg2
                from dotenv import load_dotenv
                load_dotenv()
                db_url = os.getenv('DATABASE_URL')
                if db_url:
                    self._db_conn = psycopg2.connect(db_url)
                    self._db_conn.autocommit = True
            except Exception as e:
                logger.error(f"Database connection failed: {e}")
        return self._db_conn

    def ensure_tables(self):
        """Create tracking tables if they don't exist"""
        if not self.db_conn:
            return

        try:
            cur = self.db_conn.cursor()

            # Chart views table - tracks what users look at
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chart_views (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    market VARCHAR(10) NOT NULL,
                    viewed_at TIMESTAMP DEFAULT NOW()
                )
            """)

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_chart_views_recent
                ON chart_views(viewed_at DESC)
            """)

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_chart_views_symbol
                ON chart_views(symbol, market)
            """)

            cur.close()
            logger.info("Symbol tracking tables verified")

        except Exception as e:
            logger.error(f"Table creation error: {e}")

    def track_view(self, symbol: str, market: str):
        """Track that a user viewed this symbol"""
        if not self.db_conn:
            return

        try:
            cur = self.db_conn.cursor()
            cur.execute(
                "INSERT INTO chart_views (symbol, market) VALUES (%s, %s)",
                (symbol.upper(), market.upper())
            )
            cur.close()
        except Exception as e:
            logger.debug(f"Track view error: {e}")

    def symbol_exists(self, symbol: str, market: str) -> bool:
        """Check if symbol already has data"""
        if not self.db_conn:
            return False

        try:
            cur = self.db_conn.cursor()
            cur.execute("""
                SELECT 1 FROM ohlcv_data
                WHERE symbol = %s AND market = %s
                LIMIT 1
            """, (symbol.upper(), market.upper()))
            result = cur.fetchone()
            cur.close()
            return result is not None
        except Exception as e:
            logger.error(f"Symbol check error: {e}")
            return False

    def add_symbol(self, symbol: str, market: str) -> bool:
        """
        Add new symbol to tracking - fetches historical data

        Returns True if data was fetched, False if already exists or error
        """
        symbol = symbol.upper()
        market = market.upper()

        # Check if already exists
        if self.symbol_exists(symbol, market):
            logger.debug(f"Symbol {symbol} ({market}) already tracked")
            return False

        logger.info(f"Adding new symbol: {symbol} ({market})")

        # Fetch initial data
        try:
            self._fetch_initial_data(symbol, market)
            return True
        except Exception as e:
            logger.error(f"Failed to add symbol {symbol}: {e}")
            return False

    def _fetch_initial_data(self, symbol: str, market: str):
        """Fetch last 5 years of data for new symbol using yfinance"""
        import yfinance as yf

        # Build ticker symbol
        if market == 'KR':
            # Korean stocks: add .KS suffix for KOSPI, .KQ for KOSDAQ
            ticker_symbol = f'{symbol}.KS'
        else:
            ticker_symbol = symbol

        logger.info(f"Fetching data for {ticker_symbol}...")

        ticker = yf.Ticker(ticker_symbol)
        hist = ticker.history(period='5y')

        if hist.empty:
            # Try KOSDAQ suffix for Korean stocks
            if market == 'KR':
                ticker_symbol = f'{symbol}.KQ'
                ticker = yf.Ticker(ticker_symbol)
                hist = ticker.history(period='5y')

        if hist.empty:
            logger.warning(f"No data found for {symbol}")
            return

        # Save to database
        if not self.db_conn:
            return

        cur = self.db_conn.cursor()
        count = 0

        for date, row in hist.iterrows():
            try:
                # Convert pandas timestamp to date
                date_str = date.strftime('%Y-%m-%d')

                cur.execute("""
                    INSERT INTO ohlcv_data (timestamp, symbol, market, open, high, low, close, volume)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (timestamp, symbol, market) DO NOTHING
                """, (
                    date_str,
                    symbol,
                    market,
                    float(row['Open']),
                    float(row['High']),
                    float(row['Low']),
                    float(row['Close']),
                    int(row['Volume'])
                ))
                count += 1
            except Exception as e:
                logger.debug(f"Insert error for {date_str}: {e}")

        cur.close()
        logger.info(f"Added {count} bars for {symbol} ({market})")

    def get_active_symbols(self, days: int = 7) -> Dict[str, List[str]]:
        """
        Get symbols that users are actively watching

        Combines:
        - Symbols with existing data
        - Recently viewed symbols
        - Watchlist symbols
        """
        if not self.db_conn:
            return {'KR': [], 'US': []}

        try:
            cur = self.db_conn.cursor()

            # Get all unique symbols from multiple sources
            cur.execute("""
                SELECT DISTINCT symbol, market
                FROM (
                    -- From historical data (primary source)
                    SELECT DISTINCT symbol, market FROM ohlcv_data

                    UNION

                    -- From recent chart views
                    SELECT DISTINCT symbol, market FROM chart_views
                    WHERE viewed_at > NOW() - INTERVAL '%s days'

                    UNION

                    -- From realtime ticks
                    SELECT DISTINCT symbol, market FROM realtime_ticks
                    WHERE timestamp_utc > NOW() - INTERVAL '1 day'
                ) AS active_symbols
                ORDER BY market, symbol
            """, (days,))

            results = cur.fetchall()
            cur.close()

            symbols = {'KR': [], 'US': []}
            for symbol, market in results:
                if market in symbols:
                    symbols[market].append(symbol)

            logger.info(f"Active symbols: {len(symbols['KR'])} KR + {len(symbols['US'])} US")
            return symbols

        except Exception as e:
            logger.error(f"Get active symbols error: {e}")
            return {'KR': [], 'US': []}

    def get_symbol_count(self) -> Tuple[int, int]:
        """Get count of tracked symbols"""
        if not self.db_conn:
            return (0, 0)

        try:
            cur = self.db_conn.cursor()
            cur.execute("""
                SELECT market, COUNT(DISTINCT symbol)
                FROM ohlcv_data
                GROUP BY market
            """)
            results = dict(cur.fetchall())
            cur.close()
            return (results.get('KR', 0), results.get('US', 0))
        except Exception as e:
            logger.error(f"Symbol count error: {e}")
            return (0, 0)


# Singleton instance
_symbol_manager = None


def get_symbol_manager() -> SymbolManager:
    """Get singleton SymbolManager instance"""
    global _symbol_manager
    if _symbol_manager is None:
        _symbol_manager = SymbolManager()
        _symbol_manager.ensure_tables()
    return _symbol_manager
