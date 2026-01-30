"""
Keltner Channel Indicator

Purpose: Volatility channel based on EMA and ATR.
Used with Bollinger Bands for TTM Squeeze strategy.
"""

import numpy as np
from typing import Tuple


def calculate_ema(values: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate Exponential Moving Average.

    Args:
        values: Input values
        period: EMA period

    Returns:
        EMA values array
    """
    n = len(values)
    ema = np.full(n, np.nan)

    if n < period:
        return ema

    # Initial SMA for first EMA value
    ema[period - 1] = np.mean(values[:period])

    # EMA multiplier
    multiplier = 2.0 / (period + 1)

    # Calculate EMA
    for i in range(period, n):
        ema[i] = (values[i] - ema[i - 1]) * multiplier + ema[i - 1]

    return ema


def calculate_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """
    Calculate Average True Range.

    Args:
        high: High prices
        low: Low prices
        close: Close prices
        period: ATR period (default: 14)

    Returns:
        ATR values array
    """
    n = len(close)
    tr = np.zeros(n)

    # First TR is just high - low
    tr[0] = high[0] - low[0]

    # Calculate True Range
    for i in range(1, n):
        hl = high[i] - low[i]
        hc = abs(high[i] - close[i - 1])
        lc = abs(low[i] - close[i - 1])
        tr[i] = max(hl, hc, lc)

    # Calculate ATR using EMA-style smoothing (Wilder's method)
    atr = np.full(n, np.nan)

    if n < period:
        return atr

    # Initial ATR is SMA of first 'period' TR values
    atr[period - 1] = np.mean(tr[:period])

    # Subsequent ATR values using Wilder's smoothing
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period

    return atr


def calculate_keltner_channel(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    ema_period: int = 20,
    atr_period: int = 10,
    multiplier: float = 1.5
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Calculate Keltner Channel.

    Args:
        high: High prices
        low: Low prices
        close: Close prices
        ema_period: EMA period for middle line (default: 20)
        atr_period: ATR period for bands (default: 10)
        multiplier: ATR multiplier for band width (default: 1.5)

    Returns:
        Tuple of (upper_band, middle_line, lower_band)
    """
    # Middle line = EMA of close
    middle = calculate_ema(close, ema_period)

    # ATR for band width
    atr = calculate_atr(high, low, close, atr_period)

    # Upper and lower bands
    upper = middle + (atr * multiplier)
    lower = middle - (atr * multiplier)

    return upper, middle, lower


def calculate_ttm_squeeze(
    bb_upper: np.ndarray,
    bb_lower: np.ndarray,
    kc_upper: np.ndarray,
    kc_lower: np.ndarray
) -> np.ndarray:
    """
    Calculate TTM Squeeze indicator.

    Squeeze ON (True): Bollinger Bands are inside Keltner Channel
    - BB_lower > KC_lower AND BB_upper < KC_upper

    Squeeze OFF (False): BB breaks outside KC - potential breakout

    Args:
        bb_upper: Bollinger Band upper values
        bb_lower: Bollinger Band lower values
        kc_upper: Keltner Channel upper values
        kc_lower: Keltner Channel lower values

    Returns:
        Boolean array where True = Squeeze ON (consolidation), False = Squeeze OFF
    """
    n = len(bb_upper)
    squeeze = np.full(n, False)

    for i in range(n):
        # Skip if any value is NaN
        if (np.isnan(bb_upper[i]) or np.isnan(bb_lower[i]) or
            np.isnan(kc_upper[i]) or np.isnan(kc_lower[i])):
            continue

        # Squeeze is ON when BB is inside KC
        if bb_lower[i] > kc_lower[i] and bb_upper[i] < kc_upper[i]:
            squeeze[i] = True

    return squeeze


def calculate_squeeze_momentum(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    length: int = 20
) -> np.ndarray:
    """
    Calculate squeeze momentum (optional enhancement).

    Uses linear regression of price minus average of highest high and lowest low.
    Positive = bullish momentum, Negative = bearish momentum.

    Args:
        high: High prices
        low: Low prices
        close: Close prices
        length: Lookback period

    Returns:
        Momentum values array
    """
    n = len(close)
    momentum = np.full(n, np.nan)

    for i in range(length - 1, n):
        # Get highest high and lowest low over period
        hh = np.max(high[i - length + 1:i + 1])
        ll = np.min(low[i - length + 1:i + 1])

        # Average of highest high and lowest low
        avg_hl = (hh + ll) / 2

        # SMA of close
        sma = np.mean(close[i - length + 1:i + 1])

        # Momentum = close - average of (avg_hl and sma)
        momentum[i] = close[i] - (avg_hl + sma) / 2

    return momentum
