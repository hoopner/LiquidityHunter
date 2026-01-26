#!/usr/bin/env python3
"""Seed data diagnostic tool.

Reports the status of CSV data files for all symbols in watchlists.
Does NOT download or modify any data.
"""

from pathlib import Path
from typing import List, Tuple

# Constants
MIN_ROWS_REQUIRED = 250
DATA_DIR = Path(__file__).parent.parent / "data"


def read_watchlist(filepath: Path) -> List[str]:
    """Read symbols from a watchlist file."""
    if not filepath.exists():
        return []

    symbols = []
    with open(filepath, "r") as f:
        for line in f:
            symbol = line.strip()
            if symbol:
                symbols.append(symbol)
    return symbols


def count_csv_rows(filepath: Path) -> int:
    """Count data rows in CSV (excluding header)."""
    if not filepath.exists():
        return 0

    count = 0
    with open(filepath, "r") as f:
        next(f, None)  # Skip header
        for _ in f:
            count += 1
    return count


def check_symbol(symbol: str, market: str) -> Tuple[str, int]:
    """Check status of a symbol's data file.

    Returns:
        Tuple of (status, row_count)
        status: "OK", "INSUFFICIENT_ROWS", or "MISSING"
    """
    csv_path = DATA_DIR / market.lower() / f"{symbol}_1D.csv"

    if not csv_path.exists():
        return ("MISSING", 0)

    row_count = count_csv_rows(csv_path)

    if row_count >= MIN_ROWS_REQUIRED:
        return ("OK", row_count)
    else:
        return ("INSUFFICIENT_ROWS", row_count)


def print_report(market: str, results: List[Tuple[str, str, int]]) -> None:
    """Print formatted report for a market.

    Args:
        market: Market code (KR or US)
        results: List of (symbol, status, row_count) tuples
    """
    print(f"\n[{market}]")

    if not results:
        print("  (no symbols in watchlist)")
        return

    # Find max symbol length for alignment
    max_len = max(len(r[0]) for r in results)

    # Counters
    ok_count = 0
    missing_count = 0
    insufficient_count = 0

    for symbol, status, row_count in results:
        if status == "OK":
            print(f"  {symbol:<{max_len}}  OK ({row_count} rows)")
            ok_count += 1
        elif status == "MISSING":
            print(f"  {symbol:<{max_len}}  MISSING")
            missing_count += 1
        else:  # INSUFFICIENT_ROWS
            print(f"  {symbol:<{max_len}}  INSUFFICIENT_ROWS ({row_count} rows)")
            insufficient_count += 1

    # Summary
    total = len(results)
    print(f"\n  Summary: {ok_count}/{total} OK, {missing_count} missing, {insufficient_count} insufficient")


def main():
    """Main entry point."""
    print("=" * 50)
    print("Seed Data Status Report")
    print("=" * 50)
    print(f"Data directory: {DATA_DIR}")
    print(f"Minimum rows required: {MIN_ROWS_REQUIRED}")

    markets = [
        ("KR", DATA_DIR / "kr_watchlist.txt"),
        ("US", DATA_DIR / "us_watchlist.txt"),
    ]

    total_ok = 0
    total_missing = 0
    total_insufficient = 0

    for market, watchlist_path in markets:
        symbols = read_watchlist(watchlist_path)

        if not watchlist_path.exists():
            print(f"\n[{market}]")
            print(f"  Watchlist not found: {watchlist_path}")
            continue

        results = []
        for symbol in symbols:
            status, row_count = check_symbol(symbol, market)
            results.append((symbol, status, row_count))

            if status == "OK":
                total_ok += 1
            elif status == "MISSING":
                total_missing += 1
            else:
                total_insufficient += 1

        print_report(market, results)

    # Grand total
    grand_total = total_ok + total_missing + total_insufficient
    print("\n" + "=" * 50)
    print(f"Total: {total_ok}/{grand_total} OK, {total_missing} missing, {total_insufficient} insufficient")
    print("=" * 50)


if __name__ == "__main__":
    main()
