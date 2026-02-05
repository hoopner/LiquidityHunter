"""
Repository Pattern Validation Test
Verifies each repository returns correctly formatted OHLCVData.
"""
import sys
sys.path.insert(0, '.')

from engine.repositories.base import OHLCVData
from engine.repositories.kis_repository import KISRepository
from engine.repositories.alpaca_repository import AlpacaRepository


def validate_ohlcv(data: OHLCVData, label: str):
    """Validate OHLCVData conforms to the standard contract."""
    print(f"\n--- {label} ---")

    assert isinstance(data.timestamps, list), "timestamps must be list"
    assert isinstance(data.open, list), "open must be list"
    assert isinstance(data.high, list), "high must be list"
    assert isinstance(data.low, list), "low must be list"
    assert isinstance(data.close, list), "close must be list"
    assert isinstance(data.volume, list), "volume must be list"

    n = len(data.timestamps)
    assert len(data.open) == n, f"open length {len(data.open)} != {n}"
    assert len(data.high) == n, f"high length {len(data.high)} != {n}"
    assert len(data.low) == n, f"low length {len(data.low)} != {n}"
    assert len(data.close) == n, f"close length {len(data.close)} != {n}"
    assert len(data.volume) == n, f"volume length {len(data.volume)} != {n}"

    if n == 0:
        print("  ⚠️  WARNING: No data returned (API may be unavailable)")
        return

    # Timestamps must be Unix seconds (int), not milliseconds, not strings
    for i, ts in enumerate(data.timestamps[:5]):
        assert isinstance(ts, int), f"timestamps[{i}] must be int, got {type(ts).__name__}: {ts}"
        assert 946684800 < ts < 2000000000, f"timestamps[{i}]={ts} out of range (must be Unix seconds)"

    # Must be sorted ascending
    for i in range(1, min(n, 20)):
        assert data.timestamps[i] >= data.timestamps[i-1], \
            f"Not sorted at [{i}]: {data.timestamps[i-1]} > {data.timestamps[i]}"

    # Price sanity check
    for i in range(min(n, 5)):
        assert data.high[i] >= data.low[i], f"high < low at [{i}]"
        assert data.open[i] >= data.low[i], f"open < low at [{i}]"
        assert data.close[i] >= data.low[i], f"close < low at [{i}]"
        assert data.open[i] <= data.high[i], f"open > high at [{i}]"
        assert data.close[i] <= data.high[i], f"close > high at [{i}]"

    print(f"  ✅ {n} bars | Format valid | Sorted ascending")
    print(f"     First bar: time={data.timestamps[0]} O={data.open[0]} H={data.high[0]} L={data.low[0]} C={data.close[0]} V={data.volume[0]}")
    print(f"     Last bar:  time={data.timestamps[-1]} O={data.open[-1]} H={data.high[-1]} L={data.low[-1]} C={data.close[-1]} V={data.volume[-1]}")


def main():
    print("=" * 60)
    print("  LiquidityHunter — Repository Pattern Test")
    print("=" * 60)

    results = {"pass": 0, "fail": 0}

    # Test KIS (Korean stock)
    print("\n[KIS Repository — Korean Market]")
    try:
        kis = KISRepository()
        data = kis.get_ohlcv("005930", "1D")  # Samsung Electronics, daily
        validate_ohlcv(data, "KIS: 005930 (Samsung) 1D")
        results["pass"] += 1
    except Exception as e:
        print(f"  ❌ FAILED: {e}")
        results["fail"] += 1

    # Test Alpaca (US stock)
    print("\n[Alpaca Repository — US Market]")
    try:
        alpaca = AlpacaRepository()
        data = alpaca.get_ohlcv("AAPL", "1D")  # Apple, daily
        validate_ohlcv(data, "Alpaca: AAPL (Apple) 1D")
        results["pass"] += 1
    except Exception as e:
        print(f"  ❌ FAILED: {e}")
        results["fail"] += 1

    print("\n" + "=" * 60)
    print(f"  Results: {results['pass']} passed, {results['fail']} failed")
    print("=" * 60)


if __name__ == "__main__":
    main()
