"""
Order Block detection with displacement, FVG, and freshness validation.

Rules:
- OB: last opposite-direction candle before displacement
- Zone = BODY only (open to close)
- Displacement: body_size >= 1.5 * median_body_size(last 20 bars)
- FVG (2-candle rule, BODY only):
  - Bullish FVG: candle[i-1].body_high < candle[i].body_low
  - Bearish FVG: candle[i-1].body_low > candle[i].body_high
- Freshness: if price intersects OB BODY after formation -> invalidate
- Single Zone Logic: return ONLY ONE valid OB (most recent, closest to current price)
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple

import numpy as np


class OBDirection(Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"


@dataclass
class FVG:
    """Fair Value Gap (2-candle, BODY only)."""
    index: int  # Index of the second candle (where gap forms)
    direction: OBDirection
    gap_high: float  # Top of gap zone
    gap_low: float   # Bottom of gap zone


@dataclass
class OrderBlock:
    """Represents an order block zone."""
    index: int  # Bar index where OB formed
    direction: OBDirection
    zone_top: float  # Top of OB zone (max of open, close)
    zone_bottom: float  # Bottom of OB zone (min of open, close)
    displacement_index: int  # Index of displacement candle
    has_fvg: bool  # Whether FVG is present
    fvg: Optional[FVG] = None


def _is_bullish_candle(open_: float, close: float) -> bool:
    """Check if candle is bullish (close >= open)."""
    return close >= open_


def _is_bearish_candle(open_: float, close: float) -> bool:
    """Check if candle is bearish (close < open)."""
    return close < open_


def _body_size(open_: float, close: float) -> float:
    """Calculate candle body size."""
    return abs(close - open_)


def _median_body_size(open_: np.ndarray, close: np.ndarray, end_idx: int, lookback: int = 20) -> float:
    """
    Calculate median body size of last `lookback` bars ending at end_idx (exclusive).

    Args:
        open_: Array of open prices
        close: Array of close prices
        end_idx: End index (exclusive)
        lookback: Number of bars to look back

    Returns:
        Median body size, or 0.0 if not enough data
    """
    start_idx = max(0, end_idx - lookback)
    if start_idx >= end_idx:
        return 0.0

    bodies = np.abs(close[start_idx:end_idx] - open_[start_idx:end_idx])
    return float(np.median(bodies))


def _is_displacement(
    open_: np.ndarray,
    close: np.ndarray,
    idx: int,
    threshold: float = 1.5,
    lookback: int = 20,
) -> bool:
    """
    Check if candle at idx is a displacement candle.

    Displacement: body_size >= threshold * median_body_size(last lookback bars)
    """
    if idx < 1:
        return False

    body = _body_size(open_[idx], close[idx])
    median = _median_body_size(open_, close, idx, lookback)

    if median == 0.0:
        # If median is 0 (e.g., doji candles), only consider displacement if body > 0
        return body > 0

    return body >= threshold * median


def _check_fvg(
    open_: np.ndarray,
    close: np.ndarray,
    idx: int,
) -> Optional[FVG]:
    """
    Check for FVG using 2-candle rule with BODY only.

    Compares candle[idx-1] and candle[idx] (2 consecutive candles).

    Bullish FVG: candle[idx-1].body_high < candle[idx].body_low
      - Gap zone = candle[idx-1].body_high to candle[idx].body_low

    Bearish FVG: candle[idx-1].body_low > candle[idx].body_high
      - Gap zone = candle[idx].body_high to candle[idx-1].body_low
    """
    if idx < 1:
        return None

    prev_idx = idx - 1

    # Get body boundaries for both candles
    prev_body_high = _body_high(open_[prev_idx], close[prev_idx])
    prev_body_low = _body_low(open_[prev_idx], close[prev_idx])
    curr_body_high = _body_high(open_[idx], close[idx])
    curr_body_low = _body_low(open_[idx], close[idx])

    # Determine direction from current candle
    is_bullish = _is_bullish_candle(open_[idx], close[idx])

    if is_bullish and prev_body_high < curr_body_low:
        # Bullish FVG: gap between prev body high and current body low
        return FVG(
            index=idx,
            direction=OBDirection.BULLISH,
            gap_high=curr_body_low,
            gap_low=prev_body_high,
        )
    elif not is_bullish and prev_body_low > curr_body_high:
        # Bearish FVG: gap between current body high and prev body low
        return FVG(
            index=idx,
            direction=OBDirection.BEARISH,
            gap_high=prev_body_low,
            gap_low=curr_body_high,
        )

    return None


def _body_high(open_: float, close: float) -> float:
    """Get the high of the candle body (max of open, close)."""
    return max(open_, close)


def _body_low(open_: float, close: float) -> float:
    """Get the low of the candle body (min of open, close)."""
    return min(open_, close)


def _is_body_engulfing(
    disp_open: float, disp_close: float,
    ob_open: float, ob_close: float,
) -> bool:
    """
    Check if displacement candle's BODY engulfs OB candle's BODY.

    Engulfing: displacement body completely contains OB body.
    - disp_body_high >= ob_body_high
    - disp_body_low <= ob_body_low
    """
    disp_body_high = _body_high(disp_open, disp_close)
    disp_body_low = _body_low(disp_open, disp_close)
    ob_body_high = _body_high(ob_open, ob_close)
    ob_body_low = _body_low(ob_open, ob_close)

    return disp_body_high >= ob_body_high and disp_body_low <= ob_body_low


def _find_ob_candle(
    open_: np.ndarray,
    close: np.ndarray,
    displacement_idx: int,
    direction: OBDirection,
) -> Optional[int]:
    """
    Find the last opposite-direction candle before displacement that is engulfed.

    For bullish OB: find last bearish candle before bullish displacement
    For bearish OB: find last bullish candle before bearish displacement

    Additional rule: displacement candle's BODY must engulf OB candle's BODY.
    """
    if displacement_idx < 1:
        return None

    disp_open = open_[displacement_idx]
    disp_close = close[displacement_idx]

    # Search backwards from displacement candle
    for i in range(displacement_idx - 1, -1, -1):
        if direction == OBDirection.BULLISH:
            # Looking for bearish candle (last down candle before up move)
            if _is_bearish_candle(open_[i], close[i]):
                # Check if displacement body engulfs this candle's body
                if _is_body_engulfing(disp_open, disp_close, open_[i], close[i]):
                    return i
        else:
            # Looking for bullish candle (last up candle before down move)
            if _is_bullish_candle(open_[i], close[i]):
                # Check if displacement body engulfs this candle's body
                if _is_body_engulfing(disp_open, disp_close, open_[i], close[i]):
                    return i

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

    Args:
        high: Array of high prices
        low: Array of low prices
        ob: The order block to check
        from_idx: Start index for checking (exclusive, usually OB formation index)
        to_idx: End index for checking (exclusive)

    Returns:
        True if OB is fresh (never touched), False if invalidated
    """
    # Check each bar after OB formation
    for i in range(from_idx + 1, to_idx):
        bar_high = high[i]
        bar_low = low[i]

        # Check if price intersects the OB body zone
        # Intersection occurs if bar range overlaps with OB zone
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

    Args:
        open_: Array of open prices
        high: Array of high prices
        low: Array of low prices
        close: Array of close prices
        displacement_threshold: Multiplier for displacement detection
        lookback: Bars to look back for median body calculation

    Returns:
        Single OrderBlock if found, None otherwise
    """
    n = len(close)
    if n < 3:
        return None

    current_price = close[-1]
    candidates: List[Tuple[OrderBlock, float]] = []  # (OB, distance_to_price)

    # Scan for displacement candles and build OB candidates
    for i in range(1, n):
        if not _is_displacement(open_, close, i, displacement_threshold, lookback):
            continue

        # Determine direction from displacement candle
        if _is_bullish_candle(open_[i], close[i]):
            direction = OBDirection.BULLISH
        else:
            direction = OBDirection.BEARISH

        # Find the OB candle (last opposite-direction candle)
        ob_idx = _find_ob_candle(open_, close, i, direction)
        if ob_idx is None:
            continue

        # Create OB zone from BODY only
        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = max(ob_open, ob_close)
        zone_bottom = min(ob_open, ob_close)

        # Check for FVG between OB candle and displacement candle
        fvg = _check_fvg(open_, close, i)
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
        # We check from the displacement candle onwards
        if not _is_ob_fresh(high, low, ob, i, n):
            continue

        # Calculate distance to current price (center of OB zone)
        zone_center = (zone_top + zone_bottom) / 2
        distance = abs(current_price - zone_center)

        candidates.append((ob, distance))

    if not candidates:
        return None

    # Sort by recency (higher index = more recent), then by distance (closer = better)
    # Primary: most recent (highest displacement_index)
    # Secondary: closest to current price
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

    Args:
        open_: Array of open prices
        high: Array of high prices
        low: Array of low prices
        close: Array of close prices
        displacement_threshold: Multiplier for displacement detection
        lookback: Bars to look back for median body calculation
        fresh_only: If True, only return fresh (untouched) OBs

    Returns:
        List of OrderBlock objects sorted by index
    """
    n = len(close)
    if n < 3:
        return []

    orderblocks: List[OrderBlock] = []

    for i in range(1, n):
        if not _is_displacement(open_, close, i, displacement_threshold, lookback):
            continue

        if _is_bullish_candle(open_[i], close[i]):
            direction = OBDirection.BULLISH
        else:
            direction = OBDirection.BEARISH

        ob_idx = _find_ob_candle(open_, close, i, direction)
        if ob_idx is None:
            continue

        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = max(ob_open, ob_close)
        zone_bottom = min(ob_open, ob_close)

        # Check for FVG between OB candle and displacement candle
        fvg = _check_fvg(open_, close, i)
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
