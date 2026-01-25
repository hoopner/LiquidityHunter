"""Tests for Order Block detection."""

import numpy as np
import pytest

from engine.core.orderblock import (
    detect_orderblock,
    find_all_orderblocks,
    OrderBlock,
    OBDirection,
    FVG,
    _is_displacement,
    _median_body_size,
    _check_fvg,
    _is_ob_fresh,
)


class TestDisplacement:
    """Tests for displacement detection."""

    def test_displacement_detected(self):
        """Test that displacement is detected when body >= 1.5x median."""
        # 20 bars with body size ~1.0, then one with body size 2.0
        open_ = np.array([10.0] * 20 + [10.0])
        close = np.array([11.0] * 20 + [12.0])  # Bodies: 1.0 * 20, then 2.0

        # Median of first 20 is 1.0, displacement at 20 has body 2.0 >= 1.5
        assert _is_displacement(open_, close, 20, threshold=1.5, lookback=20)

    def test_displacement_not_detected_small_body(self):
        """Test that small body candle is not displacement."""
        open_ = np.array([10.0] * 20 + [10.0])
        close = np.array([11.0] * 20 + [10.5])  # Bodies: 1.0 * 20, then 0.5

        # 0.5 < 1.5 * 1.0
        assert not _is_displacement(open_, close, 20, threshold=1.5, lookback=20)

    def test_displacement_at_boundary(self):
        """Test displacement detection at exact 1.5x threshold."""
        open_ = np.array([10.0] * 20 + [10.0])
        close = np.array([11.0] * 20 + [11.5])  # Bodies: 1.0 * 20, then 1.5

        # 1.5 >= 1.5 * 1.0 (exactly at threshold)
        assert _is_displacement(open_, close, 20, threshold=1.5, lookback=20)

    def test_displacement_with_short_lookback(self):
        """Test displacement with fewer bars than lookback."""
        open_ = np.array([10.0, 10.0, 10.0])
        close = np.array([11.0, 11.0, 13.0])  # Bodies: 1.0, 1.0, 3.0

        # Median of [1.0, 1.0] = 1.0, body of 3.0 >= 1.5 * 1.0
        assert _is_displacement(open_, close, 2, threshold=1.5, lookback=20)


class TestMedianBodySize:
    """Tests for median body size calculation."""

    def test_median_body_size_basic(self):
        """Test basic median body calculation."""
        open_ = np.array([10.0, 10.0, 10.0, 10.0, 10.0])
        close = np.array([11.0, 12.0, 11.5, 12.5, 11.0])  # Bodies: 1, 2, 1.5, 2.5, 1

        # Median of [1, 2, 1.5, 2.5] = 1.75
        median = _median_body_size(open_, close, 4, lookback=20)
        assert median == pytest.approx(1.75)

    def test_median_body_size_empty(self):
        """Test median with no bars."""
        open_ = np.array([])
        close = np.array([])

        median = _median_body_size(open_, close, 0, lookback=20)
        assert median == 0.0


