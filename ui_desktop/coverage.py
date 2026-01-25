"""Coverage computation from local files.

This module scans the local filesystem to compute coverage statistics
WITHOUT using any engine code. It operates entirely on file I/O.
"""

from pathlib import Path
from typing import List, Tuple

from .models import CoverageInfo, SymbolStatus


# Minimum rows required for sufficient data (EMA200 needs ~200 bars)
MIN_ROWS_REQUIRED = 250


def _read_watchlist(watchlist_path: Path) -> List[str]:
    """Read symbols from a watchlist file.

    Args:
        watchlist_path: Path to watchlist file (one symbol per line)

    Returns:
        List of symbols (empty list if file doesn't exist)
    """
    if not watchlist_path.exists():
        return []

    symbols = []
    with open(watchlist_path, "r") as f:
        for line in f:
            symbol = line.strip()
            if symbol:  # Skip empty lines
                symbols.append(symbol)
    return symbols


def _count_csv_rows(csv_path: Path) -> int:
    """Count data rows in a CSV file (excluding header).

    Args:
        csv_path: Path to CSV file

    Returns:
        Number of data rows (0 if file doesn't exist)
    """
    if not csv_path.exists():
        return 0

    count = 0
    with open(csv_path, "r") as f:
        # Skip header
        next(f, None)
        for _ in f:
            count += 1
    return count


def _find_csv_for_symbol(data_dir: Path, symbol: str) -> Path | None:
    """Find the CSV file for a symbol.

    Looks for {symbol}_1D.csv in the data directory.

    Args:
        data_dir: Directory containing CSV files
        symbol: Stock symbol

    Returns:
        Path to CSV if found, None otherwise
    """
    csv_path = data_dir / f"{symbol}_1D.csv"
    if csv_path.exists():
        return csv_path
    return None


def _analyze_symbol(data_dir: Path, symbol: str) -> SymbolStatus:
    """Analyze a single symbol's data status.

    Args:
        data_dir: Directory containing CSV files
        symbol: Stock symbol

    Returns:
        SymbolStatus with availability details
    """
    csv_path = _find_csv_for_symbol(data_dir, symbol)
    if csv_path is None:
        return SymbolStatus(
            symbol=symbol,
            has_csv=False,
            row_count=0,
            is_sufficient=False,
        )

    row_count = _count_csv_rows(csv_path)
    return SymbolStatus(
        symbol=symbol,
        has_csv=True,
        row_count=row_count,
        is_sufficient=row_count >= MIN_ROWS_REQUIRED,
    )


def compute_coverage(data_root: Path, market: str) -> CoverageInfo:
    """Compute coverage statistics for a market.

    This scans local files only - no network calls, no engine code.

    Args:
        data_root: Root data directory (e.g., /path/to/data/)
        market: Market code (KR or US)

    Returns:
        CoverageInfo with computed statistics and detailed symbol lists
    """
    market_lower = market.lower()

    # Paths
    watchlist_path = data_root / f"{market_lower}_watchlist.txt"
    market_data_dir = data_root / market_lower

    # Read watchlist
    symbols = _read_watchlist(watchlist_path)
    selected_size = len(symbols)

    # Analyze each symbol
    missing_symbols: List[str] = []
    insufficient_symbols: List[SymbolStatus] = []
    ready_symbols: List[str] = []

    for symbol in symbols:
        status = _analyze_symbol(market_data_dir, symbol)
        if not status.has_csv:
            missing_symbols.append(symbol)
        elif not status.is_sufficient:
            insufficient_symbols.append(status)
        else:
            ready_symbols.append(symbol)

    available_count = selected_size - len(missing_symbols)
    missing_count = len(missing_symbols)
    insufficient_data_count = len(insufficient_symbols)

    return CoverageInfo(
        selected_size=selected_size,
        available_count=available_count,
        missing_count=missing_count,
        insufficient_data_count=insufficient_data_count,
        missing_symbols=missing_symbols,
        insufficient_symbols=insufficient_symbols,
        ready_symbols=ready_symbols,
    )


def get_data_root() -> Path:
    """Get the data root directory.

    Returns:
        Path to data/ directory relative to project root
    """
    # Assume we're running from project root or ui_desktop/
    # Try relative paths
    candidates = [
        Path("data"),
        Path("../data"),
        Path(__file__).parent.parent / "data",
    ]

    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate.resolve()

    # Fallback to default
    return Path("data").resolve()


def get_watchlist_path(data_root: Path, market: str) -> Path:
    """Get the watchlist file path for a market.

    Args:
        data_root: Root data directory
        market: Market code (KR or US)

    Returns:
        Path to watchlist file
    """
    return data_root / f"{market.lower()}_watchlist.txt"


def get_market_data_dir(data_root: Path, market: str) -> Path:
    """Get the market data directory.

    Args:
        data_root: Root data directory
        market: Market code (KR or US)

    Returns:
        Path to market data directory
    """
    return data_root / market.lower()
