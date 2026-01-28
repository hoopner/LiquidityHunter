"""
Order Block detection with engulfing, FVG, and freshness validation.

OB Rules (Body + Engulfing):
- Buy OB: Strong bullish candle's BODY completely engulfs previous red candle's BODY
  - bullish_body_high >= red_body_high AND bullish_body_low <= red_body_low
- Sell OB: Strong bearish candle's BODY completely engulfs previous green candle's BODY
  - bearish_body_high >= green_body_high AND bearish_body_low <= green_body_low

FVG Rules (3 candles, Body based):
- Buy FVG: candle[i].body_low > candle[i-2].body_high
  - Gap zone = candle[i-2].body_high to candle[i].body_low
- Sell FVG: candle[i].body_high < candle[i-2].body_low
  - Gap zone = candle[i].body_high to candle[i-2].body_low

Freshness: OB invalidated if price touches zone after formation.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple

import numpy as np


class OBDirection(Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass
class FVG:
    """Fair Value Gap (3-candle, BODY based)."""
    index: int  # Index of the third candle (candle[i])
    direction: OBDirection
    gap_high: float  # Top of gap zone
    gap_low: float   # Bottom of gap zone


@dataclass
class OrderBlock:
    """Represents an order block zone."""
    index: int  # Bar index of the engulfed candle (OB zone)
    direction: OBDirection
    zone_top: float  # Top of OB zone (body_high)
    zone_bottom: float  # Bottom of OB zone (body_low)
    displacement_index: int  # Index of engulfing candle
    has_fvg: bool  # Whether FVG is present
    fvg: Optional[FVG] = None


def _body_high(open_: float, close: float) -> float:
    """Get the high of the candle body (max of open, close)."""
    return max(open_, close)


def _body_low(open_: float, close: float) -> float:
    """Get the low of the candle body (min of open, close)."""
    return min(open_, close)


def _is_bullish_candle(open_: float, close: float) -> bool:
    """Check if candle is bullish (close > open)."""
    return close > open_


def _is_bearish_candle(open_: float, close: float) -> bool:
    """Check if candle is bearish (close < open)."""
    return close < open_


def _body_size(open_: float, close: float) -> float:
    """Calculate candle body size."""
    return abs(close - open_)


def _median_body_size(open_: np.ndarray, close: np.ndarray, end_idx: int, lookback: int = 20) -> float:
    """
    Calculate median body size of last `lookback` bars ending at end_idx (exclusive).
    """
    start_idx = max(0, end_idx - lookback)
    if start_idx >= end_idx:
        return 0.0

    bodies = np.abs(close[start_idx:end_idx] - open_[start_idx:end_idx])
    return float(np.median(bodies))


def _is_strong_candle(
    open_: np.ndarray,
    close: np.ndarray,
    idx: int,
    threshold: float = 1.5,
    lookback: int = 20,
) -> bool:
    """
    Check if candle at idx is a strong (displacement) candle.
    Strong: body_size >= threshold * median_body_size(last lookback bars)
    """
    if idx < 1:
        return False

    body = _body_size(open_[idx], close[idx])
    median = _median_body_size(open_, close, idx, lookback)

    if median == 0.0:
        return body > 0

    return body >= threshold * median


def _is_body_engulfing(
    engulfing_open: float, engulfing_close: float,
    engulfed_open: float, engulfed_close: float,
) -> bool:
    """
    Check if engulfing candle's BODY completely contains engulfed candle's BODY.
    Condition: engulfing_body_high >= engulfed_body_high AND engulfing_body_low <= engulfed_body_low
    """
    eng_body_high = _body_high(engulfing_open, engulfing_close)
    eng_body_low = _body_low(engulfing_open, engulfing_close)
    target_body_high = _body_high(engulfed_open, engulfed_close)
    target_body_low = _body_low(engulfed_open, engulfed_close)

    return eng_body_high >= target_body_high and eng_body_low <= target_body_low


def _check_ob(
    open_: np.ndarray,
    close: np.ndarray,
    idx: int,
    threshold: float = 1.5,
    lookback: int = 20,
) -> Optional[Tuple[int, OBDirection]]:
    """
    Check if there's an Order Block at idx.

    Buy OB: Strong bullish candle at idx engulfs previous bearish (red) candle
    Sell OB: Strong bearish candle at idx engulfs previous bullish (green) candle

    Returns: (engulfed_candle_index, direction) or None
    """
    if idx < 1:
        return None

    # Check if current candle is strong
    if not _is_strong_candle(open_, close, idx, threshold, lookback):
        return None

    curr_open = open_[idx]
    curr_close = close[idx]
    prev_open = open_[idx - 1]
    prev_close = close[idx - 1]

    # Buy OB: Strong bullish engulfs previous bearish
    if _is_bullish_candle(curr_open, curr_close) and _is_bearish_candle(prev_open, prev_close):
        if _is_body_engulfing(curr_open, curr_close, prev_open, prev_close):
            return (idx - 1, OBDirection.BUY)

    # Sell OB: Strong bearish engulfs previous bullish
    if _is_bearish_candle(curr_open, curr_close) and _is_bullish_candle(prev_open, prev_close):
        if _is_body_engulfing(curr_open, curr_close, prev_open, prev_close):
            return (idx - 1, OBDirection.SELL)

    return None


def _check_fvg(
    open_: np.ndarray,
    close: np.ndarray,
    idx: int,
) -> Optional[FVG]:
    """
    Check for FVG using 3-candle rule with BODY.

    Compares candle[idx] and candle[idx-2] (skipping the middle candle).

    Buy FVG: candle[idx].body_low > candle[idx-2].body_high
      - Gap zone = candle[idx-2].body_high to candle[idx].body_low

    Sell FVG: candle[idx].body_high < candle[idx-2].body_low
      - Gap zone = candle[idx].body_high to candle[idx-2].body_low
    """
    if idx < 2:
        return None

    # Get body boundaries for candle[idx] and candle[idx-2]
    curr_body_high = _body_high(open_[idx], close[idx])
    curr_body_low = _body_low(open_[idx], close[idx])
    prev2_body_high = _body_high(open_[idx - 2], close[idx - 2])
    prev2_body_low = _body_low(open_[idx - 2], close[idx - 2])

    # Buy FVG: current body_low > prev2 body_high (gap above)
    if curr_body_low > prev2_body_high:
        return FVG(
            index=idx,
            direction=OBDirection.BUY,
            gap_high=curr_body_low,
            gap_low=prev2_body_high,
        )

    # Sell FVG: current body_high < prev2 body_low (gap below)
    if curr_body_high < prev2_body_low:
        return FVG(
            index=idx,
            direction=OBDirection.SELL,
            gap_high=prev2_body_low,
            gap_low=curr_body_high,
        )

    return None


def _is_ob_fresh(
    high: np.ndarray,
    low: np.ndarray,
    ob: OrderBlock,
    from_idx: int,
    to_idx: int,
) -> bool:
    """
    Check if OB is still fresh (untouched).
    OB is invalidated if price intersects the OB BODY zone after formation.
    """
    for i in range(from_idx + 1, to_idx):
        bar_high = high[i]
        bar_low = low[i]

        # Check if price intersects the OB body zone
        if bar_low <= ob.zone_top and bar_high >= ob.zone_bottom:
            return False

    return True


def detect_orderblock(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    displacement_threshold: float = 1.5,
    lookback: int = 20,
) -> Optional[OrderBlock]:
    """
    Detect the single most valid order block.
    Returns the most recent, closest to current price valid OB.
    """
    n = len(close)
    if n < 3:
        return None

    current_price = close[-1]
    candidates: List[Tuple[OrderBlock, float]] = []

    # Scan for OB patterns
    for i in range(1, n):
        ob_result = _check_ob(open_, close, i, displacement_threshold, lookback)
        if ob_result is None:
            continue

        ob_idx, direction = ob_result

        # Create OB zone from engulfed candle's BODY
        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = _body_high(ob_open, ob_close)
        zone_bottom = _body_low(ob_open, ob_close)

        # Check for FVG (look at engulfing candle and beyond)
        fvg = None
        has_fvg = False
        if i + 1 < n:
            fvg = _check_fvg(open_, close, i + 1)
            has_fvg = fvg is not None

        ob = OrderBlock(
            index=ob_idx,
            direction=direction,
            zone_top=zone_top,
            zone_bottom=zone_bottom,
            displacement_index=i,
            has_fvg=has_fvg,
            fvg=fvg,
        )

        # Check freshness: OB must not be touched after formation
        if not _is_ob_fresh(high, low, ob, i, n):
            continue

        # Calculate distance to current price
        zone_center = (zone_top + zone_bottom) / 2
        distance = abs(current_price - zone_center)

        candidates.append((ob, distance))

    if not candidates:
        return None

    # Sort by recency (higher index = more recent), then by distance (closer = better)
    candidates.sort(key=lambda x: (-x[0].displacement_index, x[1]))

    return candidates[0][0]


def find_all_orderblocks(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    displacement_threshold: float = 1.5,
    lookback: int = 20,
    fresh_only: bool = True,
) -> List[OrderBlock]:
    """
    Find all order blocks (utility function for testing/analysis).
    """
    n = len(close)
    if n < 3:
        return []

    orderblocks: List[OrderBlock] = []

    for i in range(1, n):
        ob_result = _check_ob(open_, close, i, displacement_threshold, lookback)
        if ob_result is None:
            continue

        ob_idx, direction = ob_result

        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = _body_high(ob_open, ob_close)
        zone_bottom = _body_low(ob_open, ob_close)

        fvg = None
        has_fvg = False
        if i + 1 < n:
            fvg = _check_fvg(open_, close, i + 1)
            has_fvg = fvg is not None

        ob = OrderBlock(
            index=ob_idx,
            direction=direction,
            zone_top=zone_top,
            zone_bottom=zone_bottom,
            displacement_index=i,
            has_fvg=has_fvg,
            fvg=fvg,
        )

        if fresh_only and not _is_ob_fresh(high, low, ob, i, n):
            continue

        orderblocks.append(ob)

    orderblocks.sort(key=lambda ob: ob.index)
    return orderblocks
