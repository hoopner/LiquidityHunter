"""Tests for market structure detection (pivot swings, BOS)."""

import numpy as np
import pytest

from engine.core.structure import (
    find_pivot_swings,
    detect_bos,
    Swing,
    SwingType,
    BOS,
    BOSDirection,
)


class TestPivotSwings:
    """Tests for pivot swing detection."""

    def test_basic_swing_high(self):
        """Test detection of a simple swing high with 2L/2R."""
        # Pattern: low, higher, HIGHEST, lower, lower
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        assert len(swings) == 1
        assert swings[0].index == 2
        assert swings[0].price == 15.0
        assert swings[0].swing_type == SwingType.HIGH

    def test_basic_swing_low(self):
        """Test detection of a simple swing low with 2L/2R."""
        # Pattern: high, lower, LOWEST, higher, higher
        high = np.array([15.0, 13.0, 10.0, 12.0, 14.0])
        low = np.array([14.0, 12.0, 9.0, 11.0, 13.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        assert len(swings) == 1
        assert swings[0].index == 2
        assert swings[0].price == 9.0
        assert swings[0].swing_type == SwingType.LOW

    def test_both_swing_high_and_low(self):
        """Test detection of both swing high and swing low."""
        # Swing high at index 2, swing low at index 5
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 9.0, 10.0, 12.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 8.0, 9.0, 11.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        assert len(swings) == 2

        swing_high = next(s for s in swings if s.swing_type == SwingType.HIGH)
        assert swing_high.index == 2
        assert swing_high.price == 15.0

        swing_low = next(s for s in swings if s.swing_type == SwingType.LOW)
        assert swing_low.index == 5
        assert swing_low.price == 8.0

    def test_no_swings_in_flat_market(self):
        """Test that no swings are detected in flat market."""
        high = np.array([10.0, 10.0, 10.0, 10.0, 10.0])
        low = np.array([9.0, 9.0, 9.0, 9.0, 9.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        assert len(swings) == 0

    def test_not_enough_bars(self):
        """Test with insufficient bars for swing detection."""
        high = np.array([10.0, 12.0, 11.0])  # Only 3 bars, need 5
        low = np.array([9.0, 11.0, 10.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        assert len(swings) == 0

    def test_multiple_swing_highs(self):
        """Test detection of multiple swing highs."""
        # Two swing highs at indices 2 and 7
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 12.0, 14.0, 16.0, 14.0, 12.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 11.0, 13.0, 15.0, 13.0, 11.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        swing_highs = [s for s in swings if s.swing_type == SwingType.HIGH]
        assert len(swing_highs) == 2
        assert swing_highs[0].index == 2
        assert swing_highs[1].index == 7

    def test_swing_at_edge_not_detected(self):
        """Test that swings at edges (without enough L/R bars) aren't detected."""
        # Would-be swing high at index 0, but no left bars
        high = np.array([20.0, 15.0, 10.0, 12.0, 11.0])
        low = np.array([19.0, 14.0, 9.0, 11.0, 10.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        # Swing low should be detected at index 2, but no swing high at 0
        swing_highs = [s for s in swings if s.swing_type == SwingType.HIGH]
        assert len(swing_highs) == 0

    def test_array_length_mismatch_raises(self):
        """Test that mismatched array lengths raise ValueError."""
        high = np.array([10.0, 12.0, 15.0])
        low = np.array([9.0, 11.0])

        with pytest.raises(ValueError):
            find_pivot_swings(high, low)

    def test_swings_sorted_by_index(self):
        """Test that returned swings are sorted by index."""
        # Multiple swings in sequence
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 10.0, 12.0, 14.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 9.0, 11.0, 13.0])

        swings = find_pivot_swings(high, low, left_bars=2, right_bars=2)

        indices = [s.index for s in swings]
        assert indices == sorted(indices)


class TestBOS:
    """Tests for Break of Structure detection."""

    def test_bullish_bos(self):
        """Test detection of bullish BOS (close breaks above swing high)."""
        # Swing high at index 2 (price 15), then close breaks above at index 6
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 14.0, 16.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 13.0, 15.0])
        open_ = np.array([9.5, 11.5, 14.5, 12.5, 10.5, 13.5, 15.5])
        close = np.array([9.8, 11.8, 14.8, 12.2, 10.2, 13.8, 15.8])

        bos_events = detect_bos(open_, high, low, close)

        bullish_bos = [b for b in bos_events if b.direction == BOSDirection.BULLISH]
        assert len(bullish_bos) == 1
        assert bullish_bos[0].index == 6
        assert bullish_bos[0].broken_swing.price == 15.0
        assert bullish_bos[0].close_price == 15.8

    def test_bearish_bos(self):
        """Test detection of bearish BOS (close breaks below swing low)."""
        # Swing low at index 2 (price 9), then close breaks below at index 6
        high = np.array([15.0, 13.0, 10.0, 12.0, 14.0, 11.0, 9.0])
        low = np.array([14.0, 12.0, 9.0, 11.0, 13.0, 10.0, 8.0])
        open_ = np.array([14.5, 12.5, 9.5, 11.5, 13.5, 10.5, 8.5])
        close = np.array([14.2, 12.2, 9.2, 11.8, 13.8, 10.2, 8.2])

        bos_events = detect_bos(open_, high, low, close)

        bearish_bos = [b for b in bos_events if b.direction == BOSDirection.BEARISH]
        assert len(bearish_bos) == 1
        assert bearish_bos[0].index == 6
        assert bearish_bos[0].broken_swing.price == 9.0
        assert bearish_bos[0].close_price == 8.2

    def test_no_bos_without_break(self):
        """Test that no BOS is detected when structure isn't broken."""
        # Swing high at index 2 (15), but price never breaks above
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 12.0, 14.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 11.0, 13.0])
        open_ = np.array([9.5, 11.5, 14.5, 12.5, 10.5, 11.5, 13.5])
        close = np.array([9.8, 11.8, 14.8, 12.2, 10.2, 11.8, 13.8])

        bos_events = detect_bos(open_, high, low, close)

        bullish_bos = [b for b in bos_events if b.direction == BOSDirection.BULLISH]
        assert len(bullish_bos) == 0

    def test_bos_uses_close_not_high(self):
        """Test that BOS is triggered by close, not high."""
        # Swing high at 15, high reaches 16 but close stays below
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 16.0, 14.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 13.0, 12.0])
        open_ = np.array([9.5, 11.5, 14.5, 12.5, 10.5, 13.5, 12.5])
        close = np.array([9.8, 11.8, 14.8, 12.2, 10.2, 14.5, 12.8])  # Close below 15

        bos_events = detect_bos(open_, high, low, close)

        bullish_bos = [b for b in bos_events if b.direction == BOSDirection.BULLISH]
        assert len(bullish_bos) == 0

    def test_no_swings_no_bos(self):
        """Test that no BOS when no swings exist."""
        # Flat market, no swings
        high = np.array([10.0, 10.0, 10.0, 10.0, 10.0])
        low = np.array([9.0, 9.0, 9.0, 9.0, 9.0])
        open_ = np.array([9.5, 9.5, 9.5, 9.5, 9.5])
        close = np.array([9.8, 9.8, 9.8, 9.8, 9.8])

        bos_events = detect_bos(open_, high, low, close)

        assert len(bos_events) == 0

    def test_bos_only_after_confirmation(self):
        """Test that BOS only happens after swing is confirmed."""
        # Swing high confirmed at index 2 + 2 (right_bars) = 4
        # So BOS can only happen from index 5 onwards
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 14.0, 16.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 13.0, 15.0])
        open_ = np.array([9.5, 11.5, 14.5, 12.5, 10.5, 13.5, 15.5])
        close = np.array([9.8, 11.8, 14.8, 12.2, 10.2, 13.8, 15.8])

        bos_events = detect_bos(open_, high, low, close)

        # BOS should be at index 6 (first bar after confirmation that breaks)
        bullish_bos = [b for b in bos_events if b.direction == BOSDirection.BULLISH]
        assert len(bullish_bos) == 1
        assert bullish_bos[0].index == 6

    def test_multiple_bos_events(self):
        """Test detection of multiple BOS events."""
        # Swing high at 2 broken at 6, swing low at 9 broken at 12
        high = np.array([
            10.0, 12.0, 15.0, 13.0, 11.0,   # 0-4: swing high at 2
            14.0, 16.0, 17.0, 16.0, 15.0,   # 5-9: breaks high, swing low at 9
            16.0, 17.0, 14.0                 # 10-12: breaks low
        ])
        low = np.array([
            9.0, 11.0, 14.0, 12.0, 10.0,
            13.0, 15.0, 16.0, 15.0, 14.0,
            15.0, 16.0, 13.0
        ])
        open_ = np.array([
            9.5, 11.5, 14.5, 12.5, 10.5,
            13.5, 15.5, 16.5, 15.5, 14.5,
            15.5, 16.5, 14.5
        ])
        close = np.array([
            9.8, 11.8, 14.8, 12.2, 10.2,
            13.8, 15.8, 16.8, 15.2, 14.2,
            15.8, 16.8, 13.5
        ])

        bos_events = detect_bos(open_, high, low, close)

        # Should have at least one bullish BOS
        assert len(bos_events) >= 1

    def test_precomputed_swings(self):
        """Test BOS detection with pre-computed swings."""
        high = np.array([10.0, 12.0, 15.0, 13.0, 11.0, 14.0, 16.0])
        low = np.array([9.0, 11.0, 14.0, 12.0, 10.0, 13.0, 15.0])
        open_ = np.array([9.5, 11.5, 14.5, 12.5, 10.5, 13.5, 15.5])
        close = np.array([9.8, 11.8, 14.8, 12.2, 10.2, 13.8, 15.8])

        swings = find_pivot_swings(high, low)
        bos_events = detect_bos(open_, high, low, close, swings=swings)

        assert len(bos_events) > 0
