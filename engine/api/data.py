"""CSV data loader for OHLCV data with dynamic yfinance fetching."""

import csv
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np


@dataclass
class OHLCVData:
    """OHLCV data arrays."""
    timestamps: List[str]
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray


# yfinance interval mapping and lookback limits
TIMEFRAME_CONFIG = {
    "1m": {"interval": "1m", "max_days": 7, "period": "7d"},
    "5m": {"interval": "5m", "max_days": 60, "period": "60d"},
    "15m": {"interval": "15m", "max_days": 60, "period": "60d"},
    "30m": {"interval": "30m", "max_days": 60, "period": "60d"},
    "1h": {"interval": "1h", "max_days": 730, "period": "730d"},
    "1H": {"interval": "1h", "max_days": 730, "period": "730d"},
    "4h": {"interval": "1h", "max_days": 730, "period": "730d", "resample": 4},  # yfinance doesn't support 4h, so use 1h and resample
    "4H": {"interval": "1h", "max_days": 730, "period": "730d", "resample": 4},
    "1D": {"interval": "1d", "max_days": 3650, "period": "max"},
    "1d": {"interval": "1d", "max_days": 3650, "period": "max"},
    "1W": {"interval": "1wk", "max_days": 7300, "period": "max"},
    "1w": {"interval": "1wk", "max_days": 7300, "period": "max"},
    "1M": {"interval": "1mo", "max_days": 36500, "period": "max"},
    "1mo": {"interval": "1mo", "max_days": 36500, "period": "max"},
}

# Filename suffix mapping to avoid case-insensitive collisions (macOS)
# 1m vs 1M would clash, so we use distinct suffixes
TIMEFRAME_FILESUFFIX = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1hour",
    "1H": "1hour",
    "4h": "4hour",
    "4H": "4hour",
    "1D": "1day",
    "1d": "1day",
    "1W": "1week",
    "1w": "1week",
    "1M": "1month",
    "1mo": "1month",
}


def get_file_suffix(timeframe: str) -> str:
    """Get filesystem-safe suffix for timeframe to avoid case collisions."""
    return TIMEFRAME_FILESUFFIX.get(timeframe, timeframe)


def get_yf_ticker(symbol: str, market: str) -> str:
    """Get yfinance ticker symbol."""
    if market.upper() == "KR":
        # Korean stocks: add .KS suffix for KOSPI, .KQ for KOSDAQ
        # Most Korean stocks are on KOSPI
        return f"{symbol}.KS"
    return symbol


def fetch_from_yfinance(
    symbol: str,
    market: str,
    timeframe: str,
    save_to_file: bool = True,
    data_dir: str = "data"
) -> Optional[OHLCVData]:
    """
    Fetch OHLCV data from yfinance.

    Args:
        symbol: Symbol name
        market: Market (KR or US)
        timeframe: Timeframe (1m, 5m, 15m, 1h, 1D, 1W, 1M)
        save_to_file: Whether to save fetched data to CSV
        data_dir: Directory to save CSV files

    Returns:
        OHLCVData or None if fetch fails
    """
    try:
        import yfinance as yf
    except ImportError:
        print("yfinance not installed. Run: pip install yfinance")
        return None

    # Get timeframe config
    tf_config = TIMEFRAME_CONFIG.get(timeframe)
    if not tf_config:
        print(f"Unknown timeframe: {timeframe}")
        return None

    ticker = get_yf_ticker(symbol, market)
    interval = tf_config["interval"]
    period = tf_config["period"]
    resample = tf_config.get("resample")

    try:
        stock = yf.Ticker(ticker)

        # For intraday data, we need to be careful about the period
        if interval in ("1m", "5m", "15m", "30m", "1h"):
            # Use period for intraday
            df = stock.history(period=period, interval=interval)
        else:
            # For daily and above, use max period
            df = stock.history(period="max", interval=interval)

        if df.empty:
            print(f"No data returned for {ticker} {timeframe}")
            return None

        # Resample if needed (for 4h)
        if resample and resample > 1:
            df = df.resample(f'{resample}h').agg({
                'Open': 'first',
                'High': 'max',
                'Low': 'min',
                'Close': 'last',
                'Volume': 'sum'
            }).dropna()

        # Reset index and format
        df = df.reset_index()

        # Handle different index column names
        if 'Datetime' in df.columns:
            date_col = 'Datetime'
        elif 'Date' in df.columns:
            date_col = 'Date'
        else:
            date_col = df.columns[0]

        # Format timestamps based on timeframe
        if interval in ("1m", "5m", "15m", "30m", "1h"):
            # Include time for intraday
            timestamps = df[date_col].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
        else:
            # Date only for daily and above
            timestamps = df[date_col].dt.strftime('%Y-%m-%d').tolist()

        # Build data
        data = OHLCVData(
            timestamps=timestamps,
            open=df['Open'].values.astype(float),
            high=df['High'].values.astype(float),
            low=df['Low'].values.astype(float),
            close=df['Close'].values.astype(float),
            volume=df['Volume'].values.astype(float),
        )

        # Save to file if requested
        if save_to_file and len(data.close) > 0:
            save_dir = Path(data_dir) / market.lower()
            save_dir.mkdir(parents=True, exist_ok=True)
            file_suffix = get_file_suffix(timeframe)
            filepath = save_dir / f"{symbol}_{file_suffix}.csv"

            df_save = df[[date_col, 'Open', 'High', 'Low', 'Close', 'Volume']].copy()
            df_save.columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']

            if interval in ("1m", "5m", "15m", "30m", "1h"):
                df_save['Date'] = df[date_col].dt.strftime('%Y-%m-%d %H:%M:%S')
            else:
                df_save['Date'] = df[date_col].dt.strftime('%Y-%m-%d')

            df_save.to_csv(filepath, index=False)

        return data

    except Exception as e:
        print(f"Error fetching {symbol} {timeframe}: {e}")
        return None


