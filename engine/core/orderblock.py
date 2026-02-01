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

from dataclasses import dataclass, field
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
    # Volumatic strategy fields
    mitigated: bool = False  # True if price has filled this FVG
    mitigated_index: Optional[int] = None  # Index where FVG was mitigated


class VolumeStrength(Enum):
    """Volume strength classification."""
    STRONG = "strong"
    NORMAL = "normal"
    WEAK = "weak"


class OBAgeStatus(Enum):
    """Order Block age classification."""
    FRESH = "fresh"      # < 20 candles
    MATURE = "mature"    # 20-50 candles
    AGED = "aged"        # > 50 candles (weakening)


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
    # Volume analysis
    volume_strength: VolumeStrength = VolumeStrength.NORMAL
    volume_ratio: float = 1.0  # displacement_volume / avg_volume
    # Volumatic strategy fields
    age_candles: int = 0  # Candles since OB formation
    age_status: OBAgeStatus = OBAgeStatus.FRESH
    fvg_fresh: bool = False  # True if associated FVG is not mitigated
    volumatic_score: int = 0  # Combined volumatic score (0-100)


@dataclass
class ConfluenceResult:
    """Result of confluence analysis between OB and FVG."""
    has_confluence: bool
    score: int  # 0-100
    ob_score: int  # Base score from OB (0 or 50)
    fvg_score: int  # Base score from fresh FVG (0 or 30)
    overlap_bonus: int  # Bonus for zone overlap (0 or 30)
    proximity_bonus: int  # Bonus for price near zone (0 or 20)
    reason: str  # Human-readable explanation
    details: dict = field(default_factory=dict)  # Detailed breakdown


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


def _calculate_volume_sma(
    volume: Optional[np.ndarray],
    end_idx: int,
    period: int = 20,
) -> float:
    """
    Calculate Simple Moving Average of volume.

    Args:
        volume: Volume array
        end_idx: End index (exclusive) for calculation
        period: SMA period (default 20)

    Returns:
        Volume SMA value, or 0.0 if not enough data
    """
    if volume is None or len(volume) == 0:
        return 0.0

    start_idx = max(0, end_idx - period)
    if start_idx >= end_idx:
        return 0.0

    return float(np.mean(volume[start_idx:end_idx]))


def _calculate_volume_strength(
    volume: Optional[np.ndarray],
    displacement_idx: int,
    strong_threshold: float = 1.5,
    weak_threshold: float = 0.8,
) -> Tuple[VolumeStrength, float]:
    """
    Calculate volume strength for an OB based on displacement candle volume.

    Args:
        volume: Volume array
        displacement_idx: Index of the displacement (engulfing) candle
        strong_threshold: Ratio above which volume is considered strong (default 1.5)
        weak_threshold: Ratio below which volume is considered weak (default 0.8)

    Returns:
        Tuple of (VolumeStrength, volume_ratio)
    """
    if volume is None or len(volume) == 0 or displacement_idx < 1:
        return VolumeStrength.NORMAL, 1.0

    # Get displacement candle volume
    disp_vol = float(volume[displacement_idx])

    # Calculate average volume (20-period SMA up to displacement candle)
    avg_vol = _calculate_volume_sma(volume, displacement_idx, period=20)

    if avg_vol <= 0:
        return VolumeStrength.NORMAL, 1.0

    # Calculate ratio
    volume_ratio = disp_vol / avg_vol

    # Classify strength
    if volume_ratio > strong_threshold:
        return VolumeStrength.STRONG, volume_ratio
    elif volume_ratio < weak_threshold:
        return VolumeStrength.WEAK, volume_ratio
    else:
        return VolumeStrength.NORMAL, volume_ratio


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
    strict: bool = False,
) -> bool:
    """
    Check if OB is still fresh (valid for trading).

    Strict mode: OB is invalidated if price touches the OB body zone at all.
    Relaxed mode (default): OB is invalidated only if price closes THROUGH the zone
                           (i.e., for Buy OB: close below zone_bottom,
                                  for Sell OB: close above zone_top)

    Args:
        high: High prices array
        low: Low prices array
        ob: OrderBlock to check
        from_idx: Start index (after OB formation)
        to_idx: End index (current bar)
        strict: If True, any touch invalidates. If False, only mitigation invalidates.

    Returns:
        True if OB is still fresh/valid
    """
    if strict:
        # Original strict mode - any touch invalidates
        for i in range(from_idx + 1, to_idx):
            bar_high = high[i]
            bar_low = low[i]

            # Check if price intersects the OB body zone
            if bar_low <= ob.zone_top and bar_high >= ob.zone_bottom:
                return False
        return True

    # Relaxed mode - only full mitigation invalidates
    # OB is mitigated when price closes through the opposite side of the zone
    for i in range(from_idx + 1, to_idx):
        bar_low = low[i]
        bar_high = high[i]

        if ob.direction == OBDirection.BUY:
            # Buy OB is mitigated if price closes below zone_bottom
            # (sellers overwhelm the buy zone)
            if bar_low < ob.zone_bottom:
                return False
        else:
            # Sell OB is mitigated if price closes above zone_top
            # (buyers overwhelm the sell zone)
            if bar_high > ob.zone_top:
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
    volume: Optional[np.ndarray] = None,
    filter_weak: bool = False,
) -> Tuple[Optional[OrderBlock], int]:
    """
    Detect the single most valid order block.
    Returns the most recent, closest to current price valid OB.

    Args:
        open_: Open prices
        high: High prices
        low: Low prices
        close: Close prices
        volume: Volume data (optional, for volume strength analysis)
        filter_weak: If True, exclude weak volume OBs from consideration

    Returns:
        Tuple of (OrderBlock or None, filtered_weak_count)
    """
    n = len(close)
    if n < 3:
        return None, 0

    current_price = close[-1]
    candidates: List[Tuple[OrderBlock, float]] = []
    filtered_weak_count = 0

    # Debug counters
    patterns_found = 0
    patterns_stale = 0
    patterns_weak = 0

    # Scan for OB patterns
    for i in range(1, n):
        ob_result = _check_ob(open_, close, i)
        if ob_result is None:
            continue

        patterns_found += 1
        ob_idx, direction = ob_result

        # Create OB zone from engulfed candle's BODY
        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = _body_high(ob_open, ob_close)
        zone_bottom = _body_low(ob_open, ob_close)

        # Calculate volume strength
        vol_strength, vol_ratio = _calculate_volume_strength(volume, i)

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
            volume_strength=vol_strength,
            volume_ratio=vol_ratio,
        )

        # Check freshness: OB must not be touched after formation
        if not _is_ob_fresh(high, low, ob, i, n):
            patterns_stale += 1
            continue

        # Filter weak OBs if requested
        if filter_weak and vol_strength == VolumeStrength.WEAK:
            filtered_weak_count += 1
            patterns_weak += 1
            continue

        # Calculate distance to current price
        zone_center = (zone_top + zone_bottom) / 2
        distance = abs(current_price - zone_center)

        candidates.append((ob, distance))

    # Debug logging
    print(f"[OB Detection] bars={n}, patterns_found={patterns_found}, stale={patterns_stale}, weak={patterns_weak}, valid={len(candidates)}")

    if not candidates:
        return None, filtered_weak_count

    # Sort by recency (higher index = more recent), then by distance (closer = better)
    candidates.sort(key=lambda x: (-x[0].displacement_index, x[1]))

    selected_ob = candidates[0][0]
    print(f"[OB Selected] dir={selected_ob.direction.value}, zone={selected_ob.zone_bottom:.2f}-{selected_ob.zone_top:.2f}, vol={selected_ob.volume_strength.value}")

    return selected_ob, filtered_weak_count


