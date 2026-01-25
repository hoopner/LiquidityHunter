"""CSV data loader for OHLCV data."""

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import List

import numpy as np


@dataclass
class OHLCVData:
    """OHLCV data arrays."""
    timestamps: List[str]
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray


def load_csv(symbol: str, timeframe: str, data_dir: str = "data") -> OHLCVData:
    """
    Load OHLCV data from CSV file.

    Args:
        symbol: Symbol name (e.g., "SAMPLE")
        timeframe: Timeframe (e.g., "1D")
        data_dir: Directory containing CSV files

    Returns:
        OHLCVData with arrays

    Raises:
        FileNotFoundError: If CSV file doesn't exist
    """
    filename = f"{symbol}_{timeframe}.csv"
    filepath = Path(data_dir) / filename

    if not filepath.exists():
        raise FileNotFoundError(f"Data file not found: {filepath}")

    timestamps = []
    opens = []
    highs = []
    lows = []
    closes = []
    volumes = []

    with open(filepath, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            timestamps.append(row["timestamp"])
            opens.append(float(row["open"]))
            highs.append(float(row["high"]))
            lows.append(float(row["low"]))
            closes.append(float(row["close"]))
            volumes.append(float(row["volume"]))

    return OHLCVData(
        timestamps=timestamps,
        open=np.array(opens),
        high=np.array(highs),
        low=np.array(lows),
        close=np.array(closes),
        volume=np.array(volumes),
    )
