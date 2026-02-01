"""
Database module for LiquidityHunter
PostgreSQL + TimescaleDB for time-series OHLCV data storage
"""
import os
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from contextlib import contextmanager

import pandas as pd
from sqlalchemy import create_engine, text, pool
from sqlalchemy.orm import sessionmaker, Session

logger = logging.getLogger(__name__)

# Database URL from environment
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/liquidityhunter_data")

# Global engine instance
_engine = None
_SessionLocal = None


def get_engine():
    """Get or create the database engine."""
    global _engine
    if _engine is None:
        _engine = create_engine(
            DATABASE_URL,
            poolclass=pool.QueuePool,
            pool_size=5,
            max_overflow=10,
            pool_timeout=30,
            pool_recycle=1800,
        )
    return _engine


def get_session_factory():
    """Get or create the session factory."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine())
    return _SessionLocal


@contextmanager
def get_db_session():
    """Context manager for database sessions."""
    SessionLocal = get_session_factory()
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_connection() -> bool:
    """Check if database connection is working."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return False


def get_db_info() -> Dict[str, Any]:
    """Get database information."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            # PostgreSQL version
            result = conn.execute(text("SELECT version()"))
            pg_version = result.fetchone()[0]

            # TimescaleDB version
            result = conn.execute(text(
                "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
            ))
            row = result.fetchone()
            ts_version = row[0] if row else "Not installed"

            # Table stats
            result = conn.execute(text(
                "SELECT COUNT(*) FROM ohlcv_data"
            ))
            row_count = result.fetchone()[0]

            # Hypertable info
            result = conn.execute(text("""
                SELECT hypertable_name, num_chunks,
                       pg_size_pretty(hypertable_size(format('%I.%I', hypertable_schema, hypertable_name)::regclass))
                FROM timescaledb_information.hypertables
                WHERE hypertable_name = 'ohlcv_data'
            """))
            row = result.fetchone()
            if row:
                chunks = row[1]
                size = row[2]
            else:
                chunks = 0
                size = "0 bytes"

            return {
                "connected": True,
                "postgresql_version": pg_version[:60],
                "timescaledb_version": ts_version,
                "ohlcv_rows": row_count,
                "hypertable_chunks": chunks,
                "hypertable_size": size,
            }
    except Exception as e:
        logger.error(f"Failed to get DB info: {e}")
        return {
            "connected": False,
            "error": str(e),
        }


# =============================================================================
# OHLCV Data Operations
# =============================================================================

def insert_ohlcv(
    df: pd.DataFrame,
    symbol: str,
    market: str = "US",
    on_conflict: str = "ignore"
) -> int:
    """
    Insert OHLCV data from DataFrame.

    Args:
        df: DataFrame with columns: timestamp/datetime, open, high, low, close, volume
        symbol: Stock symbol
        market: Market code (US, KR)
        on_conflict: "ignore" or "update"

    Returns:
        Number of rows inserted
    """
    if df.empty:
        return 0

    # Normalize column names
    df = df.copy()
    df.columns = df.columns.str.lower()

    # Handle index as timestamp
    if df.index.name in ['timestamp', 'datetime', 'date', 'Date', 'Datetime']:
        df = df.reset_index()

    # Find timestamp column
    ts_col = None
    for col in ['timestamp', 'datetime', 'date']:
        if col in df.columns:
            ts_col = col
            break

    if ts_col is None:
        raise ValueError("No timestamp column found in DataFrame")

    # Prepare data
    records = []
    for _, row in df.iterrows():
        records.append({
            "timestamp": pd.to_datetime(row[ts_col]),
            "symbol": symbol,
            "market": market,
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": int(row["volume"]),
        })

    engine = get_engine()
    inserted = 0

    with engine.connect() as conn:
        for record in records:
            try:
                if on_conflict == "ignore":
                    sql = text("""
                        INSERT INTO ohlcv_data (timestamp, symbol, market, open, high, low, close, volume)
                        VALUES (:timestamp, :symbol, :market, :open, :high, :low, :close, :volume)
                        ON CONFLICT DO NOTHING
                    """)
                else:  # update
                    sql = text("""
                        INSERT INTO ohlcv_data (timestamp, symbol, market, open, high, low, close, volume)
                        VALUES (:timestamp, :symbol, :market, :open, :high, :low, :close, :volume)
                        ON CONFLICT (timestamp, symbol)
                        DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high,
                                      low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume
                    """)
                conn.execute(sql, record)
                inserted += 1
            except Exception as e:
                logger.debug(f"Insert error for {symbol} at {record['timestamp']}: {e}")
        conn.commit()

    logger.info(f"Inserted {inserted}/{len(records)} rows for {symbol}")
    return inserted


def insert_ohlcv_bulk(
    df: pd.DataFrame,
    symbol: str,
    market: str = "US"
) -> int:
    """
    Bulk insert OHLCV data using COPY for better performance.

    Args:
        df: DataFrame with OHLCV data
        symbol: Stock symbol
        market: Market code

    Returns:
        Number of rows inserted
    """
    if df.empty:
        return 0

    # Normalize
    df = df.copy()
    df.columns = df.columns.str.lower()

    if df.index.name in ['timestamp', 'datetime', 'date', 'Date', 'Datetime']:
        df = df.reset_index()

    # Find timestamp column
    ts_col = None
    for col in ['timestamp', 'datetime', 'date']:
        if col in df.columns:
            ts_col = col
            break

    if ts_col is None:
        raise ValueError("No timestamp column found")

    # Prepare DataFrame for insert
    insert_df = pd.DataFrame({
        "timestamp": pd.to_datetime(df[ts_col]),
        "symbol": symbol,
        "market": market,
        "open": df["open"].astype(float),
        "high": df["high"].astype(float),
        "low": df["low"].astype(float),
        "close": df["close"].astype(float),
        "volume": df["volume"].astype(int),
    })

    engine = get_engine()
    rows = len(insert_df)

    # Use pandas to_sql with method='multi' for bulk insert
    insert_df.to_sql(
        "ohlcv_data",
        engine,
        if_exists="append",
        index=False,
        method="multi",
        chunksize=1000,
    )

    logger.info(f"Bulk inserted {rows} rows for {symbol}")
    return rows


def get_ohlcv(
    symbol: str,
    market: str = "US",
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: Optional[int] = None,
) -> pd.DataFrame:
    """
    Get OHLCV data for a symbol.

    Args:
        symbol: Stock symbol
        market: Market code
        start_date: Start date filter
        end_date: End date filter
        limit: Max rows to return

    Returns:
        DataFrame with OHLCV data
    """
    engine = get_engine()

    query = """
        SELECT timestamp, open, high, low, close, volume
        FROM ohlcv_data
        WHERE symbol = :symbol AND market = :market
    """
    params: Dict[str, Any] = {"symbol": symbol, "market": market}

    if start_date:
        query += " AND timestamp >= :start_date"
        params["start_date"] = start_date

    if end_date:
        query += " AND timestamp <= :end_date"
        params["end_date"] = end_date

    query += " ORDER BY timestamp ASC"

    if limit:
        query += f" LIMIT {limit}"

    df = pd.read_sql(text(query), engine, params=params)

    if not df.empty:
        df.set_index("timestamp", inplace=True)
        df.index = pd.to_datetime(df.index)

    return df


def get_latest_timestamp(symbol: str, market: str = "US") -> Optional[datetime]:
    """Get the latest timestamp for a symbol."""
    engine = get_engine()

    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT MAX(timestamp) FROM ohlcv_data
            WHERE symbol = :symbol AND market = :market
        """), {"symbol": symbol, "market": market})
        row = result.fetchone()
        return row[0] if row and row[0] else None


