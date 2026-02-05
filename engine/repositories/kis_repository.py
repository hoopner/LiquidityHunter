"""
KIS (Korea Investment Securities) Repository

Wraps the existing KISClient from engine/data/kis_api.py and converts
its output into the standard OHLCVData format with Unix-second timestamps.
"""

import logging
from datetime import datetime
from typing import Optional

from engine.repositories.base import OHLCVData, MarketDataRepository
from engine.data.kis_api import get_kis_client, KISAPIError

logger = logging.getLogger(__name__)

# Timeframe mapping: our standard codes -> KIS period type
# Used to decide which KIS method to call (daily vs minute)
INTRADAY_TIMEFRAMES = {"1m", "5m", "15m", "30m", "1h", "1H", "4h", "4H"}
DAILY_TIMEFRAMES = {"1D", "1d", "1W", "1w", "1M", "1mo"}


def _date_str_to_unix(date_str: str) -> int:
    """
    Convert a date string like "2024-01-31" to Unix seconds (int).
    Treats the date as midnight UTC.
    """
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return int(dt.timestamp())
    except (ValueError, TypeError):
        logger.warning(f"Failed to parse date string: {date_str}")
        return 0


def _datetime_str_to_unix(dt_str: str) -> int:
    """
    Convert a datetime string like "2024-01-31 09:30:00" to Unix seconds (int).
    """
    try:
        # Try "YYYY-MM-DD HH:MM:SS" first
        dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        return int(dt.timestamp())
    except (ValueError, TypeError):
        pass

    try:
        # Try ISO format "YYYY-MM-DDTHH:MM:SS"
        dt = datetime.fromisoformat(dt_str)
        return int(dt.timestamp())
    except (ValueError, TypeError):
        pass

    # Try date-only fallback
    return _date_str_to_unix(dt_str.split(" ")[0].split("T")[0])


def _convert_timestamps(raw_timestamps: list) -> list[int]:
    """
    Convert a list of mixed-format timestamps to Unix seconds.
    KIS API returns:
      - Daily: date strings like "2024-01-31"
      - Minute: datetime strings like "2024-01-31 09:30:00"
      - Sometimes ISO format: "2024-01-31T09:30:00"
    """
    result = []
    for ts in raw_timestamps:
        if isinstance(ts, (int, float)):
            result.append(int(ts))
        elif isinstance(ts, str):
            if " " in ts or "T" in ts:
                result.append(_datetime_str_to_unix(ts))
            else:
                result.append(_date_str_to_unix(ts))
        else:
            result.append(0)
    return result


def _to_float_list(values: list) -> list[float]:
    """Convert a list of numeric values to list of floats."""
    return [float(v) for v in values]


