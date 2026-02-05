"""
MarketDataService Integration Test
Verifies the service layer returns correct format with indicators.
"""
import sys
sys.path.insert(0, '.')

from engine.services.market_data_service import MarketDataService


def main():
    print("=" * 60)
    print("  MarketDataService — Integration Test")
    print("=" * 60)

    svc = MarketDataService()

    # Test KR market
    print("\n[Test 1] KR market — Samsung (005930) 1D")
    try:
        result = svc.get_ohlcv("005930", "KR", "1D")
        validate_result(result, "KR 005930 1D")
    except Exception as e:
        print(f"  ❌ FAILED: {e}")

    # Test US market
    print("\n[Test 2] US market — AAPL 1D")
    try:
        result = svc.get_ohlcv("AAPL", "US", "1D")
        validate_result(result, "US AAPL 1D")
    except Exception as e:
        print(f"  ❌ FAILED: {e}")

    print("\n" + "=" * 60)
    print("  Done")
    print("=" * 60)


def validate_result(result: dict, label: str):
    """Validate the service response format."""
    assert "bars" in result, "Missing 'bars' key"
    assert "indicators" in result, "Missing 'indicators' key"
    assert "symbol" in result, "Missing 'symbol' key"
    assert "market" in result, "Missing 'market' key"
    assert "timeframe" in result, "Missing 'timeframe' key"
    assert "data_source" in result, "Missing 'data_source' key"

    bars = result["bars"]
    indicators = result["indicators"]

    print(f"  Source: {result['data_source']}")
    print(f"  Bars: {len(bars)}")

    if len(bars) == 0:
        print("  ⚠️  No bars returned (API may be unavailable)")
        return

    # Check bar format
    bar = bars[0]
    for key in ("time", "open", "high", "low", "close", "volume"):
        assert key in bar, f"Bar missing '{key}'"

    # Check indicator keys exist
    expected_indicators = [
        "ema20", "ema200", "sma20", "sma200",
        "rsi", "rsi_signal",
        "macd_line", "macd_signal", "macd_hist",
        "stoch_slow_k", "stoch_slow_d",
        "stoch_med_k", "stoch_med_d",
        "stoch_fast_k", "stoch_fast_d",
        "bb1_upper", "bb1_lower",
        "bb2_upper", "bb2_lower",
        "rsi_bb_upper", "rsi_bb_lower",
        "vwap",
        "kc_upper", "kc_lower",
        "squeeze",
    ]
    for key in expected_indicators:
        assert key in indicators, f"Missing indicator '{key}'"
        assert len(indicators[key]) == len(bars), \
            f"Indicator '{key}' length {len(indicators[key])} != bars {len(bars)}"

    print(f"  ✅ All {len(expected_indicators)} indicators present, lengths match")
    print(f"     First bar: time={bar['time']} C={bar['close']}")
    print(f"     Last bar:  time={bars[-1]['time']} C={bars[-1]['close']}")


if __name__ == "__main__":
    main()
