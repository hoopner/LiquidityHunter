"""Bollinger Bands indicator calculations."""

import numpy as np
from typing import Tuple


def calculate_bollinger_bands(
    values: np.ndarray,
    length: int = 20,
    std_dev: float = 2.0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Calculate Bollinger Bands.

    Args:
        values: Input values (typically close prices or RSI values)
        length: SMA period for middle band (default 20)
        std_dev: Standard deviation multiplier (default 2.0)

    Returns:
        Tuple of (upper_band, middle_band, lower_band) arrays
    """
    n = len(values)
    upper = np.full(n, np.nan)
    middle = np.full(n, np.nan)
    lower = np.full(n, np.nan)

    for i in range(length - 1, n):
        window = values[i - length + 1:i + 1]
        sma = np.mean(window)
        std = np.std(window, ddof=0)  # Population std dev (like most charting)

        middle[i] = sma
        upper[i] = sma + (std * std_dev)
        lower[i] = sma - (std * std_dev)

    return upper, middle, lower


def calculate_bb1(close: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    BB1: Tight Bollinger Band (20, 0.5)
    - Length: 20
    - StdDev: 0.5
    - Color: GREEN (#22c55e)
    """
    return calculate_bollinger_bands(close, length=20, std_dev=0.5)


def calculate_bb2(close: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    BB2: Wide Bollinger Band (20, 3.0)
    - Length: 20
    - StdDev: 3.0
    - Color: RED (#ef4444)
    """
    return calculate_bollinger_bands(close, length=20, std_dev=3.0)


def calculate_rsi_with_bb(
    close: np.ndarray,
    rsi_period: int = 14,
    bb_length: int = 30,
    bb_std_dev: float = 2.0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    BB3: RSI with Bollinger Band overlay.

    Args:
        close: Close prices
        rsi_period: RSI period (default 14)
        bb_length: BB length applied to RSI (default 30)
        bb_std_dev: BB standard deviation (default 2.0)

    Returns:
        Tuple of (rsi_values, rsi_bb_upper, rsi_bb_middle, rsi_bb_lower)
    """
    # Calculate RSI
    n = len(close)
    rsi_values = np.full(n, np.nan)

    if n < rsi_period + 1:
        return rsi_values, np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)

    # Calculate price changes
    deltas = np.diff(close)

    # Initialize gains and losses
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)

    # First average (simple average for first period)
    avg_gain = np.mean(gains[:rsi_period])
    avg_loss = np.mean(losses[:rsi_period])

    # Calculate RSI for first complete period
    if avg_loss == 0:
        rsi_values[rsi_period] = 100
    else:
        rs = avg_gain / avg_loss
        rsi_values[rsi_period] = 100 - (100 / (1 + rs))

    # Calculate RSI using smoothed averages (Wilder's method)
    for i in range(rsi_period + 1, n):
        avg_gain = (avg_gain * (rsi_period - 1) + gains[i - 1]) / rsi_period
        avg_loss = (avg_loss * (rsi_period - 1) + losses[i - 1]) / rsi_period

        if avg_loss == 0:
            rsi_values[i] = 100
        else:
            rs = avg_gain / avg_loss
            rsi_values[i] = 100 - (100 / (1 + rs))

    # Calculate Bollinger Bands on RSI values
    rsi_bb_upper, rsi_bb_middle, rsi_bb_lower = calculate_bollinger_bands(
        rsi_values, length=bb_length, std_dev=bb_std_dev
    )

    return rsi_values, rsi_bb_upper, rsi_bb_middle, rsi_bb_lower