class TestFVG:
    """Tests for Fair Value Gap detection."""

    def test_bullish_fvg_detected(self):
        """Test detection of bullish FVG (High(c1) < Low(c3))."""
        # c1: high=10, c2: displacement, c3: low=12 -> gap between 10 and 12
        high = np.array([10.0, 15.0, 14.0])
        low = np.array([8.0, 11.0, 12.0])
        open_ = np.array([9.0, 11.0, 13.0])
        close = np.array([9.5, 14.0, 13.5])  # c2 is bullish

        fvg = _check_fvg(high, low, open_, close, displacement_idx=1)

        assert fvg is not None
        assert fvg.direction == OBDirection.BULLISH
        assert fvg.gap_low == 10.0  # c1 high
        assert fvg.gap_high == 12.0  # c3 low

    def test_bearish_fvg_detected(self):
        """Test detection of bearish FVG (Low(c1) > High(c3))."""
        # c1: low=12, c2: displacement, c3: high=10 -> gap between 10 and 12
        high = np.array([14.0, 11.0, 10.0])
        low = np.array([12.0, 8.0, 8.0])
        open_ = np.array([13.0, 11.0, 9.0])
        close = np.array([12.5, 8.5, 9.5])  # c2 is bearish

        fvg = _check_fvg(high, low, open_, close, displacement_idx=1)

        assert fvg is not None
        assert fvg.direction == OBDirection.BEARISH
        assert fvg.gap_high == 12.0  # c1 low
        assert fvg.gap_low == 10.0  # c3 high

    def test_no_fvg_when_no_gap(self):
        """Test that no FVG is detected when there's no gap."""
        # c1: high=10, c3: low=9 -> no gap (overlapping)
        high = np.array([10.0, 15.0, 12.0])
        low = np.array([8.0, 11.0, 9.0])
        open_ = np.array([9.0, 11.0, 11.0])
        close = np.array([9.5, 14.0, 10.0])

        fvg = _check_fvg(high, low, open_, close, displacement_idx=1)

        assert fvg is None

    def test_fvg_edge_case_no_c3(self):
        """Test FVG when c3 doesn't exist."""
        high = np.array([10.0, 15.0])
        low = np.array([8.0, 11.0])
        open_ = np.array([9.0, 11.0])
        close = np.array([9.5, 14.0])

        fvg = _check_fvg(high, low, open_, close, displacement_idx=1)

        assert fvg is None


class TestFreshness:
    """Tests for Order Block freshness checking."""

    def test_fresh_ob_not_touched(self):
        """Test that untouched OB is considered fresh."""
        # OB zone: 9.0 - 10.0, price stays above
        ob = OrderBlock(
            index=0,
            direction=OBDirection.BULLISH,
            zone_top=10.0,
            zone_bottom=9.0,
            displacement_index=1,
            has_fvg=False,
        )
        high = np.array([10.5, 15.0, 14.0, 13.0])
        low = np.array([9.5, 11.0, 12.0, 11.0])  # All lows above 10.0

        assert _is_ob_fresh(high, low, ob, from_idx=1, to_idx=4)

    def test_ob_invalidated_when_touched(self):
        """Test that touched OB is invalidated."""
        # OB zone: 9.0 - 10.0, price dips into zone
        ob = OrderBlock(
            index=0,
            direction=OBDirection.BULLISH,
            zone_top=10.0,
            zone_bottom=9.0,
            displacement_index=1,
            has_fvg=False,
        )
        high = np.array([10.5, 15.0, 14.0, 13.0])
        low = np.array([9.5, 11.0, 9.5, 11.0])  # Index 2 dips into zone

        assert not _is_ob_fresh(high, low, ob, from_idx=1, to_idx=4)

    def test_ob_invalidated_when_price_through_zone(self):
        """Test OB invalidated when price goes through zone."""
        ob = OrderBlock(
            index=0,
            direction=OBDirection.BULLISH,
            zone_top=10.0,
            zone_bottom=9.0,
            displacement_index=1,
            has_fvg=False,
        )
        high = np.array([10.5, 15.0, 14.0])
        low = np.array([9.5, 11.0, 8.0])  # Index 2 goes completely through

        assert not _is_ob_fresh(high, low, ob, from_idx=1, to_idx=3)