class KISRepository(MarketDataRepository):
    """
    Repository for Korean and US stock data via KIS API.

    Uses the existing KISClient singleton from engine/data/kis_api.py.
    All data is converted to OHLCVData with Unix-second timestamps.
    """

    def __init__(self):
        self._client = None

    @property
    def client(self):
        """Lazy-load KIS client."""
        if self._client is None:
            self._client = get_kis_client()
        return self._client

    @property
    def is_configured(self) -> bool:
        """Check if KIS API credentials are available."""
        try:
            return self.client.is_configured
        except Exception:
            return False

    def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        market: str = "KR",
        count: int = 500,
    ) -> OHLCVData:
        """
        Fetch OHLCV data from KIS API.

        Args:
            symbol: Stock ticker (e.g., "005930" for KR, "AAPL" for US)
            timeframe: 1m, 5m, 15m, 1h, 1D, 1W, 1M (case-sensitive)
            start: Not used by KIS API (it uses count-based pagination)
            end: Optional end date
            market: "KR" or "US"
            count: Number of bars to request (default 500)

        Returns:
            OHLCVData with timestamps as Unix seconds, sorted ascending.
        """
        if not self.is_configured:
            logger.warning("[KISRepo] KIS API not configured, returning empty data")
            return self._empty()

        market = market.upper()

        try:
            # KIS get_ohlcv handles all the routing internally:
            #   KR daily  -> _get_domestic_daily_ohlcv
            #   KR minute -> _get_domestic_minute_ohlcv
            #   US daily  -> _get_overseas_daily_ohlcv
            #   US minute -> _get_overseas_minute_ohlcv
            end_date_str = end.strftime("%Y%m%d") if end else None
            raw = self.client.get_ohlcv(
                symbol=symbol,
                market=market,
                timeframe=timeframe,
                count=count,
                end_date=end_date_str,
            )

            raw_count = raw.get("count", 0)
            if raw_count == 0:
                logger.info(f"[KISRepo] No data from KIS for {symbol} {market} {timeframe}")
                return self._empty()

            # Convert timestamps to Unix seconds
            unix_timestamps = _convert_timestamps(raw["timestamps"])

            # Build OHLCVData
            data = OHLCVData(
                timestamps=unix_timestamps,
                open=_to_float_list(raw["open"]),
                high=_to_float_list(raw["high"]),
                low=_to_float_list(raw["low"]),
                close=_to_float_list(raw["close"]),
                volume=_to_float_list(raw["volume"]),
            )

            # Filter out any bars with timestamp=0 (failed parse)
            data = self._filter_invalid(data)

            # Ensure ascending sort (KIS already reverses, but verify)
            data = self._sort_ascending(data)

            logger.info(
                f"[KISRepo] {symbol} {market} {timeframe}: "
                f"{len(data)} bars returned"
            )
            return data

        except KISAPIError as e:
            logger.error(f"[KISRepo] KIS API error for {symbol} {market} {timeframe}: {e}")
            return self._empty()
        except Exception as e:
            logger.error(f"[KISRepo] Unexpected error for {symbol} {market} {timeframe}: {e}")
            return self._empty()

    def get_ohlcv_direct(
        self,
        symbol: str,
        market: str = "KR",
        count: int = 500,
    ) -> OHLCVData:
        """
        Fetch daily data using the direct chart methods (get_daily_chart / get_daily_chart_us).
        These bypass the database and return fresh data from KIS.

        Only supports daily timeframe.

        Args:
            symbol: Stock ticker
            market: "KR" or "US"
            count: Number of bars

        Returns:
            OHLCVData with Unix-second timestamps.
        """
        if not self.is_configured:
            return self._empty()

        market = market.upper()

        try:
            if market == "KR":
                raw = self.client.get_daily_chart(symbol, count=count)
            else:
                raw = self.client.get_daily_chart_us(symbol, count=count)

            bars = raw.get("bars", [])
            if not bars:
                return self._empty()

            timestamps = []
            opens = []
            highs = []
            lows = []
            closes = []
            volumes = []

            for bar in bars:
                time_val = bar.get("time", "")
                if isinstance(time_val, str):
                    ts = _date_str_to_unix(time_val)
                elif isinstance(time_val, (int, float)):
                    ts = int(time_val)
                else:
                    ts = 0

                if ts == 0:
                    continue

                timestamps.append(ts)
                opens.append(float(bar.get("open", 0)))
                highs.append(float(bar.get("high", 0)))
                lows.append(float(bar.get("low", 0)))
                closes.append(float(bar.get("close", 0)))
                volumes.append(float(bar.get("volume", 0)))

            data = OHLCVData(
                timestamps=timestamps,
                open=opens,
                high=highs,
                low=lows,
                close=closes,
                volume=volumes,
            )
            return self._sort_ascending(data)

        except KISAPIError as e:
            logger.error(f"[KISRepo] Direct chart error for {symbol}: {e}")
            return self._empty()
        except Exception as e:
            logger.error(f"[KISRepo] Direct chart unexpected error for {symbol}: {e}")
            return self._empty()

    def get_realtime_price(self, symbol: str, market: str = "KR") -> Optional[float]:
        """
        Get current price from KIS API.

        Args:
            symbol: Stock ticker
            market: "KR" or "US"

        Returns:
            Current price as float, or None if unavailable.
        """
        if not self.is_configured:
            return None

        try:
            price_data = self.client.get_current_price(symbol, market)
            if price_data:
                for field in ("price", "current_price", "stck_prpr", "close"):
                    if field in price_data:
                        val = float(price_data[field])
                        if val > 0:
                            return val
        except Exception as e:
            logger.error(f"[KISRepo] Price fetch error for {symbol}: {e}")

        return None

    @staticmethod
    def _empty() -> OHLCVData:
        """Return empty OHLCVData."""
        return OHLCVData(
            timestamps=[], open=[], high=[], low=[], close=[], volume=[]
        )

    @staticmethod
    def _filter_invalid(data: OHLCVData) -> OHLCVData:
        """Remove bars with invalid timestamps (timestamp=0)."""
        if data.is_empty():
            return data

        valid_indices = [i for i, ts in enumerate(data.timestamps) if ts > 0]
        if len(valid_indices) == len(data.timestamps):
            return data  # All valid, no filtering needed

        return OHLCVData(
            timestamps=[data.timestamps[i] for i in valid_indices],
            open=[data.open[i] for i in valid_indices],
            high=[data.high[i] for i in valid_indices],
            low=[data.low[i] for i in valid_indices],
            close=[data.close[i] for i in valid_indices],
            volume=[data.volume[i] for i in valid_indices],
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
        indices = sorted(range(len(data.timestamps)), key=lambda i: data.timestamps[i])
        return OHLCVData(
            timestamps=[data.timestamps[i] for i in indices],
            open=[data.open[i] for i in indices],
            high=[data.high[i] for i in indices],
            low=[data.low[i] for i in indices],
            close=[data.close[i] for i in indices],
            volume=[data.volume[i] for i in indices],
        )
