"""
VWAP (Volume Weighted Average Price) Indicator

Purpose: Intraday institutional trading level, strong signal when overlaps with OB retest.
VWAP resets at the start of each trading day.
"""

import numpy as np
from datetime import datetime
from typing import List, Tuple


def calculate_vwap(
    timestamps: List[str],
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray,
    timeframe: str = '1D'
) -> np.ndarray:
    """
    Calculate VWAP with daily reset for intraday timeframes.

    Args:
        timestamps: List of timestamp strings (YYYY-MM-DD or Unix timestamp)
        high: High prices
        low: Low prices
        close: Close prices
        volume: Volume values
        timeframe: Timeframe string (1m, 5m, 15m, 1h, 4h, 1D, 1W, 1M)

    Returns:
        VWAP values array (NaN for daily+ timeframes where VWAP is less meaningful)
    """
    n = len(close)
    vwap = np.full(n, np.nan)

    # VWAP is most useful for intraday timeframes
    # For daily+ charts, return NaN (caller can decide to hide or show message)
    if timeframe in ['1D', '1W', '1M']:
        return vwap

    # Calculate typical price
    typical_price = (high + low + close) / 3

    # For intraday, we need to reset VWAP at each new trading day
    cumulative_tp_vol = 0.0
    cumulative_vol = 0.0
    current_date = None

    for i in range(n):
        # Parse date from timestamp
        ts = timestamps[i]
        if isinstance(ts, (int, float)):
            # Unix timestamp
            dt = datetime.fromtimestamp(ts)
            date_str = dt.strftime('%Y-%m-%d')
        else:
            # String format - extract date portion
            date_str = str(ts)[:10]

        # Reset on new trading day
        if date_str != current_date:
            current_date = date_str
            cumulative_tp_vol = 0.0
            cumulative_vol = 0.0

        # Accumulate
        cumulative_tp_vol += typical_price[i] * volume[i]
        cumulative_vol += volume[i]

        # Calculate VWAP
        if cumulative_vol > 0:
            vwap[i] = cumulative_tp_vol / cumulative_vol

    return vwap


def calculate_vwap_bands(
    vwap: np.ndarray,
    close: np.ndarray,
    std_multiplier: float = 2.0
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Calculate VWAP standard deviation bands (optional).

    Args:
        vwap: VWAP values
        close: Close prices
        std_multiplier: Standard deviation multiplier

    Returns:
        Tuple of (upper_band, lower_band)
    """
    # Calculate rolling standard deviation of price from VWAP
    # This is a simplified version - could be enhanced
    deviation = close - vwap

    # Use expanding window standard deviation
    n = len(close)
    upper = np.full(n, np.nan)
    lower = np.full(n, np.nan)

    for i in range(1, n):
        if not np.isnan(vwap[i]):
            std = np.nanstd(deviation[:i+1])
            upper[i] = vwap[i] + std_multiplier * std
            lower[i] = vwap[i] - std_multiplier * std

    return upper, lower