class TestOrderBlockDetection:
    """Tests for complete Order Block detection."""

    def test_bullish_ob_detected(self):
        """Test detection of bullish order block."""
        # Build scenario: bearish candle followed by bullish displacement
        # Need 20 bars for median calculation, then OB + displacement
        n_setup = 20

        # Setup bars with body size ~1.0
        open_ = [10.0] * n_setup
        high = [11.0] * n_setup
        low = [9.0] * n_setup
        close = [11.0] * n_setup  # Bullish candles, body = 1.0

        # Add bearish candle (OB candidate)
        open_.append(12.0)
        high.append(12.5)
        low.append(10.5)
        close.append(11.0)  # Bearish: close < open, body = 1.0

        # Add bullish displacement candle (body >= 1.5)
        open_.append(11.0)
        high.append(14.0)
        low.append(10.5)
        close.append(13.5)  # Bullish: close > open, body = 2.5

        # Add confirmation bar for FVG check
        open_.append(13.5)
        high.append(15.0)
        low.append(13.0)
        close.append(14.5)

        open_ = np.array(open_)
        high = np.array(high)
        low = np.array(low)
        close = np.array(close)

        ob = detect_orderblock(open_, high, low, close)

        assert ob is not None
        assert ob.direction == OBDirection.BULLISH
        assert ob.index == 20  # The bearish candle before displacement
        assert ob.zone_bottom == 11.0  # min(open, close) of OB candle
        assert ob.zone_top == 12.0  # max(open, close) of OB candle

    def test_bearish_ob_detected(self):
        """Test detection of bearish order block."""
        n_setup = 20

        # Setup bars
        open_ = [10.0] * n_setup
        high = [11.0] * n_setup
        low = [9.0] * n_setup
        close = [9.0] * n_setup  # Bearish candles, body = 1.0

        # Add bullish candle (OB candidate)
        open_.append(8.0)
        high.append(10.0)
        low.append(7.5)
        close.append(9.0)  # Bullish: close > open

        # Add bearish displacement candle
        open_.append(9.0)
        high.append(9.5)
        low.append(6.0)
        close.append(6.5)  # Bearish: close < open, body = 2.5

        # Add bar after
        open_.append(6.5)
        high.append(7.0)
        low.append(5.5)
        close.append(6.0)

        open_ = np.array(open_)
        high = np.array(high)
        low = np.array(low)
        close = np.array(close)

        ob = detect_orderblock(open_, high, low, close)

        assert ob is not None
        assert ob.direction == OBDirection.BEARISH
        assert ob.index == 20

    def test_no_ob_without_displacement(self):
        """Test that no OB is detected without displacement."""
        # All candles have similar body size
        open_ = np.array([10.0] * 25)
        high = np.array([11.0] * 25)
        low = np.array([9.0] * 25)
        close = np.array([10.5] * 25)  # Body = 0.5

        ob = detect_orderblock(open_, high, low, close)

        assert ob is None

    def test_ob_invalidated_when_touched(self):
        """Test that OB is invalidated when price touches zone."""
        n_setup = 20

        open_ = [10.0] * n_setup
        high = [11.0] * n_setup
        low = [9.0] * n_setup
        close = [11.0] * n_setup

        # Bearish OB candle
        open_.append(12.0)
        high.append(12.5)
        low.append(10.5)
        close.append(11.0)

        # Bullish displacement
        open_.append(11.0)
        high.append(14.0)
        low.append(10.5)
        close.append(13.5)

        # Price comes back and touches OB zone (11.0 - 12.0)
        open_.append(13.5)
        high.append(14.0)
        low.append(11.5)  # Touches inside OB zone
        close.append(13.8)

        open_ = np.array(open_)
        high = np.array(high)
        low = np.array(low)
        close = np.array(close)

        ob = detect_orderblock(open_, high, low, close)

        # OB should be invalidated
        assert ob is None

    def test_single_zone_returns_most_recent(self):
        """Test that only the most recent valid OB is returned."""
        n_setup = 20

        open_ = [10.0] * n_setup
        high = [11.0] * n_setup
        low = [9.0] * n_setup
        close = [11.0] * n_setup

        # First OB + displacement
        open_.append(12.0)
        high.append(12.5)
        low.append(10.5)
        close.append(11.0)

        open_.append(11.0)
        high.append(14.0)
        low.append(10.5)
        close.append(13.5)

        # Second OB + displacement (more recent)
        open_.append(15.0)
        high.append(15.5)
        low.append(13.5)
        close.append(14.0)  # Bearish candle

        open_.append(14.0)
        high.append(17.0)
        low.append(13.5)
        close.append(16.5)  # Bullish displacement

        # Final bar
        open_.append(16.5)
        high.append(18.0)
        low.append(16.0)
        close.append(17.5)

        open_ = np.array(open_)
        high = np.array(high)
        low = np.array(low)
        close = np.array(close)

        ob = detect_orderblock(open_, high, low, close)

        assert ob is not None
        # Should be the more recent OB
        assert ob.index == 22

    def test_ob_zone_is_body_only(self):
        """Test that OB zone is based on body (open/close), not high/low."""
        n_setup = 20

        open_ = [10.0] * n_setup
        high = [11.0] * n_setup
        low = [9.0] * n_setup
        close = [11.0] * n_setup

        # OB candle with long wicks
        open_.append(12.0)
        high.append(15.0)  # Long upper wick
        low.append(8.0)    # Long lower wick
        close.append(11.0)

        # Displacement
        open_.append(11.0)
        high.append(14.0)
        low.append(10.5)
        close.append(13.5)

        # Final bar
        open_.append(13.5)
        high.append(15.0)
        low.append(13.0)
        close.append(14.5)

        open_ = np.array(open_)
        high = np.array(high)
        low = np.array(low)
        close = np.array(close)

        ob = detect_orderblock(open_, high, low, close)

        assert ob is not None
        # Zone should be body: min/max of (11.0, 12.0), not (8.0, 15.0)
        assert ob.zone_bottom == 11.0
        assert ob.zone_top == 12.0

    def test_ob_with_fvg(self):
        """Test that FVG is properly attached to OB."""
        n_setup = 20

        # Setup with body=1.0 so median is meaningful
        open_ = [10.0] * n_setup
        high = [11.5] * n_setup
        low = [9.5] * n_setup
        close = [11.0] * n_setup  # body = 1.0

        # c1: before displacement (also OB candle - bearish)
        open_.append(11.0)
        high.append(11.5)  # c1 high
        low.append(9.0)
        close.append(10.0)  # Bearish, body = 1.0

        # c2: displacement - bullish with large body
        open_.append(10.0)
        high.append(15.0)
        low.append(9.5)
        close.append(14.5)  # Bullish, body = 4.5 >= 1.5 * 1.0

        # c3: creates FVG (c3 low > c1 high)
        open_.append(14.0)
        high.append(16.0)
        low.append(13.0)  # c3 low (13.0) > c1 high (11.5), so bullish FVG
        close.append(14.5)  # Small body = 0.5, not displacement

        open_ = np.array(open_)
        high = np.array(high)
        low = np.array(low)
        close = np.array(close)

        ob = detect_orderblock(open_, high, low, close)

        assert ob is not None
        assert ob.has_fvg
        assert ob.fvg is not None
        assert ob.fvg.direction == OBDirection.BULLISH

    def test_find_all_orderblocks(self):
        """Test finding all order blocks."""
        n_setup = 20

        open_ = [10.0] * n_setup
        high = [11.0] * n_setup
        low = [9.0] * n_setup
        close = [11.0] * n_setup

        # First OB
        open_.append(12.0)
        high.append(12.5)
        low.append(10.5)
        close.append(11.0)

        open_.append(11.0)
        high.append(14.0)
        low.append(10.5)
        close.append(13.5)

        # Second OB
        open_.append(15.0)
        high.append(15.5)
        low.append(13.5)
        close.append(14.0)

        open_.append(14.0)
        high.append(17.0)
        low.append(13.5)
        close.append(16.5)

        open_.append(16.5)
        high.append(18.0)
        low.append(16.0)
        close.append(17.5)

        open_ = np.array(open_)
        high = np.array(high)
        low = np.array(low)
        close = np.array(close)

        obs = find_all_orderblocks(open_, high, low, close)

        assert len(obs) >= 1

    def test_empty_arrays(self):
        """Test with empty arrays."""
        ob = detect_orderblock(
            np.array([]),
            np.array([]),
            np.array([]),
            np.array([]),
        )
        assert ob is None

    def test_insufficient_data(self):
        """Test with insufficient data for OB detection."""
        ob = detect_orderblock(
            np.array([10.0, 11.0]),
            np.array([11.0, 12.0]),
            np.array([9.0, 10.0]),
            np.array([10.5, 11.5]),
        )
        assert ob is None
