"""
Market Data Service

Orchestrator that fetches OHLCV data from the appropriate repository
and calculates all technical indicators.

This replaces the inline logic in app.py's /ohlcv endpoint.
"""

import time
import logging
from typing import List

import numpy as np

from engine.repositories.base import OHLCVData
from engine.repositories.kis_repository import KISRepository
from engine.repositories.alpaca_repository import AlpacaRepository
from engine.repositories.yfinance_repository import YFinanceRepository

# Import existing indicator functions — do NOT reimplement
from engine.core.screener import ema, rsi, macd
from engine.indicators.bollinger_bands import (
    calculate_bb1,
    calculate_bb2,
    calculate_rsi_with_bb,
)
from engine.indicators.vwap import calculate_vwap
from engine.indicators.keltner import calculate_keltner_channel, calculate_ttm_squeeze

logger = logging.getLogger(__name__)


def _nan_to_val(arr: np.ndarray, default=0) -> List:
    """Convert numpy array to list, replacing NaN with a default value."""
    return [float(v) if not np.isnan(v) else default for v in arr]


def _nan_to_none(arr: np.ndarray) -> List:
    """Convert numpy array to list, replacing NaN with None."""
    return [float(v) if not np.isnan(v) else None for v in arr]


def _sma(values: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate Simple Moving Average.
    Copied from app.py's inline sma() — same logic, same behavior.
    """
    result = np.full(len(values), np.nan)
    for i in range(period - 1, len(values)):
        window = values[i - period + 1:i + 1]
        valid = window[~np.isnan(window)]
        if len(valid) >= period // 2:
            result[i] = np.mean(valid)
    return result


def _stochastic(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    fastk_period: int,
    slowk_period: int,
    slowd_period: int,
) -> tuple:
    """
    Calculate Stochastic Oscillator with smoothing.
    Copied from app.py's inline stochastic() — same logic, same behavior.

    Returns: (slow_k, slow_d) arrays
    """
    n = len(close)

    # Fast %K (raw stochastic)
    fast_k = np.full(n, np.nan)
    for i in range(fastk_period - 1, n):
        period_high = np.max(high[i - fastk_period + 1:i + 1])
        period_low = np.min(low[i - fastk_period + 1:i + 1])
        if period_high != period_low:
            fast_k[i] = 100 * (close[i] - period_low) / (period_high - period_low)
        else:
            fast_k[i] = 50

    # Slow %K = SMA of Fast %K
    slow_k = np.full(n, np.nan)
    for i in range(fastk_period - 1 + slowk_period - 1, n):
        window = fast_k[i - slowk_period + 1:i + 1]
        valid = window[~np.isnan(window)]
        if len(valid) == slowk_period:
            slow_k[i] = np.mean(valid)

    # Slow %D = SMA of Slow %K
    slow_d = np.full(n, np.nan)
    for i in range(fastk_period - 1 + slowk_period - 1 + slowd_period - 1, n):
        window = slow_k[i - slowd_period + 1:i + 1]
        valid = window[~np.isnan(window)]
        if len(valid) == slowd_period:
            slow_d[i] = np.mean(valid)

    return slow_k, slow_d


class MarketDataService:
    """
    Orchestrates data fetching from repositories and indicator calculation.

    Routes:
      KR market → KISRepository
      US market → AlpacaRepository only
    """

    _INTRADAY_TFS = {"1m", "5m", "15m", "30m", "1h", "1H", "4h", "4H"}

    def __init__(self):
        self.kis_repo = KISRepository()
        self.alpaca_repo = AlpacaRepository()
        self.yfinance_repo = YFinanceRepository()

    def get_ohlcv(self, symbol: str, market: str, timeframe: str) -> dict:
        """
        Fetch OHLCV data and calculate all indicators.

        Args:
            symbol: Stock ticker (e.g., "005930", "AAPL")
            market: "KR" or "US"
            timeframe: 1m, 5m, 15m, 1h, 1D, 1W, 1M

        Returns:
            Dict with bars, indicators, and metadata.
        """
        market = market.upper()
        symbol = symbol.upper()

        # Fetch raw data from appropriate repository
        data, source = self._fetch_data(symbol, market, timeframe)

        if data.is_empty():
            return self._empty_response(symbol, market, timeframe, source)

        # Build bars list (timestamps already Unix int from repositories)
        bars = []
        for i in range(len(data.timestamps)):
            bars.append({
                "time": data.timestamps[i],
                "open": data.open[i],
                "high": data.high[i],
                "low": data.low[i],
                "close": data.close[i],
                "volume": data.volume[i],
            })

        # Calculate indicators
        indicators = self._calculate_indicators(data, timeframe)

        return {
            "symbol": symbol,
            "market": market,
            "timeframe": timeframe,
            "data_source": source,
            "last_updated": int(time.time()),
            "bars": bars,
            "indicators": indicators,
        }

    def _fetch_data(
        self, symbol: str, market: str, timeframe: str
    ) -> tuple[OHLCVData, str]:
        """
        Fetch data from the appropriate repository per market.

        KR intraday → yfinance (past days) + KIS (today), merged
        KR daily    → KIS only
        US          → Alpaca only
        """
        empty = OHLCVData(
            timestamps=[], open=[], high=[], low=[], close=[], volume=[]
        )

        if market == "KR":
            if timeframe in self._INTRADAY_TFS:
                # Past data from yfinance + today from KIS
                yf_data = self.yfinance_repo.get_ohlcv(symbol, timeframe)
                kis_data = self.kis_repo.get_ohlcv(
                    symbol, timeframe, market="KR", count=500
                )
                data = self._merge_ohlcv(yf_data, kis_data)
                source = "yfinance+kis"
            else:
                # Daily/Weekly/Monthly — KIS only
                data = self.kis_repo.get_ohlcv(
                    symbol, timeframe, market="KR", count=500
                )
                source = "kis"
            return (data, source) if not data.is_empty() else (empty, source)

        elif market == "US":
            data = self.alpaca_repo.get_ohlcv(symbol, timeframe)
            return (data, "alpaca") if not data.is_empty() else (empty, "alpaca")

        return empty, "unavailable"

    @staticmethod
    def _merge_ohlcv(past: OHLCVData, today: OHLCVData) -> OHLCVData:
        """Merge past (yfinance) and today (KIS) data.

        Concatenates, deduplicates by timestamp (today wins), sorts ascending.
        """
        merged: dict = {}

        for i in range(len(past.timestamps)):
            ts = past.timestamps[i]
            merged[ts] = (
                past.open[i], past.high[i], past.low[i],
                past.close[i], past.volume[i],
            )

        # Today's data overwrites any duplicates from past
        for i in range(len(today.timestamps)):
            ts = today.timestamps[i]
            merged[ts] = (
                today.open[i], today.high[i], today.low[i],
                today.close[i], today.volume[i],
            )

        sorted_ts = sorted(merged.keys())
        return OHLCVData(
            timestamps=sorted_ts,
            open=[merged[ts][0] for ts in sorted_ts],
            high=[merged[ts][1] for ts in sorted_ts],
            low=[merged[ts][2] for ts in sorted_ts],
            close=[merged[ts][3] for ts in sorted_ts],
            volume=[merged[ts][4] for ts in sorted_ts],
        )

    def _calculate_indicators(self, data: OHLCVData, timeframe: str) -> dict:
        """
        Calculate all technical indicators from OHLCV data.

        Uses the same functions and parameters as app.py's /ohlcv endpoint.
        """
        n = len(data.timestamps)
        close = np.array(data.close, dtype=np.float64)
        high = np.array(data.high, dtype=np.float64)
        low = np.array(data.low, dtype=np.float64)
        volume = np.array(data.volume, dtype=np.float64)

        result = {}

        # EMA (20, 200)
        try:
            result["ema20"] = _nan_to_none(ema(close, 20))
            result["ema200"] = _nan_to_none(ema(close, 200))
        except Exception as e:
            logger.warning(f"EMA calculation failed: {e}")
            result["ema20"] = [None] * n
            result["ema200"] = [None] * n

        # SMA (20, 200)
        try:
            result["sma20"] = _nan_to_none(_sma(close, 20))
            result["sma200"] = _nan_to_none(_sma(close, 200))
        except Exception as e:
            logger.warning(f"SMA calculation failed: {e}")
            result["sma20"] = [None] * n
            result["sma200"] = [None] * n

        # RSI (14) + Signal(9)
        try:
            rsi_values = rsi(close, 14)
            rsi_signal_values = _sma(rsi_values, 9)
            result["rsi"] = _nan_to_val(rsi_values, 50)
            result["rsi_signal"] = _nan_to_val(rsi_signal_values, 50)
        except Exception as e:
            logger.warning(f"RSI calculation failed: {e}")
            result["rsi"] = [50] * n
            result["rsi_signal"] = [50] * n

        # MACD (12, 26, 9)
        try:
            ml, ms, mh = macd(close, 12, 26, 9)
            result["macd_line"] = _nan_to_val(ml, 0)
            result["macd_signal"] = _nan_to_val(ms, 0)
            result["macd_hist"] = _nan_to_val(mh, 0)
        except Exception as e:
            logger.warning(f"MACD calculation failed: {e}")
            result["macd_line"] = [0] * n
            result["macd_signal"] = [0] * n
            result["macd_hist"] = [0] * n

        # Stochastic: Slow (20,12,12), Med (10,6,6), Fast (5,3,3)
        try:
            sk, sd = _stochastic(high, low, close, 20, 12, 12)
            result["stoch_slow_k"] = _nan_to_val(sk, 50)
            result["stoch_slow_d"] = _nan_to_val(sd, 50)

            mk, md = _stochastic(high, low, close, 10, 6, 6)
            result["stoch_med_k"] = _nan_to_val(mk, 50)
            result["stoch_med_d"] = _nan_to_val(md, 50)

            fk, fd = _stochastic(high, low, close, 5, 3, 3)
            result["stoch_fast_k"] = _nan_to_val(fk, 50)
            result["stoch_fast_d"] = _nan_to_val(fd, 50)
        except Exception as e:
            logger.warning(f"Stochastic calculation failed: {e}")
            for k in ("stoch_slow_k", "stoch_slow_d", "stoch_med_k",
                       "stoch_med_d", "stoch_fast_k", "stoch_fast_d"):
                result[k] = [50] * n

        # Bollinger Bands: BB1 (20,0.5), BB2 (20,3.0)
        try:
            b1u, b1m, b1l = calculate_bb1(close)
            result["bb1_upper"] = _nan_to_val(b1u, 0)
            result["bb1_lower"] = _nan_to_val(b1l, 0)

            b2u, b2m, b2l = calculate_bb2(close)
            result["bb2_upper"] = _nan_to_val(b2u, 0)
            result["bb2_lower"] = _nan_to_val(b2l, 0)
        except Exception as e:
            logger.warning(f"BB calculation failed: {e}")
            result["bb1_upper"] = [0] * n
            result["bb1_lower"] = [0] * n
            result["bb2_upper"] = [0] * n
            result["bb2_lower"] = [0] * n

        # RSI with Bollinger Band (14, 30, 2.0) — for subchart
        try:
            _, rsi_bb_u, rsi_bb_m, rsi_bb_l = calculate_rsi_with_bb(
                close, rsi_period=14, bb_length=30, bb_std_dev=2.0
            )
            result["rsi_bb_upper"] = _nan_to_val(rsi_bb_u, 50)
            result["rsi_bb_lower"] = _nan_to_val(rsi_bb_l, 50)
        except Exception as e:
            logger.warning(f"RSI BB calculation failed: {e}")
            result["rsi_bb_upper"] = [50] * n
            result["rsi_bb_lower"] = [50] * n

        # VWAP (intraday only)
        try:
            # VWAP expects timestamps as list (str or int)
            vwap_values = calculate_vwap(
                timestamps=[str(t) for t in data.timestamps],
                high=high,
                low=low,
                close=close,
                volume=volume,
                timeframe=timeframe,
            )
            result["vwap"] = _nan_to_val(vwap_values, 0)
        except Exception as e:
            logger.warning(f"VWAP calculation failed: {e}")
            result["vwap"] = [0] * n

        # Keltner Channel + TTM Squeeze
        try:
            kc_u, kc_m, kc_l = calculate_keltner_channel(
                high=high, low=low, close=close,
                ema_period=20, atr_period=10, multiplier=1.5,
            )
            result["kc_upper"] = _nan_to_val(kc_u, 0)
            result["kc_lower"] = _nan_to_val(kc_l, 0)

            squeeze = calculate_ttm_squeeze(
                bb_upper=np.array(result["bb2_upper"]),
                bb_lower=np.array(result["bb2_lower"]),
                kc_upper=kc_u,
                kc_lower=kc_l,
            )
            result["squeeze"] = [bool(v) for v in squeeze]
        except Exception as e:
            logger.warning(f"KC/Squeeze calculation failed: {e}")
            result["kc_upper"] = [0] * n
            result["kc_lower"] = [0] * n
            result["squeeze"] = [False] * n

        return result

    @staticmethod
    def _empty_response(
        symbol: str, market: str, timeframe: str, source: str
    ) -> dict:
        """Return empty response when no data is available."""
        return {
            "symbol": symbol,
            "market": market,
            "timeframe": timeframe,
            "data_source": source,
            "last_updated": int(time.time()),
            "bars": [],
            "indicators": {
                "ema20": [], "ema200": [],
                "sma20": [], "sma200": [],
                "rsi": [], "rsi_signal": [],
                "macd_line": [], "macd_signal": [], "macd_hist": [],
                "stoch_slow_k": [], "stoch_slow_d": [],
                "stoch_med_k": [], "stoch_med_d": [],
                "stoch_fast_k": [], "stoch_fast_d": [],
                "bb1_upper": [], "bb1_lower": [],
                "bb2_upper": [], "bb2_lower": [],
                "rsi_bb_upper": [], "rsi_bb_lower": [],
                "vwap": [],
                "kc_upper": [], "kc_lower": [],
                "squeeze": [],
            },
        }
