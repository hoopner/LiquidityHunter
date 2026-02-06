"""
yfinance Repository — KR past intraday data ONLY.

Rules:
- ONLY used for KR market past minute data (1m, 5m, 15m, 1h)
- NEVER used for daily/weekly/monthly (KIS handles those)
- NEVER requests today's data (KIS handles today with realtime)
- Symbol conversion: "005930" → "005930.KS"
- Returns OHLCVData standard format (Unix int timestamps)
"""

import logging
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import yfinance as yf

from engine.repositories.base import OHLCVData

logger = logging.getLogger(__name__)

# yfinance interval mapping (our codes → yfinance codes)
INTERVAL_MAP = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "1H": "1h",
}

# yfinance max history per interval (days, with safety margin)
MAX_PERIOD = {
    "1m": 6,
    "5m": 55,
    "15m": 55,
    "30m": 55,
    "1h": 720,
    "1H": 720,
}

KST = ZoneInfo("Asia/Seoul")


class YFinanceRepository:
    """KR past intraday data only. Do NOT use for anything else."""

    def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        end: Optional[datetime] = None,
    ) -> OHLCVData:
        """Fetch past intraday data from yfinance (excludes today)."""
        yf_interval = INTERVAL_MAP.get(timeframe)
        if not yf_interval:
            logger.warning(f"[yfinance] Unsupported timeframe: {timeframe}")
            return self._empty()

        yf_symbol = f"{symbol}.KS"

        # End = today 00:00 KST (exclude today — KIS handles today)
        if end is None:
            end = datetime.now(KST).replace(
                hour=0, minute=0, second=0, microsecond=0
            )

        max_days = MAX_PERIOD.get(timeframe, 60)
        start = end - timedelta(days=max_days)

        logger.info(
            f"[yfinance] Fetching {yf_symbol} {yf_interval} "
            f"from {start.date()} to {end.date()}"
        )

        try:
            df = yf.download(
                yf_symbol,
                start=start.strftime("%Y-%m-%d"),
                end=end.strftime("%Y-%m-%d"),
                interval=yf_interval,
                progress=False,
                auto_adjust=True,
            )

            if df.empty:
                logger.warning(f"[yfinance] No data for {yf_symbol} {yf_interval}")
                return self._empty()

            timestamps = [int(ts.timestamp()) for ts in df.index]

            # yfinance returns MultiIndex columns: (Price, Ticker)
            col = yf_symbol
            open_vals = df[("Open", col)].tolist()
            high_vals = df[("High", col)].tolist()
            low_vals = df[("Low", col)].tolist()
            close_vals = df[("Close", col)].tolist()
            volume_vals = df[("Volume", col)].tolist()

            # NaN → 0.0 (NaN != NaN)
            def clean(vals):
                return [float(v) if v == v else 0.0 for v in vals]

            result = OHLCVData(
                timestamps=timestamps,
                open=clean(open_vals),
                high=clean(high_vals),
                low=clean(low_vals),
                close=clean(close_vals),
                volume=clean(volume_vals),
            )

            logger.info(
                f"[yfinance] Got {len(result.timestamps)} bars "
                f"for {yf_symbol} {yf_interval}"
            )
            return result

        except Exception as e:
            logger.error(f"[yfinance] Error fetching {yf_symbol}: {e}")
            return self._empty()

    @staticmethod
    def _empty() -> OHLCVData:
        return OHLCVData(
            timestamps=[], open=[], high=[], low=[], close=[], volume=[]
        )