def load_csv(symbol: str, timeframe: str, data_dir: str = "data") -> OHLCVData:
    """
    Load OHLCV data from CSV file, falling back to yfinance if not found.

    Args:
        symbol: Symbol name (e.g., "SAMPLE")
        timeframe: Timeframe (e.g., "1D", "1m", "5m", "1h", "1W", "1M")
        data_dir: Directory containing CSV files

    Returns:
        OHLCVData with arrays

    Raises:
        FileNotFoundError: If CSV file doesn't exist and yfinance fetch fails
    """
    file_suffix = get_file_suffix(timeframe)
    filename = f"{symbol}_{file_suffix}.csv"
    filepath = Path(data_dir) / filename

    # Try new naming first
    if filepath.exists():
        return _load_csv_file(filepath)

    # Backward compatibility: try old naming scheme (e.g., PLTR_1D.csv)
    old_filename = f"{symbol}_{timeframe}.csv"
    old_filepath = Path(data_dir) / old_filename
    if old_filepath.exists():
        return _load_csv_file(old_filepath)

    # Extract market from data_dir path
    market = "US"
    if "kr" in data_dir.lower():
        market = "KR"
    elif "us" in data_dir.lower():
        market = "US"

    # Try to fetch from yfinance
    print(f"Data file not found: {filepath}, fetching from yfinance...")
    data = fetch_from_yfinance(symbol, market, timeframe, save_to_file=True, data_dir=data_dir.replace(f"/{market.lower()}", ""))

    if data is not None and len(data.close) > 0:
        return data

    raise FileNotFoundError(f"Data file not found: {filepath} and yfinance fetch failed")


def _load_csv_file(filepath: Path) -> OHLCVData:
    """Load OHLCV data from an existing CSV file."""
    timestamps = []
    opens = []
    highs = []
    lows = []
    closes = []
    volumes = []

    with open(filepath, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Handle both "Date" and "timestamp" column names
            date_val = row.get("Date") or row.get("timestamp") or row.get("date", "")
            timestamps.append(date_val)
            # Handle both capitalized and lowercase column names
            opens.append(float(row.get("Open") or row.get("open", 0)))
            highs.append(float(row.get("High") or row.get("high", 0)))
            lows.append(float(row.get("Low") or row.get("low", 0)))
            closes.append(float(row.get("Close") or row.get("close", 0)))
            volumes.append(float(row.get("Volume") or row.get("volume", 0)))

    return OHLCVData(
        timestamps=timestamps,
        open=np.array(opens),
        high=np.array(highs),
        low=np.array(lows),
        close=np.array(closes),
        volume=np.array(volumes),
    )


def is_data_stale(filepath: Path, timeframe: str) -> bool:
    """
    Check if cached data file is stale and needs refresh.

    For intraday timeframes, data older than 1 hour is considered stale.
    For daily, data older than 1 day is stale.
    """
    if not filepath.exists():
        return True

    mtime = datetime.fromtimestamp(filepath.stat().st_mtime)
    now = datetime.now()
    age = now - mtime

    if timeframe in ("1m", "5m", "15m", "30m"):
        # Intraday: stale after 1 hour
        return age > timedelta(hours=1)
    elif timeframe in ("1h", "1H", "4h", "4H"):
        # Hourly: stale after 4 hours
        return age > timedelta(hours=4)
    elif timeframe in ("1D", "1d"):
        # Daily: stale after 1 day
        return age > timedelta(days=1)
    else:
        # Weekly/Monthly: stale after 1 week
        return age > timedelta(weeks=1)


def load_with_refresh(
    symbol: str,
    market: str,
    timeframe: str,
    data_dir: str = "data",
    force_refresh: bool = False
) -> OHLCVData:
    """
    Load OHLCV data, refreshing from yfinance if stale.

    Args:
        symbol: Symbol name
        market: Market (KR or US)
        timeframe: Timeframe
        data_dir: Base data directory
        force_refresh: Force refresh from yfinance

    Returns:
        OHLCVData
    """
    full_data_dir = f"{data_dir}/{market.lower()}"
    file_suffix = get_file_suffix(timeframe)
    filename = f"{symbol}_{file_suffix}.csv"
    filepath = Path(full_data_dir) / filename

    # Also check old naming scheme for staleness check
    old_filename = f"{symbol}_{timeframe}.csv"
    old_filepath = Path(full_data_dir) / old_filename

    # Use old file for staleness if new file doesn't exist
    check_filepath = filepath if filepath.exists() else old_filepath

    # Check if refresh is needed
    if force_refresh or is_data_stale(check_filepath, timeframe):
        data = fetch_from_yfinance(symbol, market, timeframe, save_to_file=True, data_dir=data_dir)
        if data is not None:
            return data

    # Fall back to loading from file or fetching
    return load_csv(symbol, timeframe, data_dir=full_data_dir)