def find_all_orderblocks(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: Optional[np.ndarray] = None,
    fresh_only: bool = True,
    filter_weak: bool = False,
) -> Tuple[List[OrderBlock], int]:
    """
    Find all order blocks (utility function for testing/analysis).

    Args:
        open_: Open prices
        high: High prices
        low: Low prices
        close: Close prices
        volume: Volume data (optional, for volume strength analysis)
        fresh_only: If True, only return fresh (untouched) OBs
        filter_weak: If True, exclude weak volume OBs

    Returns:
        Tuple of (list of OrderBlocks, filtered_weak_count)
    """
    n = len(close)
    if n < 3:
        return [], 0

    orderblocks: List[OrderBlock] = []
    filtered_weak_count = 0

    for i in range(1, n):
        ob_result = _check_ob(open_, close, i)
        if ob_result is None:
            continue

        ob_idx, direction = ob_result

        ob_open = open_[ob_idx]
        ob_close = close[ob_idx]
        zone_top = _body_high(ob_open, ob_close)
        zone_bottom = _body_low(ob_open, ob_close)

        # Calculate volume strength
        vol_strength, vol_ratio = _calculate_volume_strength(volume, i)

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
            volume_strength=vol_strength,
            volume_ratio=vol_ratio,
        )

        if fresh_only and not _is_ob_fresh(high, low, ob, i, n):
            continue

        # Filter weak OBs if requested
        if filter_weak and vol_strength == VolumeStrength.WEAK:
            filtered_weak_count += 1
            continue

        orderblocks.append(ob)

    orderblocks.sort(key=lambda ob: ob.index)
    return orderblocks, filtered_weak_count


def calculate_atr(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    period: int = 14,
) -> float:
    """
    Calculate Average True Range (ATR).

    Args:
        high: High prices
        low: Low prices
        close: Close prices
        period: ATR period (default 14)

    Returns:
        Current ATR value
    """
    n = len(close)
    if n < 2:
        return 0.0

    # Calculate True Range for each bar
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]

    for i in range(1, n):
        hl = high[i] - low[i]
        hc = abs(high[i] - close[i - 1])
        lc = abs(low[i] - close[i - 1])
        tr[i] = max(hl, hc, lc)

    # Calculate ATR using simple moving average
    if n < period:
        return float(np.mean(tr))

    return float(np.mean(tr[-period:]))


