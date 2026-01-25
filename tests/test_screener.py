"""Tests for EMA cross screener."""

import numpy as np
import pytest

from engine.core.screener import (
    ema,
    forecast_cross_days,
    score_candidate,
    screen_symbol,
    screen_watchlist,
    ScreenResult,
)


class TestEMA:
    """Tests for EMA calculation."""

    def test_ema_basic(self):
        """Test basic EMA calculation."""
        closes = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
        result = ema(closes, 5)

        # First 4 values should be NaN
        assert np.all(np.isnan(result[:4]))
        # Value at index 4 should be SMA of first 5
        assert result[4] == pytest.approx(3.0)  # (1+2+3+4+5)/5
        # Subsequent values should be EMA
        assert not np.isnan(result[5])

    def test_ema_insufficient_data(self):
        """Test EMA with insufficient data."""
        closes = np.array([1.0, 2.0, 3.0])
        result = ema(closes, 5)

        assert len(result) == 3
        assert np.all(np.isnan(result))

    def test_ema_period_20(self):
        """Test EMA with period 20."""
        closes = np.arange(1.0, 51.0)  # 50 values
        result = ema(closes, 20)

        assert np.all(np.isnan(result[:19]))
        assert not np.isnan(result[19])
        assert result[19] == pytest.approx(np.mean(closes[:20]))


class TestForecastCrossDays:
    """Tests for forecast_cross_days."""

    def test_already_crossed(self):
        """Test when EMA20 already above EMA200 (d0 <= 0)."""
        # EMA20 > EMA200
        ema20 = np.array([100.0, 101.0, 102.0, 103.0, 104.0, 105.0])
        ema200 = np.array([90.0, 91.0, 92.0, 93.0, 94.0, 95.0])

        result = forecast_cross_days(ema20, ema200)
        assert result == 0

    def test_not_converging(self):
        """Test when lines not converging (d0 > 0 and v <= 0)."""
        # EMA20 below and diverging
        ema20 = np.array([90.0, 89.0, 88.0, 87.0, 86.0, 85.0])
        ema200 = np.array([100.0, 100.0, 100.0, 100.0, 100.0, 100.0])

        result = forecast_cross_days(ema20, ema200)
        assert result is None

    def test_converging_cross(self):
        """Test when lines are converging."""
        # EMA20 rising toward EMA200
        ema20 = np.array([90.0, 92.0, 94.0, 96.0, 98.0, 100.0])
        ema200 = np.array([110.0, 110.0, 110.0, 110.0, 110.0, 110.0])

        # d0 = 110 - 100 = 10
        # v = (100 - 90) - (110 - 110) = 10
        # days = ceil(10 / 10) = 1
        result = forecast_cross_days(ema20, ema200)
        assert result == 1

    def test_insufficient_data(self):
        """Test with insufficient data for slope calculation."""
        ema20 = np.array([100.0, 101.0, 102.0])
        ema200 = np.array([110.0, 110.0, 110.0])

        result = forecast_cross_days(ema20, ema200)
        assert result is None


class TestScoreCandidate:
    """Tests for score_candidate."""

    def test_none_days(self):
        """Test score when days_to_cross is None."""
        score = score_candidate(None, 10.0, 2.0, 100.0)
        assert score == 0

    def test_zero_days(self):
        """Test score when already crossed (days=0)."""
        # days=0, d0=0 (crossed), v=2, ema200=100
        # 100 - 0 - 20*(0/100) + 10*min(3, 2/100)
        # = 100 - 0 - 0 + 10*0.02 = 100.2 -> clamp to 100
        score = score_candidate(0, 0.0, 2.0, 100.0)
        assert score == 100

    def test_high_days(self):
        """Test score with high days to cross."""
        # days=30, d0=30, v=1, ema200=100
        # 100 - 150 - 20*(30/100) + 10*min(3, 1/100)
        # = 100 - 150 - 6 + 0.1 = -55.9 -> clamp to 0
        score = score_candidate(30, 30.0, 1.0, 100.0)
        assert score == 0

    def test_mid_range(self):
        """Test score in middle range."""
        # days=10, d0=5, v=3, ema200=100
        # 100 - 50 - 20*(5/100) + 10*min(3, 3/100)
        # = 100 - 50 - 1 + 0.3 = 49.3 -> 49
        score = score_candidate(10, 5.0, 3.0, 100.0)
        assert score == 49

    def test_clamp_upper(self):
        """Test clamping at upper bound."""
        score = score_candidate(0, -10.0, 10.0, 100.0)
        assert score <= 100

    def test_clamp_lower(self):
        """Test clamping at lower bound."""
        score = score_candidate(50, 100.0, -10.0, 100.0)
        assert score >= 0

    def test_zero_ema(self):
        """Test with zero ema_slow_last."""
        score = score_candidate(5, 10.0, 2.0, 0.0)
        assert score == 0


