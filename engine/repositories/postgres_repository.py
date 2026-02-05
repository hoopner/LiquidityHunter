"""
PostgreSQL Repository (Cache Layer)

Reads and writes OHLCVData to PostgreSQL/TimescaleDB.
This is NOT a data source — it's a cache. It does not inherit MarketDataRepository.

Uses the existing database connection from engine/data/database.py.
"""

import logging
from datetime import datetime
from typing import Optional

from engine.repositories.base import OHLCVData

logger = logging.getLogger(__name__)

# Table name for cached OHLCV data in the repository pattern.
# Uses a separate table from the legacy ohlcv_data to avoid conflicts
# during the migration period.
CACHE_TABLE = "ohlcv_cache"


class PostgresRepository:
    """
    Cache layer for OHLCV data in PostgreSQL.

    Stores and retrieves OHLCVData with Unix-second timestamps.
    Uses a dedicated cache table separate from the legacy ohlcv_data table.
    """

    def __init__(self):
        self._engine = None
        self._table_ensured = False

    @property
    def engine(self):
        """Lazy-load database engine from existing database module."""
        if self._engine is None:
            try:
                from engine.data.database import get_engine
                self._engine = get_engine()
            except Exception as e:
                logger.error(f"[PgRepo] Failed to get DB engine: {e}")
                raise
        return self._engine

    def _ensure_table(self):
        """Create the cache table if it doesn't exist."""
        if self._table_ensured:
            return

        try:
            from sqlalchemy import text

            with self.engine.connect() as conn:
                conn.execute(text(f"""
                    CREATE TABLE IF NOT EXISTS {CACHE_TABLE} (
                        symbol      VARCHAR(20) NOT NULL,
                        market      VARCHAR(4)  NOT NULL,
                        timeframe   VARCHAR(10) NOT NULL,
                        timestamp   BIGINT      NOT NULL,
                        open        DOUBLE PRECISION NOT NULL,
                        high        DOUBLE PRECISION NOT NULL,
                        low         DOUBLE PRECISION NOT NULL,
                        close       DOUBLE PRECISION NOT NULL,
                        volume      DOUBLE PRECISION NOT NULL DEFAULT 0,
                        updated_at  TIMESTAMP DEFAULT NOW(),
                        PRIMARY KEY (symbol, market, timeframe, timestamp)
                    )
                """))
                conn.commit()

            self._table_ensured = True
            logger.debug(f"[PgRepo] Table {CACHE_TABLE} ensured")

        except Exception as e:
            logger.error(f"[PgRepo] Failed to create table: {e}")

    def is_available(self) -> bool:
        """Check if PostgreSQL connection is working."""
        try:
            from engine.data.database import check_connection
            return check_connection()
        except Exception:
            return False

    def get_cached_ohlcv(
        self,
        symbol: str,
        market: str,
        timeframe: str,
    ) -> Optional[OHLCVData]:
        """
        Retrieve cached OHLCV data from PostgreSQL.

        Args:
            symbol: Stock ticker (e.g., "005930", "AAPL")
            market: "KR" or "US"
            timeframe: "1D", "1W", "1M", "1m", etc.

        Returns:
            OHLCVData if cache hit, None if cache miss or error.
        """
        self._ensure_table()

        try:
            from sqlalchemy import text

            with self.engine.connect() as conn:
                result = conn.execute(
                    text(f"""
                        SELECT timestamp, open, high, low, close, volume
                        FROM {CACHE_TABLE}
                        WHERE symbol = :symbol
                          AND market = :market
                          AND timeframe = :timeframe
                        ORDER BY timestamp ASC
                    """),
                    {
                        "symbol": symbol.upper(),
                        "market": market.upper(),
                        "timeframe": timeframe,
                    },
                )
                rows = result.fetchall()

            if not rows:
                logger.debug(
                    f"[PgRepo] Cache miss: {symbol} {market} {timeframe}"
                )
                return None

            timestamps = []
            opens = []
            highs = []
            lows = []
            closes = []
            volumes = []

            for row in rows:
                timestamps.append(int(row[0]))
                opens.append(float(row[1]))
                highs.append(float(row[2]))
                lows.append(float(row[3]))
                closes.append(float(row[4]))
                volumes.append(float(row[5]))

            data = OHLCVData(
                timestamps=timestamps,
                open=opens,
                high=highs,
                low=lows,
                close=closes,
                volume=volumes,
            )

            logger.info(
                f"[PgRepo] Cache hit: {symbol} {market} {timeframe} "
                f"({len(data)} bars)"
            )
            return data

        except Exception as e:
            logger.error(
                f"[PgRepo] Cache read error for {symbol} {market} {timeframe}: {e}"
            )
            return None

    def get_cached_ohlcv_from_legacy(
        self,
        symbol: str,
        market: str,
    ) -> Optional[OHLCVData]:
        """
        Read from the legacy ohlcv_data table (used by database.py).
        Converts the datetime-indexed data to Unix-second timestamps.

        This allows the new repository pattern to benefit from the existing
        PostgreSQL data collected by the daily updater, without needing
        to recollect everything.

        Args:
            symbol: Stock ticker
            market: "KR" or "US"

        Returns:
            OHLCVData with Unix-second timestamps, or None.
        """
        try:
            from engine.data.database import get_ohlcv as db_get_ohlcv

            df = db_get_ohlcv(symbol.upper(), market.upper())
            if df.empty:
                return None

            timestamps = []
            for ts in df.index:
                if hasattr(ts, "timestamp"):
                    timestamps.append(int(ts.timestamp()))
                else:
                    timestamps.append(int(datetime.fromisoformat(str(ts)).timestamp()))

            data = OHLCVData(
                timestamps=timestamps,
                open=[float(v) for v in df["open"].values],
                high=[float(v) for v in df["high"].values],
                low=[float(v) for v in df["low"].values],
                close=[float(v) for v in df["close"].values],
                volume=[float(v) for v in df["volume"].values],
            )

            logger.info(
                f"[PgRepo] Legacy data: {symbol} {market} ({len(data)} bars)"
            )
            return data

        except Exception as e:
            logger.error(
                f"[PgRepo] Legacy read error for {symbol} {market}: {e}"
            )
            return None

    def save_ohlcv(
        self,
        symbol: str,
        market: str,
        timeframe: str,
        data: OHLCVData,
    ) -> None:
        """
        Save OHLCVData to PostgreSQL cache.

        Uses upsert (INSERT ON CONFLICT UPDATE) to handle duplicate timestamps.

        Args:
            symbol: Stock ticker
            market: "KR" or "US"
            timeframe: "1D", "1W", "1M", etc.
            data: OHLCVData to save
        """
        if data.is_empty():
            return

        self._ensure_table()

        try:
            from sqlalchemy import text

            symbol = symbol.upper()
            market = market.upper()

            with self.engine.connect() as conn:
                # Use batch upsert for performance
                for i in range(len(data.timestamps)):
                    conn.execute(
                        text(f"""
                            INSERT INTO {CACHE_TABLE}
                                (symbol, market, timeframe, timestamp,
                                 open, high, low, close, volume, updated_at)
                            VALUES
                                (:symbol, :market, :timeframe, :timestamp,
                                 :open, :high, :low, :close, :volume, NOW())
                            ON CONFLICT (symbol, market, timeframe, timestamp)
                            DO UPDATE SET
                                open = EXCLUDED.open,
                                high = EXCLUDED.high,
                                low = EXCLUDED.low,
                                close = EXCLUDED.close,
                                volume = EXCLUDED.volume,
                                updated_at = NOW()
                        """),
                        {
                            "symbol": symbol,
                            "market": market,
                            "timeframe": timeframe,
                            "timestamp": data.timestamps[i],
                            "open": data.open[i],
                            "high": data.high[i],
                            "low": data.low[i],
                            "close": data.close[i],
                            "volume": data.volume[i],
                        },
                    )
                conn.commit()

            logger.info(
                f"[PgRepo] Saved {len(data)} bars: "
                f"{symbol} {market} {timeframe}"
            )

        except Exception as e:
            logger.error(
                f"[PgRepo] Save error for {symbol} {market} {timeframe}: {e}"
            )

    def delete_cached(
        self,
        symbol: str,
        market: str,
        timeframe: str,
    ) -> int:
        """
        Delete cached data for a symbol/market/timeframe.

        Returns number of rows deleted.
        """
        self._ensure_table()

        try:
            from sqlalchemy import text

            with self.engine.connect() as conn:
                result = conn.execute(
                    text(f"""
                        DELETE FROM {CACHE_TABLE}
                        WHERE symbol = :symbol
                          AND market = :market
                          AND timeframe = :timeframe
                    """),
                    {
                        "symbol": symbol.upper(),
                        "market": market.upper(),
                        "timeframe": timeframe,
                    },
                )
                conn.commit()
                deleted = result.rowcount

            logger.info(
                f"[PgRepo] Deleted {deleted} cached bars: "
                f"{symbol} {market} {timeframe}"
            )
            return deleted

        except Exception as e:
            logger.error(
                f"[PgRepo] Delete error for {symbol} {market} {timeframe}: {e}"
            )
            return 0
