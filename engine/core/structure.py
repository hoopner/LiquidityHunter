"""
Market structure detection: pivot swings and break of structure (BOS).

Rules:
- Pivot swings: 2 left / 2 right bars required to confirm.
- BOS: close breaks last confirmed swing level.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

import numpy as np


class SwingType(Enum):
    HIGH = "high"
    LOW = "low"


class BOSDirection(Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"


@dataclass
class Swing:
    """Represents a confirmed pivot swing point."""
    index: int
    price: float
    swing_type: SwingType


@dataclass
class BOS:
    """Represents a break of structure event."""
    index: int  # Bar index where BOS occurred
    direction: BOSDirection
    broken_swing: Swing  # The swing that was broken
    close_price: float  # Close price that broke the structure


def find_pivot_swings(
    high: np.ndarray,
    low: np.ndarray,
    left_bars: int = 2,
    right_bars: int = 2,
) -> List[Swing]:
    """
    Find pivot swing highs and lows using left/right bar confirmation.

    A swing high at index i requires:
      high[i] > high[i-left_bars:i] AND high[i] > high[i+1:i+right_bars+1]

    A swing low at index i requires:
      low[i] < low[i-left_bars:i] AND low[i] < low[i+1:i+right_bars+1]

    Args:
        high: Array of high prices
        low: Array of low prices
        left_bars: Number of bars to the left to confirm swing
        right_bars: Number of bars to the right to confirm swing

    Returns:
        List of Swing objects sorted by index
    """
    if len(high) != len(low):
        raise ValueError("high and low arrays must have same length")

    n = len(high)
    swings: List[Swing] = []

    # Minimum bars needed: left_bars + 1 + right_bars
    min_bars = left_bars + 1 + right_bars
    if n < min_bars:
        return swings

    # Check each potential pivot point
    for i in range(left_bars, n - right_bars):
        # Check swing high
        left_high_max = np.max(high[i - left_bars:i])
        right_high_max = np.max(high[i + 1:i + right_bars + 1])

        if high[i] > left_high_max and high[i] > right_high_max:
            swings.append(Swing(index=i, price=high[i], swing_type=SwingType.HIGH))

        # Check swing low
        left_low_min = np.min(low[i - left_bars:i])
        right_low_min = np.min(low[i + 1:i + right_bars + 1])

        if low[i] < left_low_min and low[i] < right_low_min:
            swings.append(Swing(index=i, price=low[i], swing_type=SwingType.LOW))

    # Sort by index
    swings.sort(key=lambda s: s.index)
    return swings


def detect_bos(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    swings: Optional[List[Swing]] = None,
) -> List[BOS]:
    """
    Detect break of structure events.

    BOS occurs when:
    - Bullish BOS: close > last confirmed swing high
    - Bearish BOS: close < last confirmed swing low

    Args:
        open_: Array of open prices
        high: Array of high prices
        low: Array of low prices
        close: Array of close prices
        swings: Optional pre-computed swings (will compute if not provided)

    Returns:
        List of BOS events sorted by index
    """
    if swings is None:
        swings = find_pivot_swings(high, low)

    if not swings:
        return []

    n = len(close)
    bos_events: List[BOS] = []

    # Track last confirmed swing high and low
    last_swing_high: Optional[Swing] = None
    last_swing_low: Optional[Swing] = None

    # Create a map of swing index to swing for quick lookup
    swing_map = {s.index: s for s in swings}

    for i in range(n):
        # Update last confirmed swings if we've passed their confirmation point
        # A swing at index j is confirmed after j + right_bars (2)
        for swing in swings:
            # Swing is confirmed once we're past index + right_bars
            confirmation_index = swing.index + 2  # right_bars = 2
            if i >= confirmation_index:
                if swing.swing_type == SwingType.HIGH:
                    if last_swing_high is None or swing.index > last_swing_high.index:
                        last_swing_high = swing
                elif swing.swing_type == SwingType.LOW:
                    if last_swing_low is None or swing.index > last_swing_low.index:
                        last_swing_low = swing

        # Check for BOS
        # Bullish BOS: close breaks above last swing high
        if last_swing_high is not None and i > last_swing_high.index:
            if close[i] > last_swing_high.price:
                # Check we haven't already recorded this break
                already_broken = any(
                    b.broken_swing.index == last_swing_high.index
                    for b in bos_events
                )
                if not already_broken:
                    bos_events.append(BOS(
                        index=i,
                        direction=BOSDirection.BULLISH,
                        broken_swing=last_swing_high,
                        close_price=close[i],
                    ))

        # Bearish BOS: close breaks below last swing low
        if last_swing_low is not None and i > last_swing_low.index:
            if close[i] < last_swing_low.price:
                # Check we haven't already recorded this break
                already_broken = any(
                    b.broken_swing.index == last_swing_low.index
                    for b in bos_events
                )
                if not already_broken:
                    bos_events.append(BOS(
                        index=i,
                        direction=BOSDirection.BEARISH,
                        broken_swing=last_swing_low,
                        close_price=close[i],
                    ))

    bos_events.sort(key=lambda b: b.index)
    return bos_events