def zones_overlap(
    zone1_top: float,
    zone1_bottom: float,
    zone2_top: float,
    zone2_bottom: float,
    min_overlap_percent: float = 0.3,
) -> Tuple[bool, float]:
    """
    Check if two zones overlap by at least min_overlap_percent.

    Args:
        zone1_top, zone1_bottom: First zone boundaries
        zone2_top, zone2_bottom: Second zone boundaries
        min_overlap_percent: Minimum overlap percentage (0.3 = 30%)

    Returns:
        Tuple of (has_overlap, overlap_percentage)
    """
    # Calculate overlap
    overlap_top = min(zone1_top, zone2_top)
    overlap_bottom = max(zone1_bottom, zone2_bottom)

    if overlap_bottom >= overlap_top:
        # No overlap
        return False, 0.0

    overlap_size = overlap_top - overlap_bottom

    # Calculate overlap as percentage of smaller zone
    zone1_size = zone1_top - zone1_bottom
    zone2_size = zone2_top - zone2_bottom
    smaller_zone = min(zone1_size, zone2_size)

    if smaller_zone <= 0:
        return False, 0.0

    overlap_percent = overlap_size / smaller_zone

    return overlap_percent >= min_overlap_percent, overlap_percent


def calculate_confluence(
    ob: Optional[OrderBlock],
    fvg: Optional[FVG],
    current_price: float,
    atr: float,
) -> ConfluenceResult:
    """
    Calculate confluence score between OB and FVG.

    Scoring:
    - base_ob = 50 if ob is valid
    - base_fvg = 30 if fvg is fresh (not mitigated)
    - overlap_bonus = 30 if zones overlap > 30% or close proximity
    - price_proximity = 20 if price is within ATR of zone center

    Args:
        ob: Order Block (or None)
        fvg: Fair Value Gap (or None)
        current_price: Current close price
        atr: Average True Range value

    Returns:
        ConfluenceResult with scoring details
    """
    ob_score = 0
    fvg_score = 0
    overlap_bonus = 0
    proximity_bonus = 0
    reasons = []
    details = {}

    # Base OB score
    if ob is not None:
        ob_score = 50
        reasons.append("Valid OB")
        details["ob_zone"] = f"{ob.zone_bottom:.2f}-{ob.zone_top:.2f}"
        details["ob_direction"] = ob.direction.value

    # Base FVG score (only fresh FVGs)
    if fvg is not None:
        fvg_score = 30
        reasons.append("Fresh FVG")
        details["fvg_zone"] = f"{fvg.gap_low:.2f}-{fvg.gap_high:.2f}"
        details["fvg_direction"] = fvg.direction.value

    # Overlap bonus - check if OB and FVG zones overlap
    if ob is not None and fvg is not None:
        # Check for zone overlap
        has_overlap, overlap_pct = zones_overlap(
            ob.zone_top, ob.zone_bottom,
            fvg.gap_high, fvg.gap_low,
            min_overlap_percent=0.3
        )

        if has_overlap:
            overlap_bonus = 30
            reasons.append(f"Zones overlap ({overlap_pct*100:.0f}%)")
            details["overlap_percent"] = f"{overlap_pct*100:.1f}%"
        else:
            # Check for proximity (within ATR * 0.5)
            ob_center = (ob.zone_top + ob.zone_bottom) / 2
            fvg_center = (fvg.gap_high + fvg.gap_low) / 2
            distance = abs(ob_center - fvg_center)

            if atr > 0 and distance < atr * 0.5:
                overlap_bonus = 30
                reasons.append(f"Zones close (within 0.5 ATR)")
                details["zone_distance"] = f"{distance:.2f}"

        # Check direction alignment
        if ob.direction == fvg.direction:
            details["direction_aligned"] = True
        else:
            details["direction_aligned"] = False

    # Proximity bonus - is price near the zone?
    zone_center = None
    if ob is not None:
        zone_center = (ob.zone_top + ob.zone_bottom) / 2
    elif fvg is not None:
        zone_center = (fvg.gap_high + fvg.gap_low) / 2

    if zone_center is not None and atr > 0:
        price_distance = abs(current_price - zone_center)
        if price_distance < atr:
            proximity_bonus = 20
            reasons.append("Price near zone")
            details["price_distance_atr"] = f"{price_distance/atr:.2f} ATR"

    # Calculate total score
    total_score = min(100, ob_score + fvg_score + overlap_bonus + proximity_bonus)

    # Build reason string
    if not reasons:
        reason_str = "No confluence signals"
    else:
        reason_str = " + ".join(reasons)

    # Determine if this is a high confluence zone
    has_confluence = total_score >= 80

    details["score_breakdown"] = {
        "ob": ob_score,
        "fvg": fvg_score,
        "overlap": overlap_bonus,
        "proximity": proximity_bonus,
    }

    return ConfluenceResult(
        has_confluence=has_confluence,
        score=total_score,
        ob_score=ob_score,
        fvg_score=fvg_score,
        overlap_bonus=overlap_bonus,
        proximity_bonus=proximity_bonus,
        reason=reason_str,
        details=details,
    )