def get_symbols(market: Optional[str] = None) -> List[str]:
    """Get list of symbols in database."""
    engine = get_engine()

    query = "SELECT DISTINCT symbol FROM ohlcv_data"
    params = {}

    if market:
        query += " WHERE market = :market"
        params["market"] = market

    query += " ORDER BY symbol"

    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        return [row[0] for row in result.fetchall()]


def get_data_summary() -> pd.DataFrame:
    """Get summary of data in database."""
    engine = get_engine()

    query = """
        SELECT
            symbol,
            market,
            COUNT(*) as rows,
            MIN(timestamp) as first_date,
            MAX(timestamp) as last_date,
            DATE_PART('day', MAX(timestamp) - MIN(timestamp)) as days_span
        FROM ohlcv_data
        GROUP BY symbol, market
        ORDER BY market, symbol
    """

    return pd.read_sql(text(query), engine)


def delete_ohlcv(
    symbol: str,
    market: str = "US",
    before_date: Optional[datetime] = None
) -> int:
    """
    Delete OHLCV data for a symbol.

    Args:
        symbol: Stock symbol
        market: Market code
        before_date: Only delete data before this date

    Returns:
        Number of rows deleted
    """
    engine = get_engine()

    query = "DELETE FROM ohlcv_data WHERE symbol = :symbol AND market = :market"
    params: Dict[str, Any] = {"symbol": symbol, "market": market}

    if before_date:
        query += " AND timestamp < :before_date"
        params["before_date"] = before_date

    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        conn.commit()
        deleted = result.rowcount

    logger.info(f"Deleted {deleted} rows for {symbol}")
    return deleted


