"""
Volume Profile calculation module.

Calculates:
- Volume at each price level (histogram)
- POC (Point of Control): price level with highest volume
- VAH (Value Area High): upper bound of 70% volume area
- VAL (Value Area Low): lower bound of 70% volume area
"""

import numpy as np
from typing import NamedTuple


class VolumeProfileResult(NamedTuple):
    """Result of volume profile calculation."""
    poc_price: float          # Point of Control - price with highest volume
    vah_price: float          # Value Area High
    val_price: float          # Value Area Low
    histogram: list[dict]     # List of {price, volume, percent} dicts
    total_volume: float       # Total volume in the period
    value_area_volume: float  # Volume within value area (70%)


def calculate_volume_profile(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    volumes: np.ndarray,
    num_bins: int = 50,
    value_area_percent: float = 0.70
) -> VolumeProfileResult:
    """
    Calculate volume profile from OHLCV data.

    Args:
        highs: Array of high prices
        lows: Array of low prices
        closes: Array of close prices
        volumes: Array of volumes
        num_bins: Number of price levels for histogram
        value_area_percent: Percentage of volume for value area (default 70%)

    Returns:
        VolumeProfileResult with POC, VAH, VAL, and histogram data
    """
    if len(highs) == 0 or len(volumes) == 0:
        return VolumeProfileResult(
            poc_price=0,
            vah_price=0,
            val_price=0,
            histogram=[],
            total_volume=0,
            value_area_volume=0
        )

    # Find price range
    price_min = float(np.min(lows))
    price_max = float(np.max(highs))

    if price_max == price_min:
        # All prices are the same
        total_vol = float(np.sum(volumes))
        return VolumeProfileResult(
            poc_price=price_min,
            vah_price=price_min,
            val_price=price_min,
            histogram=[{"price": price_min, "volume": total_vol, "percent": 100.0}],
            total_volume=total_vol,
            value_area_volume=total_vol
        )

    # Create price bins
    bin_size = (price_max - price_min) / num_bins
    bin_edges = np.linspace(price_min, price_max, num_bins + 1)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2

    # Initialize volume at each price level
    volume_at_price = np.zeros(num_bins)

    # Distribute volume across price levels
    # For each candle, distribute its volume across the price range it covers
    for i in range(len(highs)):
        candle_low = lows[i]
        candle_high = highs[i]
        candle_volume = volumes[i]

        if candle_volume <= 0:
            continue

        # Find bins that this candle touches
        low_bin = int((candle_low - price_min) / bin_size)
        high_bin = int((candle_high - price_min) / bin_size)

        # Clamp to valid range
        low_bin = max(0, min(num_bins - 1, low_bin))
        high_bin = max(0, min(num_bins - 1, high_bin))

        # Distribute volume proportionally across touched bins
        num_touched_bins = high_bin - low_bin + 1
        vol_per_bin = candle_volume / num_touched_bins

        for b in range(low_bin, high_bin + 1):
            volume_at_price[b] += vol_per_bin

    total_volume = float(np.sum(volume_at_price))

    if total_volume == 0:
        return VolumeProfileResult(
            poc_price=float(np.mean(closes)),
            vah_price=price_max,
            val_price=price_min,
            histogram=[],
            total_volume=0,
            value_area_volume=0
        )

    # Find POC (Point of Control) - price level with highest volume
    poc_bin = int(np.argmax(volume_at_price))
    poc_price = float(bin_centers[poc_bin])

    # Calculate Value Area (70% of total volume around POC)
    target_volume = total_volume * value_area_percent

    # Start from POC and expand outward
    included_bins = {poc_bin}
    current_volume = volume_at_price[poc_bin]

    lower_idx = poc_bin - 1
    upper_idx = poc_bin + 1

    while current_volume < target_volume and (lower_idx >= 0 or upper_idx < num_bins):
        # Check volumes at next lower and upper bins
        lower_vol = volume_at_price[lower_idx] if lower_idx >= 0 else 0
        upper_vol = volume_at_price[upper_idx] if upper_idx < num_bins else 0

        # Add the bin with higher volume
        if lower_vol >= upper_vol and lower_idx >= 0:
            included_bins.add(lower_idx)
            current_volume += lower_vol
            lower_idx -= 1
        elif upper_idx < num_bins:
            included_bins.add(upper_idx)
            current_volume += upper_vol
            upper_idx += 1
        else:
            break

    # Determine VAH and VAL from included bins
    val_bin = min(included_bins)
    vah_bin = max(included_bins)
    val_price = float(bin_centers[val_bin])
    vah_price = float(bin_centers[vah_bin])

    # Build histogram data
    max_volume = float(np.max(volume_at_price))
    histogram = []

    for i in range(num_bins):
        vol = float(volume_at_price[i])
        if vol > 0:  # Only include non-zero bins
            histogram.append({
                "price": float(bin_centers[i]),
                "volume": vol,
                "percent": (vol / max_volume * 100) if max_volume > 0 else 0,
                "in_value_area": i in included_bins
            })

    return VolumeProfileResult(
        poc_price=poc_price,
        vah_price=vah_price,
        val_price=val_price,
        histogram=histogram,
        total_volume=total_volume,
        value_area_volume=float(current_volume)
    )