class TestScreenSymbol:
    """Tests for screen_symbol."""

    def test_insufficient_data(self):
        """Test with insufficient data."""
        closes = np.arange(1.0, 101.0)  # Only 100 bars

        result = screen_symbol("TEST", "US", closes)

        assert result.reason == "INSUFFICIENT_DATA"
        assert result.score == 0
        assert result.symbol == "TEST"
        assert result.market == "US"

    def test_no_convergence(self):
        """Test when not converging."""
        # Create data where EMA20 is below EMA200 and diverging
        closes = np.concatenate([
            np.linspace(150, 100, 250),  # Downtrend
        ])

        result = screen_symbol("TEST", "KR", closes)

        assert result.reason in ["NO_CONVERGENCE", "OUT_OF_WINDOW", "OK"]
        assert result.last_close == pytest.approx(100.0)

    def test_ok_result(self):
        """Test successful screening result."""
        # Create data where EMA20 is converging toward EMA200
        # Start low, then rally to create golden cross setup
        closes = np.concatenate([
            np.full(200, 100.0),  # Stable period for EMA200
            np.linspace(100, 120, 50),  # Rally to push EMA20 up
        ])

        result = screen_symbol("TEST", "US", closes)

        assert result.symbol == "TEST"
        assert result.market == "US"
        assert result.last_close > 0
        assert result.ema20 > 0
        assert result.ema200 > 0

    def test_all_fields_populated(self):
        """Test that all fields are populated."""
        closes = np.arange(100.0, 360.0)  # 260 bars

        result = screen_symbol("TEST", "US", closes)

        assert result.symbol == "TEST"
        assert result.market == "US"
        assert isinstance(result.last_close, float)
        assert isinstance(result.ema20, float)
        assert isinstance(result.ema200, float)
        assert isinstance(result.gap, float)
        assert isinstance(result.slope_diff, float)
        assert isinstance(result.score, int)
        assert isinstance(result.reason, str)


class TestScreenWatchlist:
    """Tests for screen_watchlist."""

    def test_empty_watchlist(self):
        """Test with empty watchlist."""
        def get_closes(symbol):
            return None

        result = screen_watchlist([], "US", get_closes)
        assert result == []

    def test_all_insufficient_data(self):
        """Test when all symbols have insufficient data."""
        def get_closes(symbol):
            return np.arange(1.0, 101.0)  # Only 100 bars

        result = screen_watchlist(["A", "B", "C"], "US", get_closes)
        # Only OK results returned, so empty
        assert result == []

    def test_mixed_results(self):
        """Test with mixed results."""
        def get_closes(symbol):
            if symbol == "GOOD":
                # Create convergence scenario
                return np.concatenate([
                    np.full(200, 100.0),
                    np.linspace(100, 110, 50),
                ])
            else:
                return np.arange(1.0, 51.0)  # Insufficient

        result = screen_watchlist(["GOOD", "BAD"], "US", get_closes)

        # Only candidates (OK) are returned
        for r in result:
            assert r.reason == "OK"

    def test_top_n_limit(self):
        """Test top_n limiting."""
        def get_closes(symbol):
            return np.concatenate([
                np.full(200, 100.0),
                np.linspace(100, 110, 50),
            ])

        symbols = [f"SYM{i}" for i in range(10)]
        result = screen_watchlist(symbols, "US", get_closes, top_n=3)

        assert len(result) <= 3

    def test_sorted_by_score_then_days(self):
        """Test sorting by score desc, then days asc."""
        results = []

        def get_closes(symbol):
            return np.concatenate([
                np.full(200, 100.0),
                np.linspace(100, 105, 50),
            ])

        result = screen_watchlist(["A", "B", "C"], "US", get_closes)

        # Verify sorting
        for i in range(len(result) - 1):
            curr = result[i]
            next_ = result[i + 1]
            # Score should be descending
            assert curr.score >= next_.score
            # If same score, days should be ascending
            if curr.score == next_.score:
                assert (curr.days_to_cross or 999) <= (next_.days_to_cross or 999)

    def test_none_closes_handled(self):
        """Test that None closes are handled."""
        def get_closes(symbol):
            return None

        result = screen_watchlist(["A", "B"], "US", get_closes)
        # None closes result in INSUFFICIENT_DATA, which is not OK
        assert result == []