# =============================================================================
# TimescaleDB Specific Functions
# =============================================================================

def compress_chunks(older_than: str = "7 days") -> int:
    """
    Compress old chunks to save space.

    Args:
        older_than: Compress chunks older than this interval

    Returns:
        Number of chunks compressed
    """
    engine = get_engine()

    with engine.connect() as conn:
        # Enable compression on hypertable if not already enabled
        try:
            conn.execute(text("""
                ALTER TABLE ohlcv_data SET (
                    timescaledb.compress,
                    timescaledb.compress_segmentby = 'symbol, market'
                )
            """))
            conn.commit()
        except Exception:
            pass  # Already enabled

        # Compress old chunks
        result = conn.execute(text(f"""
            SELECT compress_chunk(i, if_not_compressed => true)
            FROM show_chunks('ohlcv_data', older_than => INTERVAL '{older_than}') i
        """))
        chunks = result.fetchall()
        conn.commit()

    return len(chunks)


def get_time_bucket_ohlcv(
    symbol: str,
    market: str = "US",
    bucket: str = "1 day",
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> pd.DataFrame:
    """
    Get OHLCV data aggregated by time bucket.

    Args:
        symbol: Stock symbol
        market: Market code
        bucket: Time bucket (e.g., '1 hour', '1 day', '1 week')
        start_date: Start date
        end_date: End date

    Returns:
        DataFrame with aggregated OHLCV
    """
    engine = get_engine()

    query = f"""
        SELECT
            time_bucket('{bucket}', timestamp) AS timestamp,
            first(open, timestamp) AS open,
            MAX(high) AS high,
            MIN(low) AS low,
            last(close, timestamp) AS close,
            SUM(volume) AS volume
        FROM ohlcv_data
        WHERE symbol = :symbol AND market = :market
    """
    params: Dict[str, Any] = {"symbol": symbol, "market": market}

    if start_date:
        query += " AND timestamp >= :start_date"
        params["start_date"] = start_date

    if end_date:
        query += " AND timestamp <= :end_date"
        params["end_date"] = end_date

    query += " GROUP BY 1 ORDER BY 1"

    df = pd.read_sql(text(query), engine, params=params)

    if not df.empty:
        df.set_index("timestamp", inplace=True)
        df.index = pd.to_datetime(df.index)

    return df
