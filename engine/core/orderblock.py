"""
Order Block and Fair Value Gap detection.

OB Rules (Body Engulfing):
- Buy OB: Bullish candle's BODY completely engulfs previous bearish candle's BODY
  - OB zone = the bearish (red) candle's body
- Sell OB: Bearish candle's BODY completely engulfs previous bullish candle's BODY
  - OB zone = the bullish (green) candle's body

FVG Rules (3 candles, HIGH/LOW based, INDEPENDENT from OB):
- Buy FVG: 3 consecutive bullish candles, candle[i].low > candle[i-2].high
  - Gap zone = candle[i-2].high (bottom) to candle[i].low (top)
- Sell FVG: 3 consecutive bearish candles, candle[i].high < candle[i-2].low
  - Gap zone = candle[i].high (bottom) to candle[i-2].low (top)

Freshness:
- OB invalidated if price touches the zone after formation
- FVG invalidated if price fills the gap after formation
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
    threshold: float = 1.2,
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
) -> Optional[Tuple[int, OBDirection]]:
    """
    Check if there's an Order Block at idx.

    Buy OB: Bullish candle at idx engulfs previous bearish (red) candle
    Sell OB: Bearish candle at idx engulfs previous bullish (green) candle

    Returns: (engulfed_candle_index, direction) or None
    """
    if idx < 1:
        return None

    curr_open = open_[idx]
    curr_close = close[idx]
    prev_open = open_[idx - 1]
    prev_close = close[idx - 1]

    # Buy OB: Bullish engulfs previous bearish
    if _is_bullish_candle(curr_open, curr_close) and _is_bearish_candle(prev_open, prev_close):
        if _is_body_engulfing(curr_open, curr_close, prev_open, prev_close):
            return (idx - 1, OBDirection.BUY)

    # Sell OB: Bearish engulfs previous bullish
    if _is_bearish_candle(curr_open, curr_close) and _is_bullish_candle(prev_open, prev_close):
        if _is_body_engulfing(curr_open, curr_close, prev_open, prev_close):
            return (idx - 1, OBDirection.SELL)

    return None


def _check_fvg(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    idx: int,
) -> Optional[FVG]:
    """
    Check for FVG using 3-candle rule with HIGH/LOW (wicks included).
    All 3 candles must be the SAME direction.

    Buy FVG:
      - All 3 candles must be bullish (green)
      - candle[idx].low > candle[idx-2].high (no overlap)
      - Gap zone = candle[idx-2].high (bottom) to candle[idx].low (top)

    Sell FVG:
      - All 3 candles must be bearish (red)
      - candle[idx].high < candle[idx-2].low (no overlap)
      - Gap zone = candle[idx].high (bottom) to candle[idx-2].low (top)
    """
    if idx < 2:
        return None

    # Check if all 3 candles are bullish
    all_bullish = (
        _is_bullish_candle(open_[idx - 2], close[idx - 2]) and
        _is_bullish_candle(open_[idx - 1], close[idx - 1]) and
        _is_bullish_candle(open_[idx], close[idx])
    )

    # Check if all 3 candles are bearish
    all_bearish = (
        _is_bearish_candle(open_[idx - 2], close[idx - 2]) and
        _is_bearish_candle(open_[idx - 1], close[idx - 1]) and
        _is_bearish_candle(open_[idx], close[idx])
    )

    curr_high = high[idx]
    curr_low = low[idx]
    prev2_high = high[idx - 2]
    prev2_low = low[idx - 2]

    # Buy FVG: all bullish + current low > prev2 high (gap above)
    if all_bullish and curr_low > prev2_high:
        return FVG(
            index=idx,
            direction=OBDirection.BUY,
            gap_high=curr_low,      # top of gap = candle[i].low
            gap_low=prev2_high,     # bottom of gap = candle[i-2].high
        )

    # Sell FVG: all bearish + current high < prev2 low (gap below)
    if all_bearish and curr_high < prev2_low:
        return FVG(
            index=idx,
            direction=OBDirection.SELL,
            gap_high=prev2_low,     # top of gap = candle[i-2].low
            gap_low=curr_high,      # bottom of gap = candle[i].high
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


def _is_fvg_fresh(
    high: np.ndarray,
    low: np.ndarray,
    fvg: FVG,
    to_idx: int,
) -> bool:
    """
    Check if FVG is still fresh (unfilled).
    FVG is invalidated if price fills the gap after formation.
    """
    for i in range(fvg.index + 1, to_idx):
        bar_high = high[i]
        bar_low = low[i]

        # Check if price fills the gap
        if bar_low <= fvg.gap_high and bar_high >= fvg.gap_low:
            return False

    return True


def find_all_fvgs(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    fresh_only: bool = True,
) -> List[FVG]:
    """
    Find all Fair Value Gaps independently (not tied to OB).

    FVG Rules:
    - Buy FVG: 3 bullish candles, candle[i].low > candle[i-2].high
    - Sell FVG: 3 bearish candles, candle[i].high < candle[i-2].low
    """
    n = len(close)
    if n < 3:
        return []

    fvgs: List[FVG] = []

    for i in range(2, n):
        fvg = _check_fvg(open_, high, low, close, i)
        if fvg is None:
            continue

        if fresh_only and not _is_fvg_fresh(high, low, fvg, n):
            continue

        fvgs.append(fvg)

    return fvgs


def detect_orderblock(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
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
        ob_result = _check_ob(open_, close, i)
        if ob_result is None:
            continue

        ob_idx, direction = ob_result

        # Create OB zone from engulfed candle's BODY
        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = _body_high(ob_open, ob_close)
        zone_bottom = _body_low(ob_open, ob_close)

        # Check for FVG in a window around the OB (5 bars before to 5 bars after)
        # Search backward first (most recent FVG near OB), then forward
        fvg = None
        has_fvg = False
        search_start = max(2, ob_idx - 5)
        search_end = min(i + 6, n)
        for fvg_idx in range(search_end - 1, search_start - 1, -1):  # Search backward
            candidate_fvg = _check_fvg(open_, high, low, close, fvg_idx)
            if candidate_fvg is not None:
                # Match FVG direction with OB direction
                if candidate_fvg.direction == direction:
                    fvg = candidate_fvg
                    has_fvg = True
                    break

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
        ob_result = _check_ob(open_, close, i)
        if ob_result is None:
            continue

        ob_idx, direction = ob_result

        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = _body_high(ob_open, ob_close)
        zone_bottom = _body_low(ob_open, ob_close)

        # Check for FVG in a window around the OB (5 bars before to 5 bars after)
        fvg = None
        has_fvg = False
        search_start = max(2, ob_idx - 5)
        search_end = min(i + 6, n)
        for fvg_idx in range(search_end - 1, search_start - 1, -1):
            candidate_fvg = _check_fvg(open_, high, low, close, fvg_idx)
            if candidate_fvg is not None:
                if candidate_fvg.direction == direction:
                    fvg = candidate_fvg
                    has_fvg = True
                    break

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
