"""
Alpaca Repository

Fetches US stock OHLCV data from Alpaca Markets API.
Converts results into the standard OHLCVData format with Unix-second timestamps.
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from dotenv import load_dotenv

from engine.repositories.base import OHLCVData, MarketDataRepository

load_dotenv()
logger = logging.getLogger(__name__)

# Alpaca API configuration (same env vars as app.py)
ALPACA_API_KEY = os.getenv("ALPACA_API_KEY", "")
ALPACA_API_SECRET = os.getenv("ALPACA_API_SECRET", "")
ALPACA_DATA_URL = "https://data.alpaca.markets/v2"

# Timeframe mapping: our codes -> Alpaca API codes
# CASE-SENSITIVE: 1m=minute, 1M=month
TIMEFRAME_MAP = {
    "1m": "1Min",
    "5m": "5Min",
    "15m": "15Min",
    "30m": "30Min",
    "1h": "1Hour",
    "1H": "1Hour",
    "4h": "4Hour",
    "4H": "4Hour",
    "1D": "1Day",
    "1d": "1Day",
    "1W": "1Week",
    "1w": "1Week",
    "1M": "1Month",
    "1mo": "1Month",
}

# Default lookback periods for each timeframe (in days)
DEFAULT_LOOKBACK = {
    "1m": 7,       # 1 week (Alpaca limit for free tier)
    "5m": 30,      # 1 month
    "15m": 60,     # 2 months
    "30m": 90,     # 3 months
    "1h": 180,     # 6 months
    "1H": 180,
    "4h": 365,     # 1 year
    "4H": 365,
    "1D": 730,     # 2 years
    "1d": 730,
    "1W": 1825,    # 5 years
    "1w": 1825,
    "1M": 3650,    # 10 years
    "1mo": 3650,
}


class AlpacaRepository(MarketDataRepository):
    """
    Repository for US stock data via Alpaca Markets API.

    Supports all timeframes from 1m to 1M.
    API keys are read from ALPACA_API_KEY / ALPACA_API_SECRET env vars.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
    ):
        self.api_key = api_key or ALPACA_API_KEY
        self.api_secret = api_secret or ALPACA_API_SECRET
        self.base_url = ALPACA_DATA_URL

    @property
    def is_configured(self) -> bool:
        """Check if Alpaca API credentials are available."""
        return bool(self.api_key and self.api_secret)

    def _get_headers(self) -> dict:
        """Build authentication headers."""
        return {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.api_secret,
        }

    def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        limit: int = 10000,
    ) -> OHLCVData:
        """
        Fetch OHLCV data from Alpaca API.

        Args:
            symbol: US stock ticker (e.g., "AAPL", "MSFT")
            timeframe: 1m, 5m, 15m, 1h, 1D, 1W, 1M (case-sensitive)
            start: Start date (None = auto-calculated based on timeframe)
            end: End date (None = now)
            limit: Max bars to return (default 10000)

        Returns:
            OHLCVData with timestamps as Unix seconds, sorted ascending.
        """
        if not self.is_configured:
            logger.warning("[AlpacaRepo] API keys not configured, returning empty data")
            return self._empty()

        # Map timeframe to Alpaca format
        alpaca_tf = TIMEFRAME_MAP.get(timeframe)
        if not alpaca_tf:
            logger.warning(f"[AlpacaRepo] Unsupported timeframe: {timeframe}")
            return self._empty()

        # Calculate start date if not provided
        if start is None:
            days_back = DEFAULT_LOOKBACK.get(timeframe, 30)
            start = datetime.now(timezone.utc) - timedelta(days=days_back)

        start_str = start.strftime("%Y-%m-%dT00:00:00Z")
        end_str = end.strftime("%Y-%m-%dT23:59:59Z") if end else None

        try:
            all_bars = self._fetch_bars_paginated(
                symbol=symbol,
                alpaca_tf=alpaca_tf,
                start_str=start_str,
                end_str=end_str,
                limit=limit,
            )

            if not all_bars:
                logger.info(f"[AlpacaRepo] No data for {symbol} {timeframe}")
                return self._empty()

            # Convert to OHLCVData
            timestamps = []
            opens = []
            highs = []
            lows = []
            closes = []
            volumes = []

            for bar in all_bars:
                ts = self._parse_alpaca_timestamp(bar.get("t", ""))
                if ts == 0:
                    continue

                timestamps.append(ts)
                opens.append(float(bar.get("o", 0)))
                highs.append(float(bar.get("h", 0)))
                lows.append(float(bar.get("l", 0)))
                closes.append(float(bar.get("c", 0)))
                volumes.append(float(bar.get("v", 0)))

            data = OHLCVData(
                timestamps=timestamps,
                open=opens,
                high=highs,
                low=lows,
                close=closes,
                volume=volumes,
            )

            # Ensure ascending sort
            data = self._sort_ascending(data)

            logger.info(
                f"[AlpacaRepo] {symbol} {timeframe}: "
                f"{len(data)} bars returned"
            )
            return data

        except Exception as e:
            logger.error(f"[AlpacaRepo] Error fetching {symbol} {timeframe}: {e}")
            return self._empty()

    def _fetch_bars_paginated(
        self,
        symbol: str,
        alpaca_tf: str,
        start_str: str,
        end_str: Optional[str],
        limit: int,
    ) -> list:
        """
        Fetch bars from Alpaca with pagination support.

        Alpaca returns max ~10000 bars per request. If more are needed,
        use the next_page_token for pagination.

        Returns list of bar dicts.
        """
        url = f"{self.base_url}/stocks/{symbol}/bars"
        headers = self._get_headers()

        params = {
            "timeframe": alpaca_tf,
            "start": start_str,
            "limit": min(limit, 10000),
            "feed": "iex",  # 'iex' for free tier, 'sip' for paid
            "sort": "asc",
        }
        if end_str:
            params["end"] = end_str

        all_bars = []
        max_pages = 10  # Safety limit to prevent infinite loops

        for page in range(max_pages):
            try:
                logger.debug(
                    f"[AlpacaRepo] Fetching {symbol} {alpaca_tf} page {page + 1}"
                )
                resp = requests.get(
                    url, headers=headers, params=params, timeout=30
                )

                if resp.status_code != 200:
                    logger.error(
                        f"[AlpacaRepo] API error {resp.status_code}: "
                        f"{resp.text[:200]}"
                    )
                    break

                data = resp.json()
                bars = data.get("bars", [])

                if not bars:
                    break

                all_bars.extend(bars)

                # Check if we have enough or if there are more pages
                if len(all_bars) >= limit:
                    all_bars = all_bars[:limit]
                    break

                next_token = data.get("next_page_token")
                if not next_token:
                    break

                # Set up next page request
                params["page_token"] = next_token

            except requests.exceptions.Timeout:
                logger.error(f"[AlpacaRepo] Timeout on page {page + 1}")
                break
            except Exception as e:
                logger.error(f"[AlpacaRepo] Error on page {page + 1}: {e}")
                break

        return all_bars

    def get_realtime_price(self, symbol: str) -> Optional[float]:
        """
        Get latest trade price from Alpaca.

        Args:
            symbol: US stock ticker

        Returns:
            Latest price as float, or None if unavailable.
        """
        if not self.is_configured:
            return None

        try:
            url = f"{self.base_url}/stocks/{symbol}/trades/latest"
            headers = self._get_headers()
            params = {"feed": "iex"}

            resp = requests.get(url, headers=headers, params=params, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                trade = data.get("trade", {})
                price = float(trade.get("p", 0))
                if price > 0:
                    return price
        except Exception as e:
            logger.error(f"[AlpacaRepo] Price fetch error for {symbol}: {e}")

        return None

    @staticmethod
    def _parse_alpaca_timestamp(ts_str: str) -> int:
        """
        Convert Alpaca ISO timestamp to Unix seconds.

        Alpaca returns timestamps like:
          "2024-01-31T14:30:00Z"
          "2024-01-31T09:30:00-05:00"
        """
        if not ts_str:
            return 0

        try:
            # Handle Z suffix and timezone-aware ISO strings
            ts_str = ts_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts_str)
            return int(dt.timestamp())
        except (ValueError, TypeError):
            logger.warning(f"[AlpacaRepo] Failed to parse timestamp: {ts_str}")
            return 0

    @staticmethod
    def _empty() -> OHLCVData:
        """Return empty OHLCVData."""
        return OHLCVData(
            timestamps=[], open=[], high=[], low=[], close=[], volume=[]
        )

    @staticmethod
    def _sort_ascending(data: OHLCVData) -> OHLCVData:
        """Sort bars by timestamp ascending (oldest first)."""
        if data.is_empty() or len(data.timestamps) <= 1:
            return data

        # Check if already sorted
        is_sorted = all(
            data.timestamps[i] <= data.timestamps[i + 1]
            for i in range(len(data.timestamps) - 1)
        )
        if is_sorted:
            return data

        # Sort by timestamp
        indices = sorted(
            range(len(data.timestamps)), key=lambda i: data.timestamps[i]
        )
        return OHLCVData(
            timestamps=[data.timestamps[i] for i in indices],
            open=[data.open[i] for i in indices],
            high=[data.high[i] for i in indices],
            low=[data.low[i] for i in indices],
            close=[data.close[i] for i in indices],
            volume=[data.volume[i] for i in indices],
        )
