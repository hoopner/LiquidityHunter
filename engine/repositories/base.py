from dataclasses import dataclass
from typing import List, Optional
from datetime import datetime


@dataclass
class OHLCVData:
    """
    Standard data format returned by ALL repositories.
    No matter where the data comes from (KIS, Alpaca, PostgreSQL),
    it MUST be converted to this format before returning.
    """
    timestamps: List[int]    # Unix seconds (int). Always. No exceptions.
    open: List[float]
    high: List[float]
    low: List[float]
    close: List[float]
    volume: List[float]

    def __len__(self):
        return len(self.timestamps)

    def is_empty(self):
        return len(self.timestamps) == 0


class MarketDataRepository:
    """
    Interface that all data sources must implement.
    KISRepository, AlpacaRepository inherit from this.
    """

    def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None
    ) -> OHLCVData:
        """
        Fetch OHLCV data.

        Args:
            symbol: Stock ticker (e.g., "005930", "AAPL")
            timeframe: STRICT codes — case matters!
                       Minutes: 1m, 5m, 15m (lowercase m)
                       Hours: 1h, 4h (lowercase h)
                       Day/Week/Month: 1D, 1W, 1M (UPPERCASE)
            start: Start date (None = maximum available history)
            end: End date (None = now)

        Returns:
            OHLCVData with timestamps sorted ascending (oldest first).
        """
        raise NotImplementedError

    def get_realtime_price(self, symbol: str) -> Optional[float]:
        """Get current price."""
        raise NotImplementedError
