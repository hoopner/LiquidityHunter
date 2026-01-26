"""
EMA20/EMA200 Cross Screener for KR/US stocks.
"""

from dataclasses import dataclass
from math import ceil
from typing import Callable, List, Optional

import numpy as np


@dataclass
class ScreenResult:
    """Screening result for a single symbol."""
    symbol: str
    market: str  # "KR" or "US"
    last_close: float
    ema20: float
    ema200: float
    gap: float  # ema200 - ema20
    slope_diff: float  # v
    days_to_cross: Optional[int]
    score: int  # 0..100
    reason: str


def ema(closes: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate EMA using pure numpy.

    Returns array of same length, with NaN for insufficient data.
    """
    n = len(closes)
    if n < period:
        return np.full(n, np.nan)

    result = np.full(n, np.nan)
    multiplier = 2.0 / (period + 1)

    # SMA for first value
    result[period - 1] = np.mean(closes[:period])

    # EMA for rest
    for i in range(period, n):
        result[i] = (closes[i] - result[i - 1]) * multiplier + result[i - 1]

    return result


def forecast_cross_days(ema20: np.ndarray, ema200: np.ndarray) -> Optional[int]:
    """
    Forecast days until EMA20 crosses above EMA200.

    Formulas:
      d0 = ema200[-1] - ema20[-1]
      v  = (ema20[-1] - ema20[-6]) - (ema200[-1] - ema200[-6])
      if d0 <= 0: return 0 (already crossed)
      elif v <= 0: return None (not converging)
      else: return ceil(d0 / v)
    """
    if len(ema20) < 6 or len(ema200) < 6:
        return None

    if np.isnan(ema20[-1]) or np.isnan(ema20[-6]):
        return None
    if np.isnan(ema200[-1]) or np.isnan(ema200[-6]):
        return None

    d0 = ema200[-1] - ema20[-1]
    v = (ema20[-1] - ema20[-6]) - (ema200[-1] - ema200[-6])

    if d0 <= 0:
        return 0  # Already crossed or touching
    elif v <= 0:
        return None  # Not converging
    else:
        return ceil(d0 / v)


def score_candidate(
    days_to_cross: Optional[int],
    d0: float,
    v: float,
    ema_slow_last: float,
) -> int:
    """
    Calculate score (0..100).

    Formula:
      if days_to_cross is None: score = 0
      else: score = clamp(
          100 - 5*days_to_cross
              - 20*(d0/abs(ema_slow_last))
              + 10*min(3, v/abs(ema_slow_last)),
          0, 100
      )
    """
    if days_to_cross is None:
        return 0

    if ema_slow_last == 0:
        return 0

    abs_ema = abs(ema_slow_last)
    raw = (
        100
        - 5 * days_to_cross
        - 20 * (d0 / abs_ema)
        + 10 * min(3, v / abs_ema)
    )

    return int(max(0, min(100, raw)))


def screen_symbol(
    symbol: str,
    market: str,
    closes: np.ndarray,
    min_bars: int = 250,
) -> ScreenResult:
    """
    Screen a single symbol.

    Always returns ScreenResult with reason:
    - INSUFFICIENT_DATA (len<250)
    - NO_CONVERGENCE (d0>0 and v<=0)
    - OUT_OF_WINDOW (days_to_cross not None and >30)
    - OK (days_to_cross in 0..30)
    """
    # INSUFFICIENT_DATA
    if len(closes) < min_bars:
        return ScreenResult(
            symbol=symbol,
            market=market,
            last_close=float(closes[-1]) if len(closes) > 0 else 0.0,
            ema20=0.0,
            ema200=0.0,
            gap=0.0,
            slope_diff=0.0,
            days_to_cross=None,
            score=0,
            reason="INSUFFICIENT_DATA",
        )

    ema20_arr = ema(closes, 20)
    ema200_arr = ema(closes, 200)

    ema20_val = float(ema20_arr[-1])
    ema200_val = float(ema200_arr[-1])
    last_close = float(closes[-1])

    if np.isnan(ema20_val) or np.isnan(ema200_val):
        return ScreenResult(
            symbol=symbol,
            market=market,
            last_close=last_close,
            ema20=0.0,
            ema200=0.0,
            gap=0.0,
            slope_diff=0.0,
            days_to_cross=None,
            score=0,
            reason="INSUFFICIENT_DATA",
        )

    # d0 = ema200 - ema20
    d0 = ema200_val - ema20_val

    # v = slope_diff
    if len(ema20_arr) >= 6 and len(ema200_arr) >= 6:
        if not np.isnan(ema20_arr[-6]) and not np.isnan(ema200_arr[-6]):
            v = (ema20_arr[-1] - ema20_arr[-6]) - (ema200_arr[-1] - ema200_arr[-6])
        else:
            v = 0.0
    else:
        v = 0.0

    gap = d0  # ema200 - ema20

    days = forecast_cross_days(ema20_arr, ema200_arr)

    # Determine reason
    if days is None:
        # NO_CONVERGENCE: d0 > 0 and v <= 0
        reason = "NO_CONVERGENCE"
        score = 0
    elif days == 0:
        # ALREADY_CROSSED: EMA20 is already above EMA200
        reason = "ALREADY_CROSSED"
        score = 0
    elif days > 30:
        # OUT_OF_WINDOW
        reason = "OUT_OF_WINDOW"
        score = 0
    else:
        # OK: days_to_cross in [1..30], EMA20 below EMA200 and approaching
        reason = "OK"
        score = score_candidate(days, d0, v, ema200_val)

    return ScreenResult(
        symbol=symbol,
        market=market,
        last_close=last_close,
        ema20=ema20_val,
        ema200=ema200_val,
        gap=gap,
        slope_diff=float(v),
        days_to_cross=days,
        score=score,
        reason=reason,
    )


def screen_watchlist(
    symbols: List[str],
    market: str,
    get_closes_fn: Callable[[str], Optional[np.ndarray]],
    top_n: int = 20,
) -> List[ScreenResult]:
    """
    Screen a watchlist.

    Returns top N candidates (OK results only) sorted by score desc, then days asc.
    """
    all_results: List[ScreenResult] = []

    for symbol in symbols:
        closes = get_closes_fn(symbol)
        if closes is None:
            # No data available, create INSUFFICIENT_DATA result
            all_results.append(ScreenResult(
                symbol=symbol,
                market=market,
                last_close=0.0,
                ema20=0.0,
                ema200=0.0,
                gap=0.0,
                slope_diff=0.0,
                days_to_cross=None,
                score=0,
                reason="INSUFFICIENT_DATA",
            ))
            continue

        result = screen_symbol(symbol, market, closes)
        all_results.append(result)

    # Keep only OK results as candidates
    candidates = [r for r in all_results if r.reason == "OK"]

    # Sort by score desc, then days_to_cross asc
    candidates.sort(key=lambda r: (-r.score, r.days_to_cross if r.days_to_cross is not None else 999))

    return candidates[:top_n]
