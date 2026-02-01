"""
Full Market SMA Scanner with M4 Max Optimization
Parallel processing scanner for detecting SMA Golden Cross signals
across entire markets (KOSPI, KOSDAQ, NYSE, NASDAQ).
"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
from enum import Enum
import json
from pathlib import Path

import yfinance as yf
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)


class MarketType(str, Enum):
    """Supported market types."""
    US = "US"
    KR = "KR"


class ScanSignalType(str, Enum):
    """Types of SMA signals detected."""
    GOLDEN_CROSS = "golden_cross"  # SMA20 crosses above SMA200
    DEATH_CROSS = "death_cross"    # SMA20 crosses below SMA200
    BULLISH_ALIGNMENT = "bullish_alignment"  # Price > SMA20 > SMA200
    BEARISH_ALIGNMENT = "bearish_alignment"  # Price < SMA20 < SMA200


@dataclass
class ScanResult:
    """Result from scanning a single symbol."""
    symbol: str
    market: str
    signal_type: str
    current_price: float
    sma20: float
    sma200: float
    volume: int
    volume_ratio: float  # Current volume vs 20-day average
    price_change_pct: float
    detected_at: str = field(default_factory=lambda: datetime.now().isoformat())
    days_since_cross: int = 0  # How many days ago the cross happened

    def to_dict(self) -> Dict:
        return {
            "symbol": self.symbol,
            "market": self.market,
            "signal_type": self.signal_type,
            "current_price": self.current_price,
            "sma20": self.sma20,
            "sma200": self.sma200,
            "volume": self.volume,
            "volume_ratio": self.volume_ratio,
            "price_change_pct": self.price_change_pct,
            "detected_at": self.detected_at,
            "days_since_cross": self.days_since_cross,
        }


@dataclass
class ScanCacheEntry:
    """Cached scan results."""
    results: List[ScanResult]
    scanned_at: datetime
    symbols_scanned: int
    symbols_with_signals: int
    scan_duration_seconds: float


class FullMarketScanner:
    """
    High-performance market scanner optimized for M4 Max.
    Uses parallel processing to scan 200+ symbols simultaneously.
    """

    # Parallel processing settings optimized for M4 Max
    MAX_WORKERS = 200  # Concurrent downloads
    BATCH_SIZE = 50    # Symbols per batch

    # Cache settings
    CACHE_DURATION_HOURS = 1

    # SMA periods
    SMA_SHORT = 20
    SMA_LONG = 200

    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.cache_dir = self.data_dir / "scanner_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Thread pool for parallel downloads
        self._executor = ThreadPoolExecutor(max_workers=self.MAX_WORKERS)

        # In-memory cache
        self._cache: Dict[str, ScanCacheEntry] = {}

        # Load symbol lists
        self._symbols: Dict[str, List[str]] = {
            "US": [],
            "KR": [],
        }
        self._load_symbol_lists()

    def _load_symbol_lists(self):
        """Load symbol lists from watchlist files."""
        # Load US symbols
        us_file = self.data_dir / "us_watchlist.txt"
        if us_file.exists():
            with open(us_file, "r") as f:
                self._symbols["US"] = [
                    line.strip() for line in f
                    if line.strip() and not line.startswith("#")
                ]

        # Load KR symbols
        kr_file = self.data_dir / "kr_watchlist.txt"
        if kr_file.exists():
            with open(kr_file, "r") as f:
                self._symbols["KR"] = [
                    line.strip() for line in f
                    if line.strip() and not line.startswith("#")
                ]

        logger.info(f"Loaded {len(self._symbols['US'])} US symbols, {len(self._symbols['KR'])} KR symbols")

    def get_market_symbols(self, market: str) -> List[str]:
        """Get symbols for a market."""
        return self._symbols.get(market.upper(), [])

    def set_market_symbols(self, market: str, symbols: List[str]):
        """Set symbols for a market."""
        self._symbols[market.upper()] = symbols

    def _get_yf_symbol(self, symbol: str, market: str) -> str:
        """Convert symbol to yfinance format."""
        if market.upper() == "KR":
            # Korean stocks need .KS (KOSPI) or .KQ (KOSDAQ) suffix
            if not symbol.endswith((".KS", ".KQ")):
                # Default to KOSPI, but check common KOSDAQ prefixes
                return f"{symbol}.KS"
        return symbol

    def _download_symbol_data(self, symbol: str, market: str) -> Optional[pd.DataFrame]:
        """
        Download historical data for a single symbol.
        Returns DataFrame with OHLCV data or None on error.
        """
        try:
            yf_symbol = self._get_yf_symbol(symbol, market)
            ticker = yf.Ticker(yf_symbol)

            # Get 1 year of daily data for SMA200 calculation
            df = ticker.history(period="1y", interval="1d")

            if df.empty or len(df) < self.SMA_LONG:
                return None

            return df

        except Exception as e:
            logger.debug(f"Failed to download {symbol}: {e}")
            return None

    def _analyze_symbol(self, symbol: str, market: str, df: pd.DataFrame) -> Optional[ScanResult]:
        """
        Analyze a symbol's data for SMA signals.
        Returns ScanResult if signal detected, None otherwise.
        """
        try:
            # Calculate SMAs
            df["SMA20"] = df["Close"].rolling(window=self.SMA_SHORT).mean()
            df["SMA200"] = df["Close"].rolling(window=self.SMA_LONG).mean()

            # Get latest values
            latest = df.iloc[-1]
            current_price = float(latest["Close"])
            sma20 = float(latest["SMA20"])
            sma200 = float(latest["SMA200"])
            volume = int(latest["Volume"])

            # Calculate volume ratio (current vs 20-day average)
            avg_volume = df["Volume"].tail(20).mean()
            volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0

            # Calculate price change
            if len(df) >= 2:
                prev_close = float(df.iloc[-2]["Close"])
                price_change_pct = ((current_price - prev_close) / prev_close) * 100
            else:
                price_change_pct = 0.0

            # Detect golden cross (SMA20 crosses above SMA200)
            signal_type = None
            days_since_cross = 0

            # Check for recent golden cross (within last 5 days)
            for i in range(1, min(6, len(df))):
                if i >= len(df):
                    break

                prev_sma20 = df["SMA20"].iloc[-i-1]
                prev_sma200 = df["SMA200"].iloc[-i-1]
                curr_sma20 = df["SMA20"].iloc[-i]
                curr_sma200 = df["SMA200"].iloc[-i]

                if pd.notna(prev_sma20) and pd.notna(prev_sma200):
                    # Golden cross: SMA20 was below SMA200, now above
                    if prev_sma20 < prev_sma200 and curr_sma20 >= curr_sma200:
                        signal_type = ScanSignalType.GOLDEN_CROSS.value
                        days_since_cross = i - 1
                        break
                    # Death cross: SMA20 was above SMA200, now below
                    elif prev_sma20 > prev_sma200 and curr_sma20 <= curr_sma200:
                        signal_type = ScanSignalType.DEATH_CROSS.value
                        days_since_cross = i - 1
                        break

            # If no cross detected, check for alignment
            if signal_type is None:
                if current_price > sma20 > sma200:
                    signal_type = ScanSignalType.BULLISH_ALIGNMENT.value
                elif current_price < sma20 < sma200:
                    signal_type = ScanSignalType.BEARISH_ALIGNMENT.value

            # Only return results with signals
            if signal_type is None:
                return None

            return ScanResult(
                symbol=symbol,
                market=market,
                signal_type=signal_type,
                current_price=round(current_price, 2),
                sma20=round(sma20, 2),
                sma200=round(sma200, 2),
                volume=volume,
                volume_ratio=round(volume_ratio, 2),
                price_change_pct=round(price_change_pct, 2),
                days_since_cross=days_since_cross,
            )

        except Exception as e:
            logger.debug(f"Failed to analyze {symbol}: {e}")
            return None

    async def _scan_symbol(self, symbol: str, market: str) -> Optional[ScanResult]:
        """Scan a single symbol asynchronously."""
        loop = asyncio.get_event_loop()

        # Download data in thread pool
        df = await loop.run_in_executor(
            self._executor,
            self._download_symbol_data,
            symbol,
            market
        )

        if df is None:
            return None

        # Analyze in thread pool
        return await loop.run_in_executor(
            self._executor,
            self._analyze_symbol,
            symbol,
            market,
            df
        )

    async def scan_market_parallel(
        self,
        market: str,
        signal_types: Optional[List[str]] = None,
        force_refresh: bool = False
    ) -> List[ScanResult]:
        """
        Scan entire market using parallel processing.

        Args:
            market: "US" or "KR"
            signal_types: Filter by signal types (default: golden_cross only)
            force_refresh: Bypass cache

        Returns:
            List of ScanResult objects
        """
        market = market.upper()
        cache_key = f"{market}_{','.join(sorted(signal_types or ['golden_cross']))}"

        # Check cache
        if not force_refresh and cache_key in self._cache:
            entry = self._cache[cache_key]
            cache_age = datetime.now() - entry.scanned_at
            if cache_age < timedelta(hours=self.CACHE_DURATION_HOURS):
                logger.info(f"Returning cached results for {market} ({len(entry.results)} signals)")
                return entry.results

        # Get symbols
        symbols = self.get_market_symbols(market)
        if not symbols:
            logger.warning(f"No symbols found for market {market}")
            return []

        logger.info(f"Scanning {len(symbols)} symbols in {market} market...")
        start_time = datetime.now()

        # Default to golden cross only
        if signal_types is None:
            signal_types = [ScanSignalType.GOLDEN_CROSS.value]

        # Scan in parallel batches
        all_results: List[ScanResult] = []

        for i in range(0, len(symbols), self.BATCH_SIZE):
            batch = symbols[i:i + self.BATCH_SIZE]
            logger.info(f"Processing batch {i // self.BATCH_SIZE + 1}/{(len(symbols) + self.BATCH_SIZE - 1) // self.BATCH_SIZE}")

            # Create tasks for batch
            tasks = [self._scan_symbol(symbol, market) for symbol in batch]

            # Execute batch in parallel
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Collect valid results
            for result in results:
                if isinstance(result, ScanResult):
                    if result.signal_type in signal_types:
                        all_results.append(result)

        # Sort by volume ratio (higher is better)
        all_results.sort(key=lambda x: x.volume_ratio, reverse=True)

        # Calculate scan duration
        scan_duration = (datetime.now() - start_time).total_seconds()

        # Cache results
        self._cache[cache_key] = ScanCacheEntry(
            results=all_results,
            scanned_at=datetime.now(),
            symbols_scanned=len(symbols),
            symbols_with_signals=len(all_results),
            scan_duration_seconds=scan_duration,
        )

        # Save to disk cache
        self._save_cache_to_disk(cache_key, all_results)

        logger.info(
            f"Scan complete: {len(all_results)} signals found in {scan_duration:.1f}s "
            f"({len(symbols)} symbols scanned)"
        )

        return all_results

    def _save_cache_to_disk(self, cache_key: str, results: List[ScanResult]):
        """Save scan results to disk cache."""
        cache_file = self.cache_dir / f"{cache_key}.json"
        try:
            data = {
                "cache_key": cache_key,
                "cached_at": datetime.now().isoformat(),
                "results": [r.to_dict() for r in results],
            }
            with open(cache_file, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save cache: {e}")

    def _load_cache_from_disk(self, cache_key: str) -> Optional[List[ScanResult]]:
        """Load scan results from disk cache."""
        cache_file = self.cache_dir / f"{cache_key}.json"
        try:
            if not cache_file.exists():
                return None

            with open(cache_file, "r") as f:
                data = json.load(f)

            # Check cache age
            cached_at = datetime.fromisoformat(data["cached_at"])
            if datetime.now() - cached_at > timedelta(hours=self.CACHE_DURATION_HOURS):
                return None

            return [
                ScanResult(**r) for r in data["results"]
            ]
        except Exception as e:
            logger.error(f"Failed to load cache: {e}")
            return None

    async def scan_all_markets(
        self,
        signal_types: Optional[List[str]] = None,
        force_refresh: bool = False
    ) -> Dict[str, List[ScanResult]]:
        """
        Scan all markets in parallel.

        Returns:
            Dict mapping market to list of ScanResults
        """
        # Scan both markets concurrently
        us_task = self.scan_market_parallel("US", signal_types, force_refresh)
        kr_task = self.scan_market_parallel("KR", signal_types, force_refresh)

        us_results, kr_results = await asyncio.gather(us_task, kr_task)

        return {
            "US": us_results,
            "KR": kr_results,
        }

    def get_cache_status(self) -> Dict:
        """Get status of cached scan results."""
        status = {}
        for key, entry in self._cache.items():
            cache_age = datetime.now() - entry.scanned_at
            status[key] = {
                "symbols_scanned": entry.symbols_scanned,
                "signals_found": entry.symbols_with_signals,
                "scanned_at": entry.scanned_at.isoformat(),
                "cache_age_minutes": int(cache_age.total_seconds() / 60),
                "is_valid": cache_age < timedelta(hours=self.CACHE_DURATION_HOURS),
                "scan_duration_seconds": entry.scan_duration_seconds,
            }
        return status

    def clear_cache(self, market: Optional[str] = None):
        """Clear cached results."""
        if market:
            # Clear specific market
            keys_to_remove = [k for k in self._cache if k.startswith(market.upper())]
            for key in keys_to_remove:
                del self._cache[key]
                cache_file = self.cache_dir / f"{key}.json"
                if cache_file.exists():
                    cache_file.unlink()
        else:
            # Clear all
            self._cache.clear()
            for cache_file in self.cache_dir.glob("*.json"):
                cache_file.unlink()


# Singleton instance
_scanner: Optional[FullMarketScanner] = None


def get_scanner() -> FullMarketScanner:
    """Get or create the global scanner instance."""
    global _scanner
    if _scanner is None:
        _scanner = FullMarketScanner()
    return _scanner
