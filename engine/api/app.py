"""FastAPI application for LiquidityHunter Phase 2."""

import asyncio
import json
import os
from pathlib import Path
from typing import List, Optional, Dict, Set

import numpy as np
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from engine.core.orderblock import (
    detect_orderblock,
    find_all_fvgs,
    OrderBlock,
    FVG,
    OBAgeStatus,
    calculate_confluence,
    calculate_atr,
)
from engine.strategy.volumatic_strategy import (
    calculate_volumatic_score,
    calculate_ob_age,
    is_fvg_mitigated,
    backtest_volumatic_strategy,
    VolumaticSignal,
)
from engine.core.retest_detector import detect_retest, RetestSignal
from engine.core.mtf_resampler import analyze_mtf, project_htf_zones_to_ltf, get_htf_for_ltf
from engine.indicators.williams_r import calculate_williams_r, get_wr_signal, analyze_wr_confluence
from engine.indicators.dynamic_manager import DynamicIndicatorManager, calculate_sma, calculate_rsi
from engine.indicators.bollinger_bands import calculate_bb1, calculate_bb2, calculate_rsi_with_bb, calculate_bollinger_bands
from engine.indicators.vwap import calculate_vwap
from engine.indicators.keltner import calculate_keltner_channel, calculate_ttm_squeeze
from engine.core.screener import screen_watchlist, ScreenResult
from engine.core.volume_profile import calculate_volume_profile
from engine.api.data import load_csv, load_with_refresh, OHLCVData
from engine.api.schemas import (
    AnalyzeResponse,
    ReplayResponse,
    OrderBlockSchema,
    FVGSchema,
    ValidationDetails,
    ConfluenceSchema,
    ScreenResultSchema,
    ScreenResponse,
    ScreenAllResponse,
    OHLCVBar,
    OHLCVResponse,
    WatchlistItem,
    WatchlistResponse,
    AddSymbolRequest,
    AddSymbolResponse,
    RemoveSymbolRequest,
    RemoveSymbolResponse,
    PortfolioHolding,
    PortfolioHoldingWithPnL,
    PortfolioResponse,
    AddHoldingRequest,
    AddHoldingResponse,
    UpdateHoldingRequest,
    UpdateHoldingResponse,
    RemoveHoldingRequest,
    RemoveHoldingResponse,
    VolumeProfileBin,
    VolumeProfileResponse,
    OBScreenResult,
    OBScreenResponse,
    RSIScreenResult,
    RSIScreenResponse,
    VolumaticSignalSchema,
    VolumaticBacktestResponse,
    RetestSignalSchema,
    ActiveSignalSchema,
    HTFOrderBlockSchema,
    HTFFVGSchema,
    MTFAnalyzeResponse,
    WilliamsRSignal,
    DynamicIndicatorsResponse,
    WilliamsRIndicator,
    RSIIndicator,
    IndicatorColors,
    BacktestResponse,
    BacktestMetricsSchema,
    BacktestTradeSchema,
    EquityPointSchema,
    AlertSettingsSchema,
    AlertTestResponse,
    AlertSettingsResponse,
    # KIS API schemas
    KISConfigRequest,
    KISConfigResponse,
    KISConnectionStatus,
    KISPriceResponse,
    DataSourceInfo,
    # Scanner schemas
    ScanResultSchema,
    ScanMarketRequest,
    ScanMarketResponse,
    ScanAllMarketsRequest,
    ScanAllMarketsResponse,
    ScanCacheStatusResponse,
)
from engine.data.kis_api import (
    KISClient,
    KISAPIError,
    get_kis_client,
    configure_kis_client,
)
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv
load_dotenv()

# Alpaca API configuration for US intraday data
ALPACA_API_KEY = os.getenv('ALPACA_API_KEY')
ALPACA_API_SECRET = os.getenv('ALPACA_API_SECRET')
ALPACA_DATA_URL = "https://data.alpaca.markets/v2"


def fetch_alpaca_intraday(symbol: str, timeframe: str, limit: int = 2000) -> Optional[Dict]:
    """
    Fetch US intraday data from Alpaca API.
    Returns dict with timestamps, open, high, low, close, volume arrays.
    """
    if not ALPACA_API_KEY or not ALPACA_API_SECRET:
        print("[Alpaca] API keys not configured")
        return None

    # Map timeframes to Alpaca format (CASE-SENSITIVE: 1m=minute, 1M=month)
    tf_map = {
        '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min',
        '1h': '1Hour', '1H': '1Hour', '4h': '4Hour', '4H': '4Hour'
    }
    alpaca_tf = tf_map.get(timeframe)
    if not alpaca_tf:
        print(f"[Alpaca] Unsupported timeframe: {timeframe}")
        return None

    headers = {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
    }

    # Calculate start date based on timeframe (need enough bars)
    days_back = {
        '1m': 7, '5m': 30, '15m': 60, '30m': 90,
        '1h': 180, '1H': 180, '4h': 365, '4H': 365
    }
    start_date = (datetime.utcnow() - timedelta(days=days_back.get(timeframe, 30)))
    start_str = start_date.strftime('%Y-%m-%dT00:00:00Z')

    url = f"{ALPACA_DATA_URL}/stocks/{symbol}/bars"
    params = {
        'timeframe': alpaca_tf,
        'start': start_str,
        'limit': limit,
        'feed': 'iex',  # 'iex' for free tier, 'sip' for paid
        'sort': 'asc',
    }

    try:
        print(f"[Alpaca] Fetching {symbol} {timeframe} from {start_str[:10]}")
        resp = requests.get(url, headers=headers, params=params, timeout=30)

        if resp.status_code != 200:
            print(f"[Alpaca] API error {resp.status_code}: {resp.text[:200]}")
            return None

        data = resp.json()
        bars = data.get('bars', [])

        if not bars:
            print(f"[Alpaca] No bars returned for {symbol}")
            return None

        # Convert to our format
        timestamps = []
        opens = []
        highs = []
        lows = []
        closes = []
        volumes = []

        for bar in bars:
            # Alpaca timestamp is ISO format with Z suffix
            ts_str = bar['t']
            ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            timestamps.append(int(ts.timestamp()))
            opens.append(float(bar['o']))
            highs.append(float(bar['h']))
            lows.append(float(bar['l']))
            closes.append(float(bar['c']))
            volumes.append(int(bar['v']))

        print(f"[Alpaca] Got {len(bars)} bars for {symbol} {timeframe}")
        return {
            'timestamps': timestamps,
            'open': opens,
            'high': highs,
            'low': lows,
            'close': closes,
            'volume': volumes,
            'count': len(bars),
        }

    except requests.exceptions.Timeout:
        print(f"[Alpaca] Request timeout for {symbol}")
        return None
    except Exception as e:
        print(f"[Alpaca] Error fetching {symbol}: {e}")
        return None


from engine.core.screener import ema, rsi, macd
from engine.strategy.backtest import run_backtest
from engine.screener import get_scanner


# Helper functions for AI endpoints (wrappers for consistency)
def calculate_ema(closes: np.ndarray, period: int) -> np.ndarray:
    """Calculate EMA - wrapper for ema()."""
    return ema(closes, period)


def calculate_macd(closes: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    """Calculate MACD line, signal line, and histogram."""
    return macd(closes, fast, slow, signal)  # Returns (macd_line, signal_line, histogram)


def calculate_stochastic(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                         k_period: int = 14, d_period: int = 3):
    """Calculate Stochastic %K and %D."""
    n = len(close)
    k = np.full(n, np.nan)

    for i in range(k_period - 1, n):
        highest_high = np.max(high[i - k_period + 1:i + 1])
        lowest_low = np.min(low[i - k_period + 1:i + 1])
        if highest_high == lowest_low:
            k[i] = 50.0
        else:
            k[i] = ((close[i] - lowest_low) / (highest_high - lowest_low)) * 100

    # %D is SMA of %K
    d = calculate_sma(k, d_period)
    return k, d


def adjust_prices_to_actual(data: OHLCVData, current_actual_price: float, symbol: str) -> OHLCVData:
    """
    Convert adjusted historical prices to actual prices.

    Database stores ADJUSTED prices (accounting for splits/dividends),
    but KIS API provides ACTUAL trading prices. This function aligns historical
    data with current actual prices.

    Args:
        data: OHLCVData with adjusted prices
        current_actual_price: Current actual trading price from KIS API
        symbol: Symbol name for logging

    Returns:
        OHLCVData with prices adjusted to match actual trading prices
    """
    if data is None or len(data.close) == 0:
        return data

    # Get the most recent adjusted close price
    latest_adjusted = float(data.close[-1])

    if latest_adjusted <= 0:
        return data

    # Calculate adjustment ratio
    ratio = current_actual_price / latest_adjusted

    # Only apply adjustment if significant difference (> 5%)
    if 0.95 <= ratio <= 1.05:
        print(f"[PriceAdjust] {symbol}: No adjustment needed (ratio={ratio:.4f})")
        return data

    print(f"[PriceAdjust] {symbol}: Adjusting prices by {ratio:.4f}x")
    print(f"[PriceAdjust] Before: open[0]={data.open[0]:.2f}, close[-1]={data.close[-1]:.2f}")

    # Apply ratio using in-place multiplication to ensure arrays are modified
    # Convert to float64 first to ensure proper multiplication
    data.open = np.array(data.open, dtype=np.float64) * ratio
    data.high = np.array(data.high, dtype=np.float64) * ratio
    data.low = np.array(data.low, dtype=np.float64) * ratio
    data.close = np.array(data.close, dtype=np.float64) * ratio

    print(f"[PriceAdjust] After: open[0]={data.open[0]:.2f}, close[-1]={data.close[-1]:.2f}")

    return data


def get_current_actual_price(symbol: str, market: str) -> Optional[float]:
    """
    Get current actual trading price from KIS API.

    Returns None if KIS is not configured or fails.
    """
    try:
        client = get_kis_client()
        if not client.is_configured:
            return None

        # Get real-time price from KIS using get_current_price method
        price_data = client.get_current_price(symbol, market)
        if price_data:
            # Try different field names depending on response format
            for field in ["current_price", "stck_prpr", "close", "price"]:
                if field in price_data:
                    return float(price_data[field])
    except Exception as e:
        print(f"[PriceAdjust] Failed to get current price for {symbol}: {e}")

    return None


def load_ohlcv_unified(
    symbol: str,
    market: str,
    tf: str,
    refresh: bool = False,
    limit: int = 0
) -> tuple[OHLCVData, str]:
    """
    Unified data loading function used by both /ohlcv and /analyze endpoints.

    Priority: KIS API (direct) → PostgreSQL → KIS API (fallback)

    KIS API is the PRIMARY source for accurate, real-time data.
    PostgreSQL is used as backup when KIS doesn't have enough history.
    KIS API fallback uses the data.py module for CSV caching.

    Returns:
        tuple: (OHLCVData, source_used)
    """
    market = market.upper()
    data = None
    source_used = "kis"
    needs_price_adjustment = False

    # Minimum bars needed for EMA200 to have valid data
    MIN_BARS_FOR_EMA200 = 250

    # CASE-SENSITIVE: 1m=minute, 1M=month - do NOT use .lower() or .upper()
    is_daily_tf = tf in ("1D", "1d", "1W", "1w", "1M", "1MO", "1mo")
    is_intraday = tf in ("1m", "5m", "15m", "30m", "1h", "1H", "4h", "4H")

    # ========================================
    # PRIORITY 0: ALPACA for US INTRADAY (much more data than KIS)
    # ========================================
    if market == "US" and is_intraday:
        try:
            alpaca_data = fetch_alpaca_intraday(symbol, tf, limit=limit if limit > 0 else 2000)
            if alpaca_data and alpaca_data.get('count', 0) > 0:
                data = OHLCVData(
                    timestamps=alpaca_data["timestamps"],
                    open=np.array(alpaca_data["open"]),
                    high=np.array(alpaca_data["high"]),
                    low=np.array(alpaca_data["low"]),
                    close=np.array(alpaca_data["close"]),
                    volume=np.array(alpaca_data["volume"]),
                )
                source_used = "alpaca"
                print(f"[OHLCV] Alpaca returned {len(data.close)} bars for {symbol} {tf}")
                # Skip KIS for US intraday if Alpaca succeeded
                return data, source_used
        except Exception as e:
            print(f"[OHLCV] Alpaca error: {e}, falling back to KIS")

    # ========================================
    # PRIORITY 1: KIS API DIRECT (most accurate, real-time)
    # ========================================
    try:
        client = get_kis_client()
        if client.is_configured:
            print(f"[OHLCV] Trying KIS API DIRECT for {symbol} {market} {tf}")

            # Use direct chart methods for daily data (bypass old pipeline)
            if is_daily_tf and tf in ("1D", "1d"):
                if market == "KR":
                    kis_result = client.get_daily_chart(symbol, count=500)
                else:
                    kis_result = client.get_daily_chart_us(symbol, count=500)

                bars = kis_result.get("bars", [])
                if bars and len(bars) > 0:
                    # Convert bars array to OHLCVData format
                    timestamps = [bar["time"] for bar in bars]
                    opens = np.array([bar["open"] for bar in bars])
                    highs = np.array([bar["high"] for bar in bars])
                    lows = np.array([bar["low"] for bar in bars])
                    closes = np.array([bar["close"] for bar in bars])
                    volumes = np.array([bar["volume"] for bar in bars])

                    data = OHLCVData(
                        timestamps=timestamps,
                        open=opens,
                        high=highs,
                        low=lows,
                        close=closes,
                        volume=volumes,
                    )
                    source_used = "kis_direct"
                    needs_price_adjustment = False
                    print(f"[OHLCV] KIS DIRECT returned {len(bars)} bars for {symbol}")
            else:
                # For other timeframes, use existing get_ohlcv method
                kis_data = client.get_ohlcv(symbol, market, tf, count=limit if limit > 0 else 500)
                kis_bar_count = kis_data.get("count", 0) if kis_data else 0
                print(f"[OHLCV] KIS returned {kis_bar_count} bars for {symbol} {tf}")

                if kis_data and kis_bar_count > 0:
                    data = OHLCVData(
                        timestamps=kis_data["timestamps"],
                        open=np.array(kis_data["open"]),
                        high=np.array(kis_data["high"]),
                        low=np.array(kis_data["low"]),
                        close=np.array(kis_data["close"]),
                        volume=np.array(kis_data["volume"]),
                    )
                    source_used = "kis"
                    needs_price_adjustment = False
    except KISAPIError as e:
        print(f"[OHLCV] KIS API error: {e}, trying PostgreSQL")
    except Exception as e:
        print(f"[OHLCV] KIS error: {e}, trying PostgreSQL")

    # ========================================
    # PRIORITY 2: Merge KIS (recent) + PostgreSQL (older history)
    # ========================================
    # KIS only returns ~30 bars. For EMA200 we need 250+.
    # Solution: Use PostgreSQL for older history, but REPLACE recent bars with KIS data
    kis_recent_data = data  # Save KIS data if we got any
    kis_bar_count = len(data.close) if data is not None else 0

    if kis_bar_count < MIN_BARS_FOR_EMA200:
        if is_daily_tf and not refresh:
            try:
                from engine.data.database import get_ohlcv as db_get_ohlcv, check_connection
                if check_connection():
                    print(f"[OHLCV] Getting PostgreSQL history to merge with KIS {symbol} {market}")
                    df = db_get_ohlcv(symbol.upper(), market)
                    if not df.empty and len(df) >= MIN_BARS_FOR_EMA200:
                        market_tz = 'Asia/Seoul' if market == 'KR' else 'America/New_York'
                        pg_timestamps = [ts.tz_convert(market_tz).strftime("%Y-%m-%d") if ts.tzinfo else ts.strftime("%Y-%m-%d") for ts in df.index]

                        # If we have KIS data, merge it (KIS takes priority for overlapping dates)
                        if kis_recent_data is not None and kis_bar_count > 0:
                            kis_dates = set(kis_recent_data.timestamps)

                            # Filter out PostgreSQL data that overlaps with KIS
                            merged_timestamps = []
                            merged_open = []
                            merged_high = []
                            merged_low = []
                            merged_close = []
                            merged_volume = []

                            # Add older PostgreSQL data (not in KIS)
                            for i, ts in enumerate(pg_timestamps):
                                if ts not in kis_dates:
                                    merged_timestamps.append(ts)
                                    merged_open.append(df["open"].values[i])
                                    merged_high.append(df["high"].values[i])
                                    merged_low.append(df["low"].values[i])
                                    merged_close.append(df["close"].values[i])
                                    merged_volume.append(df["volume"].values[i])

                            # Add all KIS data (most recent, accurate)
                            merged_timestamps.extend(kis_recent_data.timestamps)
                            merged_open.extend(kis_recent_data.open.tolist())
                            merged_high.extend(kis_recent_data.high.tolist())
                            merged_low.extend(kis_recent_data.low.tolist())
                            merged_close.extend(kis_recent_data.close.tolist())
                            merged_volume.extend(kis_recent_data.volume.tolist())

                            # Sort by date
                            sorted_indices = sorted(range(len(merged_timestamps)), key=lambda i: merged_timestamps[i])
                            data = OHLCVData(
                                timestamps=[merged_timestamps[i] for i in sorted_indices],
                                open=np.array([merged_open[i] for i in sorted_indices]),
                                high=np.array([merged_high[i] for i in sorted_indices]),
                                low=np.array([merged_low[i] for i in sorted_indices]),
                                close=np.array([merged_close[i] for i in sorted_indices]),
                                volume=np.array([merged_volume[i] for i in sorted_indices]),
                            )
                            source_used = "kis_direct+postgresql"
                            needs_price_adjustment = False  # KIS data is already actual prices
                            print(f"[OHLCV] Merged {kis_bar_count} KIS + {len(df) - kis_bar_count} PostgreSQL = {len(data.close)} bars")
                        else:
                            # No KIS data, use PostgreSQL only
                            data = OHLCVData(
                                timestamps=pg_timestamps,
                                open=df["open"].values,
                                high=df["high"].values,
                                low=df["low"].values,
                                close=df["close"].values,
                                volume=df["volume"].values,
                            )
                            source_used = "postgresql"
                            needs_price_adjustment = True
                            print(f"[OHLCV] PostgreSQL returned {len(df)} bars for {symbol}")
            except Exception as e:
                print(f"[OHLCV] PostgreSQL error: {e}")

    # ========================================
    # PRIORITY 3: yfinance for US stocks (2+ years of history, free)
    # ========================================
    if market == "US" and is_daily_tf and (data is None or len(data.close) < MIN_BARS_FOR_EMA200):
        try:
            import yfinance as yf
            from datetime import datetime, timedelta

            print(f"[OHLCV] Trying yfinance for US stock {symbol}")

            # Fetch 2 years of daily bars
            end_date = datetime.now()
            start_date = end_date - timedelta(days=730)  # 2 years

            ticker = yf.Ticker(symbol)
            df = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"))

            if not df.empty and len(df) >= MIN_BARS_FOR_EMA200:
                # Convert to our format
                timestamps = [ts.strftime("%Y-%m-%d") for ts in df.index]
                opens = df["Open"].values
                highs = df["High"].values
                lows = df["Low"].values
                closes = df["Close"].values
                volumes = df["Volume"].values

                # Merge with KIS data if available (KIS has latest data)
                if kis_recent_data is not None and kis_bar_count > 0:
                    kis_dates = set(kis_recent_data.timestamps)

                    # Filter out yfinance data that overlaps with KIS
                    merged_timestamps = []
                    merged_open = []
                    merged_high = []
                    merged_low = []
                    merged_close = []
                    merged_volume = []

                    for i, ts in enumerate(timestamps):
                        if ts not in kis_dates:
                            merged_timestamps.append(ts)
                            merged_open.append(opens[i])
                            merged_high.append(highs[i])
                            merged_low.append(lows[i])
                            merged_close.append(closes[i])
                            merged_volume.append(volumes[i])

                    # Add KIS data (most recent)
                    merged_timestamps.extend(kis_recent_data.timestamps)
                    merged_open.extend(kis_recent_data.open.tolist())
                    merged_high.extend(kis_recent_data.high.tolist())
                    merged_low.extend(kis_recent_data.low.tolist())
                    merged_close.extend(kis_recent_data.close.tolist())
                    merged_volume.extend(kis_recent_data.volume.tolist())

                    # Sort by date
                    sorted_indices = sorted(range(len(merged_timestamps)), key=lambda i: merged_timestamps[i])
                    data = OHLCVData(
                        timestamps=[merged_timestamps[i] for i in sorted_indices],
                        open=np.array([merged_open[i] for i in sorted_indices]),
                        high=np.array([merged_high[i] for i in sorted_indices]),
                        low=np.array([merged_low[i] for i in sorted_indices]),
                        close=np.array([merged_close[i] for i in sorted_indices]),
                        volume=np.array([merged_volume[i] for i in sorted_indices]),
                    )
                    source_used = "yfinance+kis"
                    print(f"[OHLCV] Merged yfinance ({len(df)}) + KIS ({kis_bar_count}) = {len(data.close)} bars")
                else:
                    data = OHLCVData(
                        timestamps=timestamps,
                        open=opens,
                        high=highs,
                        low=lows,
                        close=closes,
                        volume=volumes,
                    )
                    source_used = "yfinance"
                    print(f"[OHLCV] yfinance returned {len(df)} bars for {symbol}")
                needs_price_adjustment = False
            else:
                print(f"[OHLCV] yfinance returned insufficient data: {len(df)} bars")
        except Exception as e:
            print(f"[OHLCV] yfinance error: {e}")

    # ========================================
    # PRIORITY 4: yfinance for US INTRADAY stocks
    # ALWAYS use yfinance for US intraday - KIS doesn't support US minute data
    # ========================================
    # CASE-SENSITIVE: 1m=minute, 1M=month
    is_intraday_tf = tf in ("1m", "5m", "15m", "30m", "1h", "1H", "4h", "4H")
    if market == "US" and is_intraday_tf:
        try:
            import yfinance as yf
            from datetime import datetime, timedelta

            # Map timeframe to yfinance interval (case-sensitive)
            yf_interval_map = {
                "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
                "1h": "1h", "1H": "1h", "4h": "1h", "4H": "1h"
            }
            yf_interval = yf_interval_map.get(tf, "5m")

            # yfinance intraday limits: 1m=7days, 5m+=60days
            days_back = 7 if tf == "1m" else 60

            print(f"[OHLCV] Trying yfinance INTRADAY for US stock {symbol} {tf}")

            end_date = datetime.now()
            start_date = end_date - timedelta(days=days_back)

            ticker = yf.Ticker(symbol)
            df = ticker.history(
                start=start_date.strftime("%Y-%m-%d"),
                end=end_date.strftime("%Y-%m-%d"),
                interval=yf_interval
            )

            if not df.empty:
                # Convert to Unix timestamps (seconds) for intraday
                timestamps = [int(ts.timestamp()) for ts in df.index]
                opens = df["Open"].values
                highs = df["High"].values
                lows = df["Low"].values
                closes = df["Close"].values
                volumes = df["Volume"].values

                data = OHLCVData(
                    timestamps=timestamps,
                    open=opens,
                    high=highs,
                    low=lows,
                    close=closes,
                    volume=volumes,
                )
                source_used = "yfinance_intraday"
                needs_price_adjustment = False
                print(f"[OHLCV] yfinance INTRADAY returned {len(df)} bars for {symbol} {tf}")
            else:
                print(f"[OHLCV] yfinance INTRADAY returned no data for {symbol} {tf}")
        except Exception as e:
            print(f"[OHLCV] yfinance INTRADAY error: {e}")

    # Fall back to KIS API via data.py if other sources failed or returned insufficient data
    if data is None:
        print(f"[OHLCV] Loading from KIS API for {symbol} {market} {tf}")
        data = load_with_refresh(symbol, market, tf, data_dir="data", force_refresh=refresh)
        source_used = "kis"
        needs_price_adjustment = True  # KIS uses adjusted prices
        print(f"[OHLCV] KIS API returned {len(data.close)} bars")

    # CRITICAL: Adjust historical prices to match actual trading prices
    if needs_price_adjustment and data is not None:
        current_price = get_current_actual_price(symbol, market)
        if current_price is not None:
            data = adjust_prices_to_actual(data, current_price, symbol)
        else:
            print(f"[PriceAdjust] {symbol}: Could not get current price, using adjusted prices")

    return data, source_used


app = FastAPI(
    title="LiquidityHunter",
    description="Phase 2: Order Block Detection API",
    version="0.1.0",
)

# Add CORS middleware for frontend development and ngrok access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_origin_regex=r"https://.*\.ngrok\.io|https://.*\.ngrok-free\.app|https://.*\.ngrok\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ob_to_schema(
    ob: OrderBlock,
    current_index: int = 0,
    high: Optional[np.ndarray] = None,
    low: Optional[np.ndarray] = None,
    close: Optional[np.ndarray] = None,
    volume: Optional[np.ndarray] = None,
    current_price: float = 0.0,
    current_volume: float = 0.0,
) -> OrderBlockSchema:
    """Convert OrderBlock dataclass to Pydantic schema with volumatic analysis and retest detection."""
    fvg_schema = None
    if ob.fvg is not None:
        fvg_schema = FVGSchema(
            index=ob.fvg.index,
            direction=ob.fvg.direction.value,
            gap_high=ob.fvg.gap_high,
            gap_low=ob.fvg.gap_low,
        )

    # Calculate volumatic fields
    age_candles = 0
    age_status = "fresh"
    fvg_fresh = False
    volumatic_score = 0

    if current_index > 0:
        age_candles, age_status_enum = calculate_ob_age(ob, current_index)
        age_status = age_status_enum.value

        # Check FVG freshness
        if ob.fvg is not None and high is not None and low is not None:
            mitigated, _ = is_fvg_mitigated(ob.fvg, high, low, ob.fvg.index, current_index)
            fvg_fresh = not mitigated

        # Calculate volumatic score
        if high is not None and low is not None:
            volumatic_score = calculate_volumatic_score(
                ob, ob.fvg if fvg_fresh else None, current_index, high, low
            )

    # Detect retest signal
    retest_signal_schema = None
    if high is not None and low is not None and close is not None and current_price > 0:
        retest_result = detect_retest(
            ob=ob,
            current_price=current_price,
            current_volume=current_volume,
            high=high,
            low=low,
            close=close,
            volume=volume,
            volumatic_score=volumatic_score,
        )
        if retest_result.retest_active:
            retest_signal_schema = RetestSignalSchema(
                retest_active=True,
                direction=retest_result.direction,
                distance_pct=retest_result.distance_pct,
                volume_confirm=retest_result.volume_confirm,
                entry_price=retest_result.entry_price,
                ob_strength=retest_result.ob_strength,
                signal_type=retest_result.signal_type,
            )

    return OrderBlockSchema(
        index=ob.index,
        direction=ob.direction.value,
        zone_top=float(ob.zone_top),
        zone_bottom=float(ob.zone_bottom),
        displacement_index=ob.displacement_index,
        has_fvg=ob.has_fvg,
        fvg=fvg_schema,
        volume_strength=ob.volume_strength.value,
        volume_ratio=round(ob.volume_ratio, 2),
        age_candles=age_candles,
        age_status=age_status,
        fvg_fresh=fvg_fresh,
        volumatic_score=volumatic_score,
        retest_signal=retest_signal_schema,
    )


def _fvg_to_schema(fvg: FVG) -> FVGSchema:
    """Convert FVG dataclass to Pydantic schema."""
    return FVGSchema(
        index=fvg.index,
        direction=fvg.direction.value,
        gap_high=fvg.gap_high,
        gap_low=fvg.gap_low,
    )


def analyze_at_bar(data: OHLCVData, bar_index: int, filter_weak: bool = False) -> AnalyzeResponse:
    """
    Analyze order block and FVGs at a specific bar index.

    This is the core analysis function used by both /analyze and /replay.

    Args:
        data: OHLCV data
        bar_index: Bar index to analyze up to (inclusive)
        filter_weak: If True, exclude weak volume OBs

    Returns:
        AnalyzeResponse with analysis results
    """
    if bar_index < 0 or bar_index >= len(data.close):
        raise ValueError(f"bar_index {bar_index} out of range [0, {len(data.close) - 1}]")

    # Slice data up to and including bar_index
    end = bar_index + 1
    open_ = data.open[:end]
    high = data.high[:end]
    low = data.low[:end]
    close = data.close[:end]
    volume = data.volume[:end] if data.volume is not None else None

    current_price = float(close[-1])
    current_volume = float(volume[-1]) if volume is not None and len(volume) > 0 else 0.0

    # Detect order block with volume analysis
    ob, filtered_weak_count = detect_orderblock(
        open_, high, low, close,
        volume=volume,
        filter_weak=filter_weak,
    )

    # Detect FVGs independently
    fvgs = find_all_fvgs(open_, high, low, close, fresh_only=True)
    fvg_schemas = [_fvg_to_schema(fvg) for fvg in fvgs]

    # Calculate ATR for confluence scoring
    atr_value = calculate_atr(high, low, close, period=14)

    # Get most recent FVG for confluence calculation
    most_recent_fvg = fvgs[-1] if fvgs else None

    # Calculate confluence score
    confluence_result = calculate_confluence(ob, most_recent_fvg, current_price, atr_value)
    confluence_schema = ConfluenceSchema(
        has_confluence=confluence_result.has_confluence,
        score=confluence_result.score,
        ob_score=confluence_result.ob_score,
        fvg_score=confluence_result.fvg_score,
        overlap_bonus=confluence_result.overlap_bonus,
        proximity_bonus=confluence_result.proximity_bonus,
        reason=confluence_result.reason,
        details=confluence_result.details,
    )

    # Calculate Williams %R signal
    williams_r_signal = None
    if len(high) >= 14:
        wr_values = calculate_williams_r(high, low, close, 14)
        wr_signal = get_wr_signal(wr_values)
        ob_direction = ob.direction.value if ob else None
        ob_bonus = 0
        if ob_direction:
            from engine.indicators.williams_r import calculate_wr_bonus
            ob_bonus = calculate_wr_bonus(wr_signal, ob_direction)

        # Build summary
        summary_parts = []
        zone_name = wr_signal.zone.value
        if "extreme" in zone_name:
            summary_parts.append(zone_name.upper().replace("_", " "))
        elif zone_name in ("overbought", "oversold"):
            summary_parts.append(zone_name.upper())
        if wr_signal.divergence:
            summary_parts.append(f"{wr_signal.divergence.upper()} DIV")
        if wr_signal.cross_direction:
            summary_parts.append(f"Cross {wr_signal.cross_direction.upper()}")

        williams_r_signal = WilliamsRSignal(
            value=round(wr_signal.value, 2),
            zone=wr_signal.zone.value,
            signal=wr_signal.signal,
            strength=round(wr_signal.strength, 2),
            divergence=wr_signal.divergence,
            cross_direction=wr_signal.cross_direction,
            ob_bonus=ob_bonus,
            summary=" | ".join(summary_parts) if summary_parts else "Neutral",
        )

    if ob is None:
        return AnalyzeResponse(
            bar_index=bar_index,
            current_price=current_price,
            current_valid_ob=None,
            fvgs=fvg_schemas,
            validation_details=ValidationDetails(
                has_displacement=False,
                has_fvg=len(fvgs) > 0,
                is_fresh=False,
            ),
            reason_code="NO_VALID_OB",
            confluence=confluence_schema,
            atr=atr_value,
            filtered_weak_obs=filtered_weak_count,
            signals=[],
            williams_r=williams_r_signal,
        )

    # Convert OB to schema with retest detection
    ob_schema = _ob_to_schema(
        ob=ob,
        current_index=bar_index,
        high=high,
        low=low,
        close=close,
        volume=volume,
        current_price=current_price,
        current_volume=current_volume,
    )

    # Collect active signals
    active_signals: List[ActiveSignalSchema] = []
    if ob_schema.retest_signal and ob_schema.retest_signal.retest_active:
        retest = ob_schema.retest_signal
        active_signals.append(ActiveSignalSchema(
            type=retest.signal_type,
            price=retest.entry_price,
            ob_strength=retest.ob_strength,
            volume_confirm=retest.volume_confirm,
            direction=retest.direction,
        ))

    return AnalyzeResponse(
        bar_index=bar_index,
        current_price=current_price,
        current_valid_ob=ob_schema,
        fvgs=fvg_schemas,
        validation_details=ValidationDetails(
            has_displacement=True,
            has_fvg=len(fvgs) > 0,
            is_fresh=True,  # If OB is returned, it passed freshness check
        ),
        reason_code="OK",
        confluence=confluence_schema,
        atr=atr_value,
        filtered_weak_obs=filtered_weak_count,
        signals=active_signals,
        williams_r=williams_r_signal,
    )


@app.get("/analyze", response_model=AnalyzeResponse)
def analyze(
    symbol: str = Query(..., description="Symbol name"),
    tf: str = Query(..., description="Timeframe"),
    bar_index: int = Query(..., description="Bar index to analyze"),
    market: str = Query("", description="Market (KR/US) for data directory"),
    filter_weak: bool = Query(False, description="Filter out weak volume OBs"),
) -> AnalyzeResponse:
    """
    Analyze order block at a specific bar index.

    Returns the current valid order block (if any) and validation details.
    Set filter_weak=true to exclude OBs with weak volume (< 0.8x avg volume).
    """
    # Use SAME unified data loading as OHLCV endpoint (KIS API → PostgreSQL → KIS fallback)
    market = market.upper() if market else "US"
    try:
        data, source = load_ohlcv_unified(symbol, market, tf, refresh=False)
        print(f"[Analyze] Using {source} data for {symbol} {market} {tf}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Apply same limits as OHLCV endpoint to ensure consistency
    default_limits = {
        "1m": 2000, "5m": 2000, "15m": 2000, "30m": 2000,
        "1h": 2000, "1H": 2000, "4h": 2000, "4H": 2000,
        "1D": 1500, "1d": 1500, "1W": 0, "1w": 0, "1M": 0, "1mo": 0,
    }
    max_bars = default_limits.get(tf, 1000)
    total_bars = len(data.close)
    if max_bars > 0 and total_bars > max_bars:
        start_idx = total_bars - max_bars
        data.timestamps = data.timestamps[start_idx:]
        data.open = data.open[start_idx:]
        data.high = data.high[start_idx:]
        data.low = data.low[start_idx:]
        data.close = data.close[start_idx:]
        data.volume = data.volume[start_idx:]

    try:
        return analyze_at_bar(data, bar_index, filter_weak=filter_weak)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/replay", response_model=ReplayResponse)
def replay(
    symbol: str = Query(..., description="Symbol name"),
    tf: str = Query(..., description="Timeframe"),
) -> ReplayResponse:
    """
    Replay analysis for all bars.

    Returns an array of frames, one for each bar index.
    """
    try:
        data = load_csv(symbol, tf)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    frames: List[AnalyzeResponse] = []
    for bar_index in range(len(data.close)):
        frame = analyze_at_bar(data, bar_index)
        frames.append(frame)

    return ReplayResponse(frames=frames)


# --- Screener endpoints (Phase 2.5) ---

DATA_DIR = Path("data")


def _load_watchlist(filename: str) -> List[str]:
    """Load watchlist from file."""
    filepath = DATA_DIR / filename
    if not filepath.exists():
        return []
    with open(filepath, "r") as f:
        return [line.strip() for line in f if line.strip()]


def _get_closes_for_symbol(symbol: str, market: str, tf: str = "1D") -> Optional[np.ndarray]:
    """Get closes array for a symbol. Returns None if not available."""
    try:
        data_dir = f"data/{market.lower()}"
        data = load_csv(symbol, tf, data_dir=data_dir)
        return data.close
    except FileNotFoundError:
        return None


def _result_to_schema(r: ScreenResult) -> ScreenResultSchema:
    """Convert ScreenResult to Pydantic schema."""
    return ScreenResultSchema(
        symbol=r.symbol,
        market=r.market,
        last_close=r.last_close,
        ema20=r.ema20,
        ema200=r.ema200,
        gap=r.gap,
        slope_diff=r.slope_diff,
        days_to_cross=r.days_to_cross,
        score=r.score,
        reason=r.reason,
    )


@app.get("/screen", response_model=ScreenResponse)
def screen(
    market: str = Query(..., description="Market: KR or US"),
    top_n: int = Query(20, description="Max candidates to return"),
) -> ScreenResponse:
    """
    Screen a single market for EMA cross candidates.

    Returns top N candidates sorted by score desc, then days asc.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    watchlist_file = f"{market.lower()}_watchlist.txt"
    symbols = _load_watchlist(watchlist_file)

    def get_closes(symbol: str) -> Optional[np.ndarray]:
        return _get_closes_for_symbol(symbol, market)

    results = screen_watchlist(symbols, market, get_closes, top_n=top_n)
    candidates = [_result_to_schema(r) for r in results]

    return ScreenResponse(market=market, candidates=candidates)


@app.get("/screen_all", response_model=ScreenAllResponse)
def screen_all(
    top_n: int = Query(20, description="Max candidates per market"),
) -> ScreenAllResponse:
    """
    Screen both KR and US markets.

    Returns top N candidates for each market.
    """
    kr_symbols = _load_watchlist("kr_watchlist.txt")
    us_symbols = _load_watchlist("us_watchlist.txt")

    def get_kr_closes(symbol: str) -> Optional[np.ndarray]:
        return _get_closes_for_symbol(symbol, "KR")

    def get_us_closes(symbol: str) -> Optional[np.ndarray]:
        return _get_closes_for_symbol(symbol, "US")

    kr_results = screen_watchlist(kr_symbols, "KR", get_kr_closes, top_n=top_n)
    us_results = screen_watchlist(us_symbols, "US", get_us_closes, top_n=top_n)

    return ScreenAllResponse(
        kr_candidates=[_result_to_schema(r) for r in kr_results],
        us_candidates=[_result_to_schema(r) for r in us_results],
    )


# --- OB Screener endpoint ---

def _get_ohlcv_for_symbol(symbol: str, market: str, tf: str = "1D") -> Optional[OHLCVData]:
    """Get full OHLCV data for a symbol. Returns None if not available."""
    try:
        data_dir = f"data/{market.lower()}"
        return load_csv(symbol, tf, data_dir=data_dir)
    except FileNotFoundError:
        return None


def _screen_ob_symbol(symbol: str, market: str) -> Optional[OBScreenResult]:
    """Screen a single symbol for Order Block."""
    data = _get_ohlcv_for_symbol(symbol, market)
    if data is None or len(data.close) < 50:
        return None

    ob = detect_orderblock(data.open, data.high, data.low, data.close)
    if ob is None:
        return None

    current_price = float(data.close[-1])
    zone_center = (ob.zone_top + ob.zone_bottom) / 2
    distance_percent = abs(current_price - zone_center) / current_price * 100

    return OBScreenResult(
        symbol=symbol,
        market=market,
        direction=ob.direction.value,
        zone_top=float(ob.zone_top),
        zone_bottom=float(ob.zone_bottom),
        current_price=current_price,
        distance_percent=round(distance_percent, 2),
        has_fvg=ob.has_fvg,
    )


@app.get("/screen/ob", response_model=OBScreenResponse)
def screen_ob(
    top_n: int = Query(20, description="Max candidates per market"),
) -> OBScreenResponse:
    """
    Screen both markets for stocks with valid Order Blocks.

    Returns stocks that have a fresh, untouched OB zone.
    """
    kr_symbols = _load_watchlist("kr_watchlist.txt")
    us_symbols = _load_watchlist("us_watchlist.txt")

    kr_results: List[OBScreenResult] = []
    us_results: List[OBScreenResult] = []

    for symbol in kr_symbols:
        result = _screen_ob_symbol(symbol, "KR")
        if result:
            kr_results.append(result)

    for symbol in us_symbols:
        result = _screen_ob_symbol(symbol, "US")
        if result:
            us_results.append(result)

    # Sort by distance_percent (closer = better)
    kr_results.sort(key=lambda r: r.distance_percent)
    us_results.sort(key=lambda r: r.distance_percent)

    return OBScreenResponse(
        kr_candidates=kr_results[:top_n],
        us_candidates=us_results[:top_n],
    )


# --- RSI Screener endpoint ---

def _screen_rsi_symbol(symbol: str, market: str) -> Optional[RSIScreenResult]:
    """Screen a single symbol for RSI extreme."""
    closes = _get_closes_for_symbol(symbol, market)
    if closes is None or len(closes) < 20:
        return None

    rsi_values = rsi(closes, 14)
    current_rsi = rsi_values[-1]

    if np.isnan(current_rsi):
        return None

    # Only return if overbought (>70) or oversold (<30)
    if current_rsi > 70:
        signal = "overbought"
    elif current_rsi < 30:
        signal = "oversold"
    else:
        return None

    return RSIScreenResult(
        symbol=symbol,
        market=market,
        rsi_value=round(float(current_rsi), 1),
        signal=signal,
        current_price=float(closes[-1]),
    )


@app.get("/screen/rsi", response_model=RSIScreenResponse)
def screen_rsi(
    top_n: int = Query(20, description="Max candidates per market"),
) -> RSIScreenResponse:
    """
    Screen both markets for RSI extreme conditions.

    Returns stocks that are overbought (RSI > 70) or oversold (RSI < 30).
    """
    kr_symbols = _load_watchlist("kr_watchlist.txt")
    us_symbols = _load_watchlist("us_watchlist.txt")

    kr_results: List[RSIScreenResult] = []
    us_results: List[RSIScreenResult] = []

    for symbol in kr_symbols:
        result = _screen_rsi_symbol(symbol, "KR")
        if result:
            kr_results.append(result)

    for symbol in us_symbols:
        result = _screen_rsi_symbol(symbol, "US")
        if result:
            us_results.append(result)

    # Sort by RSI extremity (most extreme first)
    # For overbought: higher RSI first. For oversold: lower RSI first.
    # Use distance from 50 as the sort key
    kr_results.sort(key=lambda r: abs(r.rsi_value - 50), reverse=True)
    us_results.sort(key=lambda r: abs(r.rsi_value - 50), reverse=True)

    return RSIScreenResponse(
        kr_candidates=kr_results[:top_n],
        us_candidates=us_results[:top_n],
    )


# --- OHLCV endpoint (Phase 3.2) ---

@app.get("/ohlcv", response_model=OHLCVResponse)
def get_ohlcv(
    symbol: str = Query(..., description="Symbol name"),
    market: str = Query("KR", description="Market: KR or US"),
    tf: str = Query("1D", description="Timeframe: 1m, 5m, 15m, 1h, 1D, 1W, 1M"),
    refresh: bool = Query(False, description="Force refresh from KIS API"),
    limit: int = Query(0, description="Max bars to return (0=auto based on timeframe)"),
) -> OHLCVResponse:
    """
    Get OHLCV data with indicators for charting.

    Supports all timeframes: 1m, 5m, 15m, 1h, 1D, 1W, 1M

    Data source selection (automatic):
    - KIS API: PRIMARY source for real-time data (KR and US markets)
    - PostgreSQL: Used as SECONDARY for daily data (cached local data)
    - KIS API fallback: Used if primary sources fail (via data.py module)

    DYNAMIC SYMBOL SUPPORT:
    - Auto-tracks viewed symbols
    - Auto-adds new symbols to data collection
    - Supports unlimited stocks

    Returns bars array with dates and indicator values.
    The 'source' field in response indicates which data source was used.
    """
    market = market.upper()
    symbol = symbol.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    # DYNAMIC SYMBOL TRACKING: Track this view and auto-add if new
    try:
        from engine.data.symbol_manager import get_symbol_manager
        symbol_manager = get_symbol_manager()
        symbol_manager.track_view(symbol, market)
        # Auto-add if symbol doesn't exist (runs in background-ish, fast check)
        if not symbol_manager.symbol_exists(symbol, market):
            # This will fetch historical data for new symbols
            symbol_manager.add_symbol(symbol, market)
    except Exception as e:
        # Don't fail the request if tracking fails
        import logging
        logging.debug(f"Symbol tracking error: {e}")

    # Use unified data loading function (same as /analyze endpoint)
    is_intraday_tf = tf in ("1m", "5m", "15m", "30m", "1h", "1H", "4h", "4H")
    try:
        data, source_used = load_ohlcv_unified(symbol, market, tf, refresh=refresh, limit=limit)
    except FileNotFoundError as e:
        # For intraday timeframes, return empty response instead of 404
        # This allows frontend to gracefully fall back to daily timeframe
        if is_intraday_tf:
            return OHLCVResponse(
                symbol=symbol,
                market=market,
                timeframe=tf,
                bars=[],
                ema20=[],
                ema200=[],
                sma20=[],
                sma200=[],
                rsi=[],
                rsi_signal=[],
                macd_line=[],
                macd_signal=[],
                macd_histogram=[],
                source="unavailable",
            )
        raise HTTPException(status_code=404, detail=str(e))

    # Apply default limits based on timeframe to prevent browser crashes
    default_limits = {
        "1m": 2000,   # ~5 days of trading
        "5m": 2000,   # ~25 days
        "15m": 2000,  # ~2 months
        "30m": 2000,  # ~4 months
        "1h": 2000,   # ~6 months
        "1H": 2000,
        "4h": 2000,   # ~1 year
        "4H": 2000,
        "1D": 1500,  # ~6 years
        "1d": 1500,
        "1W": 0,     # No limit for weekly
        "1w": 0,
        "1M": 0,     # No limit for monthly
        "1mo": 0,
    }

    max_bars = limit if limit > 0 else default_limits.get(tf, 1000)

    # Slice data to most recent bars if limit applies
    total_bars = len(data.close)
    if max_bars > 0 and total_bars > max_bars:
        start_idx = total_bars - max_bars
        data.timestamps = data.timestamps[start_idx:]
        data.open = data.open[start_idx:]
        data.high = data.high[start_idx:]
        data.low = data.low[start_idx:]
        data.close = data.close[start_idx:]
        data.volume = data.volume[start_idx:]

    # Build bars list
    # Convert ALL time values to Unix timestamp (seconds) for frontend consistency
    from datetime import datetime as dt_module
    bars = []
    for i in range(len(data.close)):
        time_val = data.timestamps[i]

        # Convert to Unix timestamp if not already an int
        if isinstance(time_val, str):
            try:
                if " " in time_val:
                    # Datetime format: "YYYY-MM-DD HH:MM:SS"
                    parsed = dt_module.strptime(time_val, "%Y-%m-%d %H:%M:%S")
                else:
                    # Date-only format: "YYYY-MM-DD" - treat as noon UTC
                    parsed = dt_module.strptime(time_val, "%Y-%m-%d")
                time_val = int(parsed.timestamp())
            except ValueError:
                pass  # Keep original if parsing fails
        elif isinstance(time_val, (int, float)):
            time_val = int(time_val)

        bars.append(OHLCVBar(
            time=time_val,
            open=float(data.open[i]),
            high=float(data.high[i]),
            low=float(data.low[i]),
            close=float(data.close[i]),
            volume=float(data.volume[i]) if data.volume is not None else 0,
        ))

    # Calculate EMAs
    ema20_values = ema(data.close, 20)
    ema200_values = ema(data.close, 200)

    # Calculate RSI
    rsi_values = rsi(data.close, 14)

    # Calculate MACD
    macd_line_values, macd_signal_values, macd_histogram_values = macd(data.close, 12, 26, 9)

    # Stochastic calculation function with full parameters
    def stochastic(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                   fastk_period: int, slowk_period: int, slowd_period: int) -> tuple:
        """
        Calculate Stochastic Oscillator with smoothing.

        Args:
            fastk_period: %K lookback period (e.g., 20, 10, 5)
            slowk_period: %K smoothing period (e.g., 12, 6, 3)
            slowd_period: %D smoothing period (e.g., 12, 6, 3)

        Returns:
            (slow_k, slow_d) arrays
        """
        n = len(close)

        # Fast %K (raw stochastic)
        fast_k = np.full(n, np.nan)
        for i in range(fastk_period - 1, n):
            period_high = np.max(high[i - fastk_period + 1:i + 1])
            period_low = np.min(low[i - fastk_period + 1:i + 1])
            if period_high != period_low:
                fast_k[i] = 100 * (close[i] - period_low) / (period_high - period_low)
            else:
                fast_k[i] = 50

        # Slow %K = SMA of Fast %K
        slow_k = np.full(n, np.nan)
        for i in range(fastk_period - 1 + slowk_period - 1, n):
            window = fast_k[i - slowk_period + 1:i + 1]
            valid = window[~np.isnan(window)]
            if len(valid) == slowk_period:
                slow_k[i] = np.mean(valid)

        # Slow %D = SMA of Slow %K
        slow_d = np.full(n, np.nan)
        for i in range(fastk_period - 1 + slowk_period - 1 + slowd_period - 1, n):
            window = slow_k[i - slowd_period + 1:i + 1]
            valid = window[~np.isnan(window)]
            if len(valid) == slowd_period:
                slow_d[i] = np.mean(valid)

        return slow_k, slow_d

    # Calculate 3 Stochastic indicators
    # Stoch Slow (20, 12, 12) - Long-term trend
    stoch_slow_k, stoch_slow_d = stochastic(data.high, data.low, data.close, 20, 12, 12)
    # Stoch Medium (10, 6, 6) - Medium-term trend
    stoch_med_k, stoch_med_d = stochastic(data.high, data.low, data.close, 10, 6, 6)
    # Stoch Fast (5, 3, 3) - Short-term signals
    stoch_fast_k, stoch_fast_d = stochastic(data.high, data.low, data.close, 5, 3, 3)

    # Calculate Signal(9) lines - SMA of indicator values
    def sma(values: np.ndarray, period: int) -> np.ndarray:
        """Calculate Simple Moving Average."""
        result = np.full(len(values), np.nan)
        for i in range(period - 1, len(values)):
            window = values[i - period + 1:i + 1]
            valid = window[~np.isnan(window)]
            if len(valid) >= period // 2:  # Require at least half valid values
                result[i] = np.mean(valid)
        return result

    rsi_signal_values = sma(rsi_values, 9)

    # Calculate SMAs (Simple Moving Averages)
    sma20_values = sma(data.close, 20)
    sma200_values = sma(data.close, 200)

    # Calculate Bollinger Bands
    # BB1: Tight (20, 0.5) - Green
    bb1_upper, bb1_middle, bb1_lower = calculate_bb1(data.close)
    # BB2: Wide (20, 3.0) - Red
    bb2_upper, bb2_middle, bb2_lower = calculate_bb2(data.close)
    # RSI with Bollinger Band (30, 2.0) - for subchart
    _, rsi_bb_upper, rsi_bb_middle, rsi_bb_lower = calculate_rsi_with_bb(
        data.close, rsi_period=14, bb_length=30, bb_std_dev=2.0
    )

    # Calculate VWAP (intraday only - returns NaN for daily+)
    vwap_values = calculate_vwap(
        timestamps=data.timestamps,
        high=data.high,
        low=data.low,
        close=data.close,
        volume=data.volume,
        timeframe=tf,
    )

    # Calculate Keltner Channel
    kc_upper, kc_middle, kc_lower = calculate_keltner_channel(
        high=data.high,
        low=data.low,
        close=data.close,
        ema_period=20,
        atr_period=10,
        multiplier=1.5,
    )

    # Calculate TTM Squeeze (BB inside KC = squeeze ON)
    squeeze_values = calculate_ttm_squeeze(
        bb_upper=bb2_upper,  # Use wider BB for squeeze detection
        bb_lower=bb2_lower,
        kc_upper=kc_upper,
        kc_lower=kc_lower,
    )

    # Convert to list, replacing NaN with None for EMAs/SMAs (so frontend skips them)
    ema20_list = [float(v) if not np.isnan(v) else None for v in ema20_values]
    ema200_list = [float(v) if not np.isnan(v) else None for v in ema200_values]
    sma20_list = [float(v) if not np.isnan(v) else None for v in sma20_values]
    sma200_list = [float(v) if not np.isnan(v) else None for v in sma200_values]
    rsi_list = [float(v) if not np.isnan(v) else 50 for v in rsi_values]
    rsi_signal_list = [float(v) if not np.isnan(v) else 50 for v in rsi_signal_values]
    macd_line_list = [float(v) if not np.isnan(v) else 0 for v in macd_line_values]
    macd_signal_list = [float(v) if not np.isnan(v) else 0 for v in macd_signal_values]
    macd_histogram_list = [float(v) if not np.isnan(v) else 0 for v in macd_histogram_values]
    # 3 Stochastics
    stoch_slow_k_list = [float(v) if not np.isnan(v) else 50 for v in stoch_slow_k]
    stoch_slow_d_list = [float(v) if not np.isnan(v) else 50 for v in stoch_slow_d]
    stoch_med_k_list = [float(v) if not np.isnan(v) else 50 for v in stoch_med_k]
    stoch_med_d_list = [float(v) if not np.isnan(v) else 50 for v in stoch_med_d]
    stoch_fast_k_list = [float(v) if not np.isnan(v) else 50 for v in stoch_fast_k]
    stoch_fast_d_list = [float(v) if not np.isnan(v) else 50 for v in stoch_fast_d]
    # Bollinger Bands - use 0 for NaN (will be filtered on frontend)
    bb1_upper_list = [float(v) if not np.isnan(v) else 0 for v in bb1_upper]
    bb1_middle_list = [float(v) if not np.isnan(v) else 0 for v in bb1_middle]
    bb1_lower_list = [float(v) if not np.isnan(v) else 0 for v in bb1_lower]
    bb2_upper_list = [float(v) if not np.isnan(v) else 0 for v in bb2_upper]
    bb2_middle_list = [float(v) if not np.isnan(v) else 0 for v in bb2_middle]
    bb2_lower_list = [float(v) if not np.isnan(v) else 0 for v in bb2_lower]
    rsi_bb_upper_list = [float(v) if not np.isnan(v) else 50 for v in rsi_bb_upper]
    rsi_bb_middle_list = [float(v) if not np.isnan(v) else 50 for v in rsi_bb_middle]
    rsi_bb_lower_list = [float(v) if not np.isnan(v) else 50 for v in rsi_bb_lower]
    # VWAP - use 0 for NaN (will be filtered on frontend, or hidden for daily+ TF)
    vwap_list = [float(v) if not np.isnan(v) else 0 for v in vwap_values]
    # Keltner Channel
    kc_upper_list = [float(v) if not np.isnan(v) else 0 for v in kc_upper]
    kc_middle_list = [float(v) if not np.isnan(v) else 0 for v in kc_middle]
    kc_lower_list = [float(v) if not np.isnan(v) else 0 for v in kc_lower]
    # TTM Squeeze - boolean array
    squeeze_list = [bool(v) for v in squeeze_values]

    return OHLCVResponse(
        symbol=symbol,
        market=market,
        timeframe=tf,
        bars=bars,
        ema20=ema20_list,
        ema200=ema200_list,
        sma20=sma20_list,
        sma200=sma200_list,
        rsi=rsi_list,
        rsi_signal=rsi_signal_list,
        macd_line=macd_line_list,
        macd_signal=macd_signal_list,
        macd_histogram=macd_histogram_list,
        stoch_slow_k=stoch_slow_k_list,
        stoch_slow_d=stoch_slow_d_list,
        stoch_med_k=stoch_med_k_list,
        stoch_med_d=stoch_med_d_list,
        stoch_fast_k=stoch_fast_k_list,
        stoch_fast_d=stoch_fast_d_list,
        # Bollinger Bands
        bb1_upper=bb1_upper_list,
        bb1_middle=bb1_middle_list,
        bb1_lower=bb1_lower_list,
        bb2_upper=bb2_upper_list,
        bb2_middle=bb2_middle_list,
        bb2_lower=bb2_lower_list,
        rsi_bb_upper=rsi_bb_upper_list,
        rsi_bb_middle=rsi_bb_middle_list,
        rsi_bb_lower=rsi_bb_lower_list,
        # VWAP
        vwap=vwap_list,
        # Keltner Channel
        kc_upper=kc_upper_list,
        kc_middle=kc_middle_list,
        kc_lower=kc_lower_list,
        # TTM Squeeze
        squeeze=squeeze_list,
        # Data source
        source=source_used,
    )


# --- Watchlist endpoints ---

def _get_watchlist_path(market: str) -> Path:
    """Get watchlist file path for a market."""
    return DATA_DIR / f"{market.lower()}_watchlist.txt"


def _get_data_path(symbol: str, market: str, tf: str = "1D") -> Path:
    """Get data file path for a symbol."""
    return DATA_DIR / market.lower() / f"{symbol}_{tf}.csv"


def _count_bars(symbol: str, market: str) -> int:
    """Count bars in data file. Returns 0 if file doesn't exist."""
    data_path = _get_data_path(symbol, market)
    if not data_path.exists():
        return 0
    try:
        with open(data_path, "r") as f:
            # Subtract 1 for header
            return max(0, sum(1 for _ in f) - 1)
    except Exception:
        return 0


@app.get("/watchlist", response_model=WatchlistResponse)
def get_watchlist(
    market: str = Query(..., description="Market: KR or US"),
) -> WatchlistResponse:
    """Get watchlist for a market with data availability info."""
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    symbols = _load_watchlist(f"{market.lower()}_watchlist.txt")

    items = []
    for symbol in symbols:
        bar_count = _count_bars(symbol, market)
        items.append(WatchlistItem(
            symbol=symbol,
            market=market,
            has_data=bar_count > 0,
            bar_count=bar_count,
        ))

    return WatchlistResponse(market=market, symbols=items)


@app.post("/watchlist/add", response_model=AddSymbolResponse)
def add_to_watchlist(request: AddSymbolRequest) -> AddSymbolResponse:
    """Add symbol to watchlist and download OHLCV data."""
    symbol = request.symbol.upper().strip()
    market = request.market.upper()

    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol cannot be empty")

    # Check if already in watchlist
    watchlist_path = _get_watchlist_path(market)
    existing = _load_watchlist(f"{market.lower()}_watchlist.txt")
    if symbol in existing:
        bar_count = _count_bars(symbol, market)
        return AddSymbolResponse(
            success=True,
            symbol=symbol,
            market=market,
            message="Symbol already in watchlist",
            bar_count=bar_count,
        )

    # Download data using KIS API
    try:
        from engine.data.kis_api import get_kis_client, KISAPIError

        kis = get_kis_client()
        if not kis.is_configured():
            raise HTTPException(
                status_code=500,
                detail="KIS API not configured"
            )

        result = kis.get_ohlcv(
            symbol=symbol,
            market=market,
            timeframe="1D",
            count=500
        )

        if not result or "timestamps" not in result or len(result["timestamps"]) == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No data found for {symbol} in {market} market"
            )

        # Save to CSV
        import csv
        data_dir = DATA_DIR / market.lower()
        data_dir.mkdir(parents=True, exist_ok=True)
        data_path = data_dir / f"{symbol}_1day.csv"

        with open(data_path, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Date', 'Open', 'High', 'Low', 'Close', 'Volume'])
            for i in range(len(result["timestamps"])):
                writer.writerow([
                    result["timestamps"][i],
                    result["open"][i],
                    result["high"][i],
                    result["low"][i],
                    result["close"][i],
                    result["volume"][i]
                ])

        bar_count = len(result["timestamps"])

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="KIS API client not available"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download data: {str(e)}")

    # Add to watchlist file
    watchlist_path.parent.mkdir(parents=True, exist_ok=True)
    with open(watchlist_path, "a") as f:
        f.write(f"{symbol}\n")

    return AddSymbolResponse(
        success=True,
        symbol=symbol,
        market=market,
        message=f"Added {symbol} with {bar_count} bars",
        bar_count=bar_count,
    )


@app.post("/watchlist/remove", response_model=RemoveSymbolResponse)
def remove_from_watchlist(request: RemoveSymbolRequest) -> RemoveSymbolResponse:
    """Remove symbol from watchlist (keeps data file)."""
    symbol = request.symbol.upper().strip()
    market = request.market.upper()

    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    watchlist_path = _get_watchlist_path(market)
    existing = _load_watchlist(f"{market.lower()}_watchlist.txt")

    if symbol not in existing:
        return RemoveSymbolResponse(
            success=False,
            symbol=symbol,
            market=market,
            message="Symbol not in watchlist",
        )

    # Remove from list and rewrite file
    existing.remove(symbol)
    with open(watchlist_path, "w") as f:
        for s in existing:
            f.write(f"{s}\n")

    return RemoveSymbolResponse(
        success=True,
        symbol=symbol,
        market=market,
        message=f"Removed {symbol} from watchlist",
    )


# --- Portfolio endpoints ---

import json
from datetime import date

PORTFOLIO_FILE = DATA_DIR / "portfolio.json"


def _load_portfolio() -> List[dict]:
    """Load portfolio from JSON file."""
    if not PORTFOLIO_FILE.exists():
        return []
    try:
        with open(PORTFOLIO_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_portfolio(holdings: List[dict]) -> None:
    """Save portfolio to JSON file."""
    PORTFOLIO_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PORTFOLIO_FILE, "w") as f:
        json.dump(holdings, f, indent=2)


def _get_current_price(symbol: str, market: str) -> Optional[float]:
    """Get current price for a symbol from stored data."""
    try:
        data_dir = f"data/{market.lower()}"
        data = load_csv(symbol, "1D", data_dir=data_dir)
        if len(data.close) > 0:
            return float(data.close[-1])
    except FileNotFoundError:
        pass
    return None


@app.get("/portfolio", response_model=PortfolioResponse)
def get_portfolio() -> PortfolioResponse:
    """Get all portfolio holdings with current prices and P&L."""
    holdings_data = _load_portfolio()
    holdings_with_pnl = []
    total_kr_value = 0.0
    total_us_value = 0.0
    total_kr_pnl = 0.0
    total_us_pnl = 0.0

    for h in holdings_data:
        symbol = h["symbol"]
        market = h["market"]
        quantity = h["quantity"]
        avg_price = h["avg_price"]
        buy_date = h.get("buy_date", "")

        current_price = _get_current_price(symbol, market)
        if current_price is None:
            current_price = avg_price  # Fallback to avg price if no data

        total_value = current_price * quantity
        cost_basis = avg_price * quantity
        pnl_amount = total_value - cost_basis
        pnl_percent = (pnl_amount / cost_basis * 100) if cost_basis > 0 else 0.0

        holdings_with_pnl.append(PortfolioHoldingWithPnL(
            symbol=symbol,
            market=market,
            quantity=quantity,
            avg_price=avg_price,
            buy_date=buy_date,
            current_price=current_price,
            pnl_amount=pnl_amount,
            pnl_percent=pnl_percent,
            total_value=total_value,
        ))

        if market == "KR":
            total_kr_value += total_value
            total_kr_pnl += pnl_amount
        else:
            total_us_value += total_value
            total_us_pnl += pnl_amount

    return PortfolioResponse(
        holdings=holdings_with_pnl,
        total_kr_value=total_kr_value,
        total_us_value=total_us_value,
        total_kr_pnl=total_kr_pnl,
        total_us_pnl=total_us_pnl,
    )


@app.post("/portfolio/add", response_model=AddHoldingResponse)
def add_holding(request: AddHoldingRequest) -> AddHoldingResponse:
    """Add a new holding to portfolio."""
    symbol = request.symbol.upper().strip()
    market = request.market.upper()

    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol cannot be empty")

    if request.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")

    if request.avg_price <= 0:
        raise HTTPException(status_code=400, detail="Average price must be positive")

    buy_date = request.buy_date or date.today().isoformat()

    holdings = _load_portfolio()

    # Check if already exists
    for h in holdings:
        if h["symbol"] == symbol and h["market"] == market:
            return AddHoldingResponse(
                success=False,
                message=f"{symbol} already in portfolio. Use update to modify.",
                holding=None,
            )

    new_holding = {
        "symbol": symbol,
        "market": market,
        "quantity": request.quantity,
        "avg_price": request.avg_price,
        "buy_date": buy_date,
    }
    holdings.append(new_holding)
    _save_portfolio(holdings)

    return AddHoldingResponse(
        success=True,
        message=f"Added {symbol} to portfolio",
        holding=PortfolioHolding(**new_holding),
    )


@app.post("/portfolio/update", response_model=UpdateHoldingResponse)
def update_holding(request: UpdateHoldingRequest) -> UpdateHoldingResponse:
    """Update an existing holding in portfolio."""
    symbol = request.symbol.upper().strip()
    market = request.market.upper()

    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    holdings = _load_portfolio()

    for h in holdings:
        if h["symbol"] == symbol and h["market"] == market:
            if request.quantity is not None:
                if request.quantity <= 0:
                    raise HTTPException(status_code=400, detail="Quantity must be positive")
                h["quantity"] = request.quantity
            if request.avg_price is not None:
                if request.avg_price <= 0:
                    raise HTTPException(status_code=400, detail="Average price must be positive")
                h["avg_price"] = request.avg_price

            _save_portfolio(holdings)
            return UpdateHoldingResponse(
                success=True,
                message=f"Updated {symbol}",
                holding=PortfolioHolding(**h),
            )

    return UpdateHoldingResponse(
        success=False,
        message=f"{symbol} not found in portfolio",
        holding=None,
    )


@app.post("/portfolio/remove", response_model=RemoveHoldingResponse)
def remove_holding(request: RemoveHoldingRequest) -> RemoveHoldingResponse:
    """Remove a holding from portfolio."""
    symbol = request.symbol.upper().strip()
    market = request.market.upper()

    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    holdings = _load_portfolio()
    original_len = len(holdings)
    holdings = [h for h in holdings if not (h["symbol"] == symbol and h["market"] == market)]

    if len(holdings) == original_len:
        return RemoveHoldingResponse(
            success=False,
            message=f"{symbol} not found in portfolio",
        )

    _save_portfolio(holdings)
    return RemoveHoldingResponse(
        success=True,
        message=f"Removed {symbol} from portfolio",
    )


# --- Volume Profile endpoint ---

@app.get("/volume_profile", response_model=VolumeProfileResponse)
def get_volume_profile(
    symbol: str = Query(..., description="Symbol name"),
    market: str = Query("KR", description="Market: KR or US"),
    tf: str = Query("1D", description="Timeframe"),
    num_bins: int = Query(50, description="Number of price bins for histogram"),
) -> VolumeProfileResponse:
    """
    Get Volume Profile data for a symbol.

    Returns POC (Point of Control), VAH (Value Area High), VAL (Value Area Low),
    and a histogram of volume at each price level.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    try:
        data_dir = f"data/{market.lower()}"
        data = load_csv(symbol, tf, data_dir=data_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if data.volume is None or len(data.volume) == 0:
        raise HTTPException(status_code=400, detail="Volume data not available")

    # Calculate volume profile
    result = calculate_volume_profile(
        highs=data.high,
        lows=data.low,
        closes=data.close,
        volumes=data.volume,
        num_bins=num_bins,
    )

    # Convert histogram to schema
    histogram_bins = [
        VolumeProfileBin(
            price=h["price"],
            volume=h["volume"],
            percent=h["percent"],
            in_value_area=h.get("in_value_area", False),
        )
        for h in result.histogram
    ]

    return VolumeProfileResponse(
        symbol=symbol,
        market=market,
        timeframe=tf,
        poc_price=result.poc_price,
        vah_price=result.vah_price,
        val_price=result.val_price,
        total_volume=result.total_volume,
        value_area_volume=result.value_area_volume,
        histogram=histogram_bins,
    )


# --- Strategy Backtest endpoint ---

@app.get("/strategy/backtest", response_model=VolumaticBacktestResponse)
def strategy_backtest(
    symbol: str = Query(..., description="Symbol name"),
    market: str = Query("KR", description="Market: KR or US"),
    tf: str = Query("1D", description="Timeframe"),
    lookback: int = Query(1000, description="Number of bars to backtest"),
) -> VolumaticBacktestResponse:
    """
    Backtest the Volumatic FVG Strategy on historical data.

    Returns backtest metrics including win rate, profit factor, and signals.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    try:
        data_dir = f"data/{market.lower()}"
        data = load_csv(symbol, tf, data_dir=data_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Limit to lookback period
    total_bars = len(data.close)
    if total_bars < 100:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough data for backtest. Need at least 100 bars, got {total_bars}"
        )

    start_idx = max(0, total_bars - lookback)
    open_arr = data.open[start_idx:]
    high_arr = data.high[start_idx:]
    low_arr = data.low[start_idx:]
    close_arr = data.close[start_idx:]
    volume_arr = data.volume[start_idx:] if data.volume is not None else None

    # Run backtest
    result = backtest_volumatic_strategy(
        open_arr, high_arr, low_arr, close_arr, volume_arr
    )

    # Convert signals to schema
    signal_schemas = [
        VolumaticSignalSchema(
            signal_type=sig.signal_type,
            bar_index=sig.bar_index,
            entry_price=sig.entry_price,
            stop_loss=sig.stop_loss,
            take_profit=sig.take_profit,
            risk_reward=sig.risk_reward,
            ob_index=sig.ob_index,
            fvg_index=sig.fvg_index,
            volumatic_score=sig.volumatic_score,
            rsi_value=sig.rsi_value,
            reason=sig.reason,
        )
        for sig in result.signals
    ]

    return VolumaticBacktestResponse(
        symbol=symbol,
        market=market,
        timeframe=tf,
        total_trades=result.total_trades,
        wins=result.wins,
        losses=result.losses,
        win_rate=round(result.win_rate, 2),
        profit_factor=round(result.profit_factor, 2),
        total_profit_r=round(result.total_profit_r, 2),
        avg_win_r=round(result.avg_win_r, 2),
        avg_loss_r=round(result.avg_loss_r, 2),
        max_drawdown_r=round(result.max_drawdown_r, 2),
        sharpe_ratio=round(result.sharpe_ratio, 2),
        signals=signal_schemas,
        equity_curve=result.equity_curve,
    )


# --- MTF (Multi-Timeframe) Analysis endpoint ---

@app.get("/mtf/analyze", response_model=MTFAnalyzeResponse)
def mtf_analyze(
    symbol: str = Query(..., description="Symbol name"),
    market: str = Query("KR", description="Market: KR or US"),
    ltf: str = Query("1H", description="Lower timeframe (chart TF)"),
    htf: str = Query("", description="Higher timeframe (auto if empty)"),
    lookback: int = Query(20, description="HTF bars to analyze"),
    fresh_only: bool = Query(True, description="Only return unmitigated zones"),
) -> MTFAnalyzeResponse:
    """
    Multi-Timeframe Order Block & FVG Analysis.

    Detects HTF (Higher Timeframe) OBs and FVGs and projects them to LTF chart.
    Use this to see where important HTF zones appear on your LTF chart.

    Example: View 4H OBs on a 1H chart to find high-probability entry zones.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    try:
        data_dir = f"data/{market.lower()}"
        data = load_csv(symbol, ltf, data_dir=data_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if len(data.close) < 50:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough data for MTF analysis. Need at least 50 bars, got {len(data.close)}"
        )

    # Auto-select HTF if not provided
    actual_htf = htf if htf else get_htf_for_ltf(ltf)

    # Run MTF analysis
    mtf_result = analyze_mtf(
        open_=data.open,
        high=data.high,
        low=data.low,
        close=data.close,
        volume=data.volume,
        ltf=ltf,
        htf=actual_htf,
        lookback=lookback,
        fresh_only=fresh_only,
    )

    # Project to LTF coordinates
    projected = project_htf_zones_to_ltf(mtf_result, data.close)

    # Convert to schema
    htf_ob_schemas = [
        HTFOrderBlockSchema(
            htf_index=ob["htf_index"],
            direction=ob["direction"],
            zone_top=ob["zone_top"],
            zone_bottom=ob["zone_bottom"],
            htf_timeframe=ob["htf_timeframe"],
            ltf_start=ob["ltf_start"],
            ltf_end=ob["ltf_end"],
            volume_strength=ob["volume_strength"],
            displacement_pct=ob["displacement_pct"],
            distance_from_price_pct=ob["distance_from_price_pct"],
            price_in_zone=ob["price_in_zone"],
        )
        for ob in projected["htf_obs"]
    ]

    htf_fvg_schemas = [
        HTFFVGSchema(
            htf_index=fvg["htf_index"],
            direction=fvg["direction"],
            gap_high=fvg["gap_high"],
            gap_low=fvg["gap_low"],
            htf_timeframe=fvg["htf_timeframe"],
            ltf_start=fvg["ltf_start"],
            ltf_end=fvg["ltf_end"],
            is_fresh=fvg["is_fresh"],
            fill_percentage=fvg["fill_percentage"],
            distance_from_price_pct=fvg["distance_from_price_pct"],
            price_in_gap=fvg["price_in_gap"],
        )
        for fvg in projected["htf_fvgs"]
    ]

    # Calculate summary stats
    bull_obs = [ob for ob in htf_ob_schemas if ob.direction == "buy"]
    bear_obs = [ob for ob in htf_ob_schemas if ob.direction == "sell"]
    bull_fvgs = [fvg for fvg in htf_fvg_schemas if fvg.direction == "buy"]
    bear_fvgs = [fvg for fvg in htf_fvg_schemas if fvg.direction == "sell"]

    # Find nearest zones
    nearest_bull = None
    nearest_bear = None

    bull_zones = [(ob.distance_from_price_pct, ob.zone_bottom) for ob in bull_obs] + \
                 [(fvg.distance_from_price_pct, fvg.gap_low) for fvg in bull_fvgs]
    bear_zones = [(ob.distance_from_price_pct, ob.zone_top) for ob in bear_obs] + \
                 [(fvg.distance_from_price_pct, fvg.gap_high) for fvg in bear_fvgs]

    if bull_zones:
        nearest_bull = min(z[0] for z in bull_zones)
    if bear_zones:
        nearest_bear = min(z[0] for z in bear_zones)

    return MTFAnalyzeResponse(
        symbol=symbol,
        market=market,
        ltf_timeframe=ltf,
        htf_timeframe=actual_htf,
        current_price=projected["current_price"],
        htf_bar_count=projected["htf_bar_count"],
        ltf_bar_count=len(data.close),
        htf_obs=htf_ob_schemas,
        htf_fvgs=htf_fvg_schemas,
        bull_obs_count=len(bull_obs),
        bear_obs_count=len(bear_obs),
        bull_fvgs_count=len(bull_fvgs),
        bear_fvgs_count=len(bear_fvgs),
        nearest_bull_zone=nearest_bull,
        nearest_bear_zone=nearest_bear,
    )


# --- Dynamic Indicators endpoint ---

@app.get("/indicators/dynamic", response_model=DynamicIndicatorsResponse)
def get_dynamic_indicators(
    symbol: str = Query(..., description="Symbol name"),
    market: str = Query("KR", description="Market: KR or US"),
    tf: str = Query("1D", description="Timeframe"),
    selected: str = Query("wr", description="Comma-separated indicator list: wr,rsi"),
) -> DynamicIndicatorsResponse:
    """
    Get dynamic indicators with signal lines for subchart display.

    Available indicators:
    - wr: Williams %R (14) with Signal(9) line
    - rsi: RSI (14) with Fibonacci Signal(9) line

    Returns crossover signals when indicator crosses its signal line.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    try:
        data_dir = f"data/{market.lower()}"
        data = load_csv(symbol, tf, data_dir=data_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if len(data.close) < 20:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough data for indicators. Need at least 20 bars, got {len(data.close)}"
        )

    # Parse selected indicators
    selected_list = [s.strip().lower() for s in selected.split(",")]

    # Create indicator manager
    manager = DynamicIndicatorManager(
        open_=data.open,
        high=data.high,
        low=data.low,
        close=data.close,
        volume=data.volume,
    )

    # Get indicators
    indicators = manager.get_indicators(selected_list)

    # Build response
    wr_data = None
    rsi_data = None

    if "wr" in indicators:
        wr = indicators["wr"]
        wr_data = WilliamsRIndicator(
            name=wr["name"],
            label=wr["label"],
            wr=wr["wr"],
            wr_signal=wr["wr_signal"],
            oversold=wr["oversold"],
            overbought=wr["overbought"],
            min_value=wr["min_value"],
            max_value=wr["max_value"],
            current_value=wr["current_value"],
            current_signal=wr["current_signal"],
            crossover=wr["crossover"],
            colors=IndicatorColors(**wr["colors"]),
        )

    if "rsi" in indicators:
        rsi = indicators["rsi"]
        rsi_data = RSIIndicator(
            name=rsi["name"],
            label=rsi["label"],
            rsi=rsi["rsi"],
            rsi_signal=rsi["rsi_signal"],
            oversold=rsi["oversold"],
            overbought=rsi["overbought"],
            min_value=rsi["min_value"],
            max_value=rsi["max_value"],
            current_value=rsi["current_value"],
            current_signal=rsi["current_signal"],
            crossover=rsi["crossover"],
            colors=IndicatorColors(**rsi["colors"]),
        )

    return DynamicIndicatorsResponse(
        symbol=symbol,
        market=market,
        timeframe=tf,
        bar_count=len(data.close),
        wr=wr_data,
        rsi=rsi_data,
    )


# --- Backtest endpoint ---

@app.get("/backtest", response_model=BacktestResponse)
def backtest(
    symbol: str,
    market: str = "KR",
    tf: str = "1D",
    days: int = 90,
    min_score: int = 85,
    risk_reward: float = 3.0,
) -> BacktestResponse:
    """
    Run complete backtest with all strategy features.

    Integrates:
    - Order Block detection
    - FVG detection
    - Confluence scoring (OB + FVG overlap)
    - Williams %R signals
    - RSI confirmation
    - Volume confirmation

    Market-specific costs:
    - KR: 0.015% commission, 0.1% slippage, 100M KRW initial
    - US: 0% commission, 0.05% slippage, $100K USD initial
    """
    # Load price data using existing function
    data = _get_ohlcv_for_symbol(symbol, market, tf)
    if data is None or len(data.close) < 100:
        raise HTTPException(status_code=404, detail="Not enough data for backtest (need 100+ bars)")

    # Convert to numpy arrays
    times = list(data.timestamps)
    open_arr = np.array(data.open)
    high = np.array(data.high)
    low = np.array(data.low)
    close = np.array(data.close)
    volume = np.array(data.volume)

    # Run backtest
    result = run_backtest(
        times=times,
        open_arr=open_arr,
        high=high,
        low=low,
        close=close,
        volume=volume,
        symbol=symbol,
        market=market,
        timeframe=tf,
        min_score=min_score,
        risk_reward=risk_reward,
    )

    # Convert to response schema
    metrics = BacktestMetricsSchema(
        total_trades=result.metrics.total_trades,
        wins=result.metrics.wins,
        losses=result.metrics.losses,
        win_rate=result.metrics.win_rate,
        profit_factor=result.metrics.profit_factor,
        sharpe_ratio=result.metrics.sharpe_ratio,
        total_return=result.metrics.total_return,
        max_drawdown=result.metrics.max_drawdown,
        avg_win=result.metrics.avg_win,
        avg_loss=result.metrics.avg_loss,
        max_consecutive_wins=result.metrics.max_consecutive_wins,
        max_consecutive_losses=result.metrics.max_consecutive_losses,
        avg_hold_bars=result.metrics.avg_hold_bars,
    )

    equity_curve = [
        EquityPointSchema(date=ep.date, equity=ep.equity, drawdown=ep.drawdown)
        for ep in result.equity_curve
    ]

    trades = [
        BacktestTradeSchema(
            date=t.date,
            direction=t.direction,
            entry_price=t.entry_price,
            exit_price=t.exit_price,
            stop_loss=t.stop_loss,
            take_profit=t.take_profit,
            pnl_percent=t.pnl_percent,
            pnl_amount=t.pnl_amount,
            result=t.result,
            hold_bars=t.hold_bars,
            confluence_score=t.confluence_score,
            williams_r=t.williams_r,
            rsi=t.rsi,
            volume_confirm=t.volume_confirm,
        )
        for t in result.trades
    ]

    return BacktestResponse(
        symbol=result.symbol,
        market=result.market,
        timeframe=result.timeframe,
        period=result.period,
        initial_capital=result.initial_capital,
        final_capital=result.final_capital,
        currency=result.currency,
        metrics=metrics,
        equity_curve=equity_curve,
        trades=trades,
    )


# --- Alert endpoints ---

from engine.alerts.telegram_bot import (
    get_bot,
    load_settings,
    save_settings,
    AlertSettings,
)
import asyncio


@app.post("/alerts/test", response_model=AlertTestResponse)
async def test_alert() -> AlertTestResponse:
    """Send a test alert to verify Telegram connection."""
    bot = get_bot()
    success = await bot.send_test_alert()

    if success:
        return AlertTestResponse(
            success=True,
            message="테스트 알림이 성공적으로 전송되었습니다!"
        )
    else:
        return AlertTestResponse(
            success=False,
            message="알림 전송 실패. 봇 토큰과 채팅 ID를 확인하세요."
        )


@app.get("/alerts/settings", response_model=AlertSettingsResponse)
def get_alert_settings() -> AlertSettingsResponse:
    """Get current alert settings."""
    bot = get_bot()
    settings = bot.reload_settings()

    # Test connection by checking if we can reach Telegram API
    connected = True  # Assume connected; actual check would be async

    return AlertSettingsResponse(
        settings=AlertSettingsSchema(
            enabled=settings.enabled,
            min_confluence=settings.min_confluence,
            alert_types=settings.alert_types,
            cooldown_minutes=settings.cooldown_minutes,
        ),
        connected=connected,
    )


@app.post("/alerts/settings", response_model=AlertSettingsResponse)
def update_alert_settings(
    settings: AlertSettingsSchema,
) -> AlertSettingsResponse:
    """Update alert settings."""
    # Validate min_confluence
    if not 50 <= settings.min_confluence <= 100:
        raise HTTPException(
            status_code=400,
            detail="min_confluence must be between 50 and 100"
        )

    # Validate cooldown_minutes
    if not 1 <= settings.cooldown_minutes <= 60:
        raise HTTPException(
            status_code=400,
            detail="cooldown_minutes must be between 1 and 60"
        )

    # Save settings
    new_settings = AlertSettings(
        enabled=settings.enabled,
        min_confluence=settings.min_confluence,
        alert_types=settings.alert_types,
        cooldown_minutes=settings.cooldown_minutes,
    )
    save_settings(new_settings)

    # Reload bot settings
    bot = get_bot()
    bot.reload_settings()

    return AlertSettingsResponse(
        settings=settings,
        connected=True,
    )


@app.post("/alerts/scan")
async def scan_for_alerts(
    market: str = Query("KR", description="Market to scan: KR or US"),
) -> dict:
    """
    Manually trigger alert scan for a market.
    Checks all watchlist symbols for retest signals.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    bot = get_bot()
    if not bot.settings.enabled:
        return {"scanned": 0, "alerts_sent": 0, "message": "Alerts are disabled"}

    # Load watchlist
    watchlist_path = Path(f"data/{market.lower()}_watchlist.txt")
    if not watchlist_path.exists():
        return {"scanned": 0, "alerts_sent": 0, "message": "Watchlist not found"}

    symbols = [
        line.strip()
        for line in watchlist_path.read_text().splitlines()
        if line.strip()
    ]

    alerts_sent = 0
    scanned = 0

    for symbol in symbols:
        try:
            # Load data
            data_dir = f"data/{market.lower()}"
            data = load_csv(symbol, "1D", data_dir=data_dir)

            if len(data.close) < 50:
                continue

            scanned += 1
            bar_index = len(data.close) - 1
            current_price = float(data.close[bar_index])

            # Run analysis
            analysis = analyze_at_bar(data, bar_index, filter_weak=True)

            # Check for active retest signals
            if analysis.signals:
                for signal in analysis.signals:
                    if signal.type in ("retest_long", "retest_short"):
                        direction = "bull" if signal.type == "retest_long" else "bear"

                        # Check confluence score
                        score = signal.ob_strength
                        if score >= bot.settings.min_confluence:
                            # Get OB zone info
                            zone_top = current_price * 1.02  # Placeholder
                            zone_bottom = current_price * 0.98

                            if analysis.current_valid_ob:
                                zone_top = analysis.current_valid_ob.zone_top
                                zone_bottom = analysis.current_valid_ob.zone_bottom

                            # Send alert
                            success = await bot.send_retest_alert(
                                symbol=symbol,
                                market=market,
                                direction=direction,
                                zone_top=zone_top,
                                zone_bottom=zone_bottom,
                                score=score,
                                price=current_price,
                                volume_confirm=signal.volume_confirm,
                            )

                            if success:
                                alerts_sent += 1

        except Exception as e:
            print(f"Error scanning {symbol}: {e}")
            continue

    return {
        "scanned": scanned,
        "alerts_sent": alerts_sent,
        "message": f"Scanned {scanned} symbols, sent {alerts_sent} alerts",
    }


# --- KIS API endpoints ---

@app.post("/kis/configure", response_model=KISConfigResponse)
def configure_kis(request: KISConfigRequest):
    """
    Configure KIS (Korea Investment & Securities) API credentials.

    Credentials are stored in memory only (not persisted).
    For production, use environment variables.
    """
    try:
        client = configure_kis_client(
            app_key=request.app_key,
            app_secret=request.app_secret,
            account_no=request.account_no,
            mock=request.mock,
        )

        # Test the connection
        status = client.test_connection()

        return KISConfigResponse(
            success=status["connected"],
            message=status["message"],
            configured=status["configured"],
            mock_mode=status["mock_mode"],
        )
    except Exception as e:
        return KISConfigResponse(
            success=False,
            message=str(e),
            configured=False,
            mock_mode=False,
        )


@app.get("/kis/status", response_model=KISConnectionStatus)
def get_kis_status():
    """
    Get KIS API connection status.

    Returns configuration and connection status.
    """
    try:
        client = get_kis_client()
        status = client.test_connection()

        return KISConnectionStatus(
            configured=status["configured"],
            connected=status["connected"],
            mock_mode=status["mock_mode"],
            message=status["message"],
            token_expires=status.get("token_expires"),
        )
    except Exception as e:
        return KISConnectionStatus(
            configured=False,
            connected=False,
            mock_mode=False,
            message=str(e),
        )


@app.get("/kis/test")
def test_kis_connection():
    """
    Test KIS API connection by fetching a sample stock price.

    Uses Samsung (005930) as a test symbol.
    """
    try:
        client = get_kis_client()

        if not client.is_configured:
            return {
                "success": False,
                "message": "KIS API not configured. Set KIS_APP_KEY and KIS_APP_SECRET environment variables or call /kis/configure.",
            }

        # Test with Samsung
        price = client.get_current_price("005930", "KR")

        return {
            "success": True,
            "message": "Connection successful",
            "test_data": {
                "symbol": "005930",
                "name": "삼성전자",
                "price": price["price"],
                "change": price["change"],
                "change_pct": price["change_pct"],
            },
        }
    except KISAPIError as e:
        return {
            "success": False,
            "message": str(e),
            "error_code": e.code,
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Unexpected error: {e}",
        }


@app.get("/kis/price", response_model=KISPriceResponse)
def get_kis_price(
    symbol: str = Query(..., description="Stock symbol"),
    market: str = Query("KR", description="Market: KR or US"),
):
    """
    Get current stock price from KIS API.

    Real-time price data (requires KIS API credentials).
    """
    try:
        client = get_kis_client()

        if not client.is_configured:
            raise HTTPException(
                status_code=400,
                detail="KIS API not configured. Set environment variables or call /kis/configure first.",
            )

        price_data = client.get_current_price(symbol, market)

        return KISPriceResponse(
            symbol=price_data["symbol"],
            market=price_data["market"],
            price=price_data["price"],
            change=price_data["change"],
            change_pct=price_data["change_pct"],
            volume=price_data["volume"],
            high=price_data["high"],
            low=price_data["low"],
            open=price_data["open"],
            prev_close=price_data["prev_close"],
            timestamp=price_data["timestamp"],
        )
    except KISAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@app.get("/data/source", response_model=DataSourceInfo)
def get_data_source_info():
    """
    Get information about available data sources.

    Returns current source and KIS configuration status.
    """
    try:
        client = get_kis_client()
        status = client.test_connection()

        available = ["kis"]
        if status["configured"]:
            available.insert(0, "kis_realtime")

        return DataSourceInfo(
            current_source="kis",  # KIS API is the primary source
            kis_configured=status["configured"],
            kis_connected=status["connected"],
            available_sources=available,
        )
    except Exception:
        return DataSourceInfo(
            current_source="kis",
            kis_configured=False,
            kis_connected=False,
            available_sources=["kis"],
        )


# --- WebSocket Real-time Price Updates ---

class ConnectionManager:
    """Manages WebSocket connections for real-time price updates."""

    def __init__(self):
        # symbol -> set of websockets
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self._kis_ws_task: Optional[asyncio.Task] = None
        self._kis_connected = False

    async def connect(self, websocket: WebSocket, symbol: str, market: str) -> None:
        """Accept a new WebSocket connection and subscribe to price updates."""
        await websocket.accept()

        key = f"{symbol}:{market}"
        if key not in self.active_connections:
            self.active_connections[key] = set()
        self.active_connections[key].add(websocket)

        # Send initial connection status
        await websocket.send_json({
            "type": "connected",
            "symbol": symbol,
            "market": market,
            "timestamp": datetime.now().isoformat(),
        })

    def disconnect(self, websocket: WebSocket, symbol: str, market: str) -> None:
        """Remove a WebSocket connection."""
        key = f"{symbol}:{market}"
        if key in self.active_connections:
            self.active_connections[key].discard(websocket)
            if not self.active_connections[key]:
                del self.active_connections[key]

    async def broadcast_price(
        self,
        symbol: str,
        market: str,
        price_data: dict,
    ) -> None:
        """Broadcast price update to all connected clients for a symbol."""
        key = f"{symbol}:{market}"
        if key not in self.active_connections:
            return

        message = {
            "type": "price",
            "symbol": symbol,
            "market": market,
            **price_data,
        }

        # Send to all connected clients
        dead_connections = []
        for connection in self.active_connections[key]:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)

        # Clean up dead connections
        for conn in dead_connections:
            self.active_connections[key].discard(conn)


# Global connection manager
ws_manager = ConnectionManager()


@app.websocket("/ws/realtime/{symbol}")
async def websocket_realtime(
    websocket: WebSocket,
    symbol: str,
    market: str = "KR",
):
    """
    WebSocket endpoint for real-time price updates.

    Connect to receive live price updates for a symbol.

    Message types sent:
    - connected: Initial connection confirmation
    - price: Real-time price update
    - error: Error message
    - status: Connection status update

    Price message format:
    {
        "type": "price",
        "symbol": "005930",
        "market": "KR",
        "price": 80500,
        "change": 500,
        "change_pct": 0.62,
        "high": 80800,
        "low": 79900,
        "open": 80000,
        "volume": 12345678,
        "timestamp": "2024-01-15T10:30:45.123456"
    }
    """
    symbol = symbol.upper()
    market = market.upper()

    await ws_manager.connect(websocket, symbol, market)

    try:
        # Try to get real-time updates from KIS
        client = get_kis_client()

        if client.is_configured:
            # Start polling for price updates (KIS WebSocket requires complex setup)
            # For simplicity, we use polling with REST API as a reliable fallback
            last_price = None
            poll_interval = 1.0  # 1 second polling

            while True:
                try:
                    # Check for client messages (ping/pong, close requests)
                    try:
                        msg = await asyncio.wait_for(
                            websocket.receive_text(),
                            timeout=0.1
                        )
                        # Handle ping
                        if msg == "ping":
                            await websocket.send_text("pong")
                            continue
                    except asyncio.TimeoutError:
                        pass  # No message, continue with price update

                    # Fetch current price
                    try:
                        price_data = client.get_current_price(symbol, market)

                        # Check if we got valid price data
                        current_price = price_data.get("price", 0)
                        if current_price == 0:
                            # No valid price - might be unsupported symbol
                            if last_price is None:
                                await websocket.send_json({
                                    "type": "error",
                                    "message": f"Symbol {symbol} not found or no price data available",
                                    "code": "NO_PRICE_DATA",
                                })
                            continue

                        # Only send if price changed
                        if last_price is None or current_price != last_price:
                            last_price = current_price

                            await ws_manager.broadcast_price(
                                symbol,
                                market,
                                {
                                    "price": price_data.get("price", 0),
                                    "change": price_data.get("change", 0),
                                    "change_pct": price_data.get("change_pct", 0),
                                    "high": price_data.get("high", 0),
                                    "low": price_data.get("low", 0),
                                    "open": price_data.get("open", 0),
                                    "volume": price_data.get("volume", 0),
                                    "prev_close": price_data.get("prev_close", 0),
                                    "timestamp": price_data.get("timestamp", datetime.now().isoformat()),
                                }
                            )
                    except Exception as e:
                        # Send error to client and log
                        error_msg = str(e)
                        print(f"Price fetch error for {symbol}: {error_msg}")
                        if last_price is None:
                            await websocket.send_json({
                                "type": "error",
                                "message": f"Failed to fetch price for {symbol}: {error_msg}",
                                "code": "PRICE_FETCH_ERROR",
                            })

                    await asyncio.sleep(poll_interval)

                except WebSocketDisconnect:
                    break

        else:
            # KIS not configured - send error and keep connection for status
            await websocket.send_json({
                "type": "error",
                "message": "KIS API not configured. Real-time updates unavailable.",
                "code": "KIS_NOT_CONFIGURED",
            })

            # Keep connection alive but idle
            while True:
                try:
                    msg = await websocket.receive_text()
                    if msg == "ping":
                        await websocket.send_text("pong")
                except WebSocketDisconnect:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e),
            })
        except Exception:
            pass
    finally:
        ws_manager.disconnect(websocket, symbol, market)


@app.get("/ws/status")
def get_websocket_status():
    """Get WebSocket connection statistics."""
    connections = {}
    for key, conns in ws_manager.active_connections.items():
        connections[key] = len(conns)

    return {
        "active_symbols": list(ws_manager.active_connections.keys()),
        "total_connections": sum(len(c) for c in ws_manager.active_connections.values()),
        "connections_per_symbol": connections,
    }


# Import datetime at module level for WebSocket
from datetime import datetime


# ============================================================
# AI PREDICTION ENDPOINTS
# ============================================================

@app.get("/api/ai/technical_ml")
async def ai_technical_ml(
    symbol: str = Query(..., description="Stock symbol"),
    market: str = Query("US", description="Market (KR or US)"),
):
    """
    Technical ML AI - Predicts short-term and mid-term trends
    based on technical indicators (EMA, SMA, RSI, MACD, Stochastic).
    """
    try:
        # Load data
        ohlcv = load_with_refresh(symbol, market, "1D")
        if ohlcv is None or len(ohlcv.close) < 50:
            raise HTTPException(status_code=404, detail=f"Not enough data for {symbol}")

        # Calculate indicators
        ema20 = calculate_ema(ohlcv.close, 20)
        ema200 = calculate_ema(ohlcv.close, 200)
        sma20 = calculate_sma(ohlcv.close, 20)
        sma200 = calculate_sma(ohlcv.close, 200)
        rsi = calculate_rsi(ohlcv.close, 14)
        macd_line, macd_signal, macd_hist = calculate_macd(ohlcv.close)
        stoch_k, stoch_d = calculate_stochastic(ohlcv.high, ohlcv.low, ohlcv.close, 14, 3)

        # Get latest values
        current_price = float(ohlcv.close[-1])
        latest_ema20 = float(ema20[-1]) if ema20[-1] > 0 else current_price
        latest_ema200 = float(ema200[-1]) if ema200[-1] > 0 else current_price
        latest_rsi = float(rsi[-1]) if rsi[-1] > 0 else 50
        latest_macd = float(macd_hist[-1]) if not np.isnan(macd_hist[-1]) else 0
        latest_stoch_k = float(stoch_k[-1]) if not np.isnan(stoch_k[-1]) else 50

        # Simple rule-based prediction (simulating ML output)
        short_term_score = 50  # Base score

        # EMA trend signals
        if current_price > latest_ema20:
            short_term_score += 10
        else:
            short_term_score -= 10

        if current_price > latest_ema200:
            short_term_score += 8
        else:
            short_term_score -= 8

        # RSI signals
        if 30 < latest_rsi < 50:
            short_term_score += 12  # Oversold recovery potential
        elif latest_rsi > 70:
            short_term_score -= 10  # Overbought
        elif latest_rsi > 50:
            short_term_score += 5

        # MACD signals
        if latest_macd > 0:
            short_term_score += 8
        else:
            short_term_score -= 8

        # Stochastic signals
        if latest_stoch_k < 20:
            short_term_score += 10  # Oversold
        elif latest_stoch_k > 80:
            short_term_score -= 10  # Overbought
        elif latest_stoch_k > 50:
            short_term_score += 5

        # Normalize to probability
        short_term_up = min(max(short_term_score, 15), 85)
        short_term_down = 100 - short_term_up

        # Mid-term calculation (more weight on trend indicators)
        mid_term_score = 50
        if current_price > latest_ema200:
            mid_term_score += 15
        else:
            mid_term_score -= 15

        # EMA crossover
        if latest_ema20 > latest_ema200:
            mid_term_score += 12
        else:
            mid_term_score -= 12

        # Trend strength
        price_to_ema200_pct = ((current_price - latest_ema200) / latest_ema200) * 100
        if price_to_ema200_pct > 5:
            mid_term_score += 8
        elif price_to_ema200_pct < -5:
            mid_term_score -= 8

        mid_term_up = min(max(mid_term_score, 15), 85)
        mid_term_down = 100 - mid_term_up

        return {
            "symbol": symbol,
            "market": market,
            "short_term": {
                "period": "1-3일",
                "up_prob": round(short_term_up),
                "down_prob": round(short_term_down),
                "signal": "bullish" if short_term_up > 55 else "bearish" if short_term_up < 45 else "neutral",
            },
            "mid_term": {
                "period": "5-10일",
                "up_prob": round(mid_term_up),
                "down_prob": round(mid_term_down),
                "signal": "bullish" if mid_term_up > 55 else "bearish" if mid_term_up < 45 else "neutral",
            },
            "indicators": {
                "rsi": round(latest_rsi, 1),
                "macd": round(latest_macd, 2),
                "stoch_k": round(latest_stoch_k, 1),
                "ema20_position": "above" if current_price > latest_ema20 else "below",
                "ema200_position": "above" if current_price > latest_ema200 else "below",
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ai/lstm_predict")
async def ai_lstm_predict(
    symbol: str = Query(..., description="Stock symbol"),
    market: str = Query("US", description="Market (KR or US)"),
):
    """
    LSTM Price Prediction - Predicts next 5-10 days prices.
    Note: This is a simplified simulation. Real LSTM would require trained models.
    """
    try:
        # Load data
        ohlcv = load_with_refresh(symbol, market, "1D")
        if ohlcv is None or len(ohlcv.close) < 60:
            raise HTTPException(status_code=404, detail=f"Not enough data for {symbol}")

        # Get recent data for prediction basis
        closes = ohlcv.close[-60:]
        current_price = float(closes[-1])

        # Calculate trend and volatility
        returns = np.diff(closes) / closes[:-1]
        avg_return = float(np.mean(returns))
        volatility = float(np.std(returns))

        # Simple trend-based prediction (simulating LSTM output)
        # In reality, this would be a trained LSTM model
        predictions = []
        predicted_price = current_price

        for day in [1, 2, 3, 5, 7, 10]:
            # Trend continuation with some mean reversion
            trend_component = avg_return * day * 0.7
            random_component = volatility * np.sqrt(day) * 0.5

            predicted_price = current_price * (1 + trend_component)
            upper_bound = predicted_price * (1 + random_component * 1.5)
            lower_bound = predicted_price * (1 - random_component * 1.5)

            predictions.append({
                "day": day,
                "price": round(predicted_price, 2),
                "upper": round(upper_bound, 2),
                "lower": round(lower_bound, 2),
            })

        # Determine overall trend
        final_prediction = predictions[-1]["price"]
        trend = "upward" if final_prediction > current_price * 1.01 else \
                "downward" if final_prediction < current_price * 0.99 else "sideways"

        # Calculate confidence based on volatility
        confidence = max(40, min(85, int(80 - volatility * 500)))

        return {
            "symbol": symbol,
            "market": market,
            "current_price": current_price,
            "predictions": predictions,
            "trend": trend,
            "confidence": confidence,
            "volatility": round(volatility * 100, 2),
            "avg_daily_return": round(avg_return * 100, 3),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ai/lh_analysis")
async def ai_lh_analysis(
    symbol: str = Query(..., description="Stock symbol"),
    market: str = Query("US", description="Market (KR or US)"),
):
    """
    LH AI Analysis - Custom analysis using BBs, OBs, FVGs, and RSI.
    """
    try:
        # Load data
        ohlcv = load_with_refresh(symbol, market, "1D")
        if ohlcv is None or len(ohlcv.close) < 50:
            raise HTTPException(status_code=404, detail=f"Not enough data for {symbol}")

        # Calculate Bollinger Bands
        bb1_upper, bb1_middle, bb1_lower = calculate_bb1(ohlcv.close)  # 20, 0.5
        bb2_upper, bb2_middle, bb2_lower = calculate_bb2(ohlcv.close)  # 20, 3.0

        # Calculate BB3 (30, 3.0) for longer term
        bb3_upper, bb3_middle, bb3_lower = calculate_bollinger_bands(ohlcv.close, length=30, std_dev=3.0)

        # Calculate RSI
        rsi = calculate_rsi(ohlcv.close, 14)

        # Calculate EMA for trend
        ema200 = calculate_ema(ohlcv.close, 200)

        # Detect Order Blocks and FVGs
        ob, _ = detect_orderblock(ohlcv.open, ohlcv.high, ohlcv.low, ohlcv.close, ohlcv.volume)
        fvgs = find_all_fvgs(ohlcv.open, ohlcv.high, ohlcv.low, ohlcv.close)

        # Get latest values
        current_price = float(ohlcv.close[-1])
        latest_rsi = float(rsi[-1]) if rsi[-1] > 0 else 50
        latest_ema200 = float(ema200[-1]) if ema200[-1] > 0 else current_price

        # BB values
        bb1_u, bb1_l = float(bb1_upper[-1]), float(bb1_lower[-1])
        bb2_u, bb2_l = float(bb2_upper[-1]), float(bb2_lower[-1])
        bb3_u, bb3_l = float(bb3_upper[-1]), float(bb3_lower[-1])

        # Analysis
        signals = []
        confidence = 50  # Base confidence

        # BB1 analysis (tight band - short term)
        if current_price <= bb1_l:
            signals.append("🎯 BB1 하단 터치 - 단기 반등 시그널")
            confidence += 15
        elif current_price >= bb1_u:
            signals.append("⚠️ BB1 상단 터치 - 단기 조정 가능")
            confidence -= 8

        # BB2 analysis (wide band - medium term trend)
        bb2_position = (current_price - bb2_l) / (bb2_u - bb2_l) if bb2_u != bb2_l else 0.5
        if bb2_position > 0.6:
            signals.append("📈 BB2 상단권 - 상승 추세 지속")
            confidence += 10
        elif bb2_position < 0.4:
            signals.append("📉 BB2 하단권 - 하락 압력")
            confidence -= 10

        # BB3 analysis (long term)
        if current_price >= bb3_u:
            signals.append("🔴 BB3 상단 돌파 - 장기 과매수 주의")
            confidence -= 15
        elif current_price <= bb3_l:
            signals.append("🟢 BB3 하단 - 장기 과매도, 반등 기회")
            confidence += 20

        # RSI analysis
        if latest_rsi > 70:
            signals.append(f"⚠️ RSI {latest_rsi:.0f} - 과매수")
            confidence -= 10
        elif latest_rsi < 30:
            signals.append(f"✅ RSI {latest_rsi:.0f} - 과매도 반등 가능")
            confidence += 15
        elif latest_rsi > 50:
            signals.append(f"✅ RSI {latest_rsi:.0f} - 상승 모멘텀")
            confidence += 5
        else:
            signals.append(f"⚠️ RSI {latest_rsi:.0f} - 하락 모멘텀")
            confidence -= 5

        # EMA200 trend
        ema200_trend = "bullish" if current_price > latest_ema200 else "bearish"
        if ema200_trend == "bullish":
            signals.append("📊 EMA200 위 - 장기 상승 추세")
            confidence += 10
        else:
            signals.append("📊 EMA200 아래 - 장기 하락 추세")
            confidence -= 10

        # Order Block analysis
        ob_nearby = False
        ob_price = None
        ob_type = None
        if ob is not None:
            ob_distance_pct = abs(current_price - ob.zone_top) / current_price * 100
            if ob_distance_pct < 5:
                ob_nearby = True
                ob_price = ob.zone_top
                ob_type = ob.direction
                if ob.direction == "buy":
                    signals.append(f"💪 Bullish OB @ {ob_price:.2f} (근접)")
                    confidence += 15
                else:
                    signals.append(f"⚠️ Bearish OB @ {ob_price:.2f} (근접)")
                    confidence -= 10

        # FVG analysis
        fvg_below = None
        for fvg in fvgs[-5:]:  # Check recent FVGs
            if fvg.direction == "buy" and fvg.gap_high < current_price:
                fvg_below = fvg.gap_high
                signals.append(f"📊 미채움 FVG @ {fvg_below:.2f} (지지)")
                confidence += 10
                break

        # Determine scenario
        scenario = ""
        if current_price <= bb1_l and ob_nearby and ob_type == "buy" and latest_rsi < 50:
            scenario = "🟢 강력 매수 시그널: BB1 하단 + Bullish OB + RSI 약세 반전"
            confidence += 15
        elif current_price >= bb3_u and latest_rsi > 70:
            scenario = "🔴 조정 시그널: BB3 과매수 + RSI 과열"
            confidence -= 10
        elif bb2_position > 0.5 and latest_rsi > 50 and ema200_trend == "bullish":
            scenario = "📈 추세 지속: BB2 상단 + RSI 강세 + EMA200 위"
        elif bb2_position < 0.5 and latest_rsi < 50 and ema200_trend == "bearish":
            scenario = "📉 하락 지속: BB2 하단 + RSI 약세 + EMA200 아래"
        else:
            scenario = "⏸️ 관망 - 명확한 시그널 대기"

        # Normalize confidence
        confidence = max(10, min(95, confidence))

        # Key levels
        entry_price = ob_price if ob_price else current_price
        stop_loss = entry_price * 0.98
        target1 = fvg_below if fvg_below and fvg_below > current_price else current_price * 1.03

        return {
            "symbol": symbol,
            "market": market,
            "current_price": current_price,
            "scenario": scenario,
            "confidence": confidence,
            "signals": signals,
            "custom_bb_status": {
                "bb1": "lower_touch" if current_price <= bb1_l else "upper_touch" if current_price >= bb1_u else "neutral",
                "bb2": "upper_half" if bb2_position > 0.5 else "lower_half",
                "bb3": "overbought" if current_price >= bb3_u else "oversold" if current_price <= bb3_l else "neutral",
                "bb2_position_pct": round(bb2_position * 100, 1),
            },
            "indicators": {
                "rsi": round(latest_rsi, 1),
                "ema200": round(latest_ema200, 2),
                "ema200_trend": ema200_trend,
            },
            "key_levels": {
                "entry": round(entry_price, 2),
                "stop_loss": round(stop_loss, 2),
                "target1": round(target1, 2),
                "bb1_lower": round(bb1_l, 2),
                "bb2_lower": round(bb2_l, 2),
                "bb3_lower": round(bb3_l, 2),
            },
            "order_block": {
                "nearby": ob_nearby,
                "price": ob_price,
                "type": ob_type,
            } if ob_nearby else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- AI Signal Alert endpoints ---

from engine.alerts import (
    detect_ai_signal,
    AISignal,
    SignalType,
    get_evaluator,
    AlertCondition,
    get_notification_service,
)
from engine.api.schemas import (
    AISignalSchema,
    AIConsensusSchema,
    PatternAlignmentSchema,
    TradingLevelsSchema,
    DetectSignalRequest,
    DetectSignalResponse,
    AlertConditionSchema,
    AlertConditionListResponse,
    InAppNotificationSchema,
    NotificationListResponse,
    MarkReadRequest,
    MarkReadResponse,
    AlertHistoryEntrySchema,
    AlertHistoryResponse,
)
import uuid


def ai_signal_to_schema(signal: AISignal) -> AISignalSchema:
    """Convert AISignal dataclass to Pydantic schema."""
    return AISignalSchema(
        symbol=signal.symbol,
        market=signal.market,
        timestamp=signal.timestamp.isoformat(),
        signal_type=signal.signal_type.value,
        confidence=signal.confidence,
        consensus=AIConsensusSchema(
            direction=signal.consensus.direction.value,
            agreement=signal.consensus.agreement,
            confidence=signal.consensus.confidence,
            directions=signal.consensus.directions,
        ),
        pattern_alignment=PatternAlignmentSchema(
            ob_aligned=signal.pattern_alignment.ob_aligned,
            fvg_aligned=signal.pattern_alignment.fvg_aligned,
            technical_confluence=signal.pattern_alignment.technical_confluence,
            description=signal.pattern_alignment.description,
        ),
        trading_levels=TradingLevelsSchema(
            entry=signal.trading_levels.entry,
            stop=signal.trading_levels.stop,
            targets=signal.trading_levels.targets,
            risk_reward=signal.trading_levels.risk_reward,
        ),
        reasoning=signal.reasoning,
        individual_predictions=signal.individual_predictions,
    )


@app.post("/api/ai/detect-signal", response_model=DetectSignalResponse)
async def detect_ai_signal_endpoint(request: DetectSignalRequest) -> DetectSignalResponse:
    """
    Detect AI signal from multiple AI predictions.

    Analyzes consensus across Technical ML, LSTM, and LH AI models.
    Checks pattern alignment with Order Blocks and FVGs.
    Returns signal type, confidence, and trading levels.
    """
    try:
        signal = detect_ai_signal(
            symbol=request.symbol,
            market=request.market,
            technical_ml_prediction=request.technical_ml_prediction,
            lstm_prediction=request.lstm_prediction,
            lh_ai_prediction=request.lh_ai_prediction,
            current_price=request.current_price,
            order_blocks=request.order_blocks,
            fvgs=request.fvgs,
        )

        # Evaluate against conditions
        evaluator = get_evaluator()
        notifications = await evaluator.evaluate_signal(signal)

        # Send notifications via notification service
        notification_service = get_notification_service()
        triggered_conditions = []

        for notification in notifications:
            # Find matching condition
            conditions = evaluator.condition_store.get_by_symbol(signal.symbol)
            for condition in conditions:
                if condition.id in notification.id:
                    await notification_service.send_notification(notification, condition)
                    triggered_conditions.append(condition.id)
                    break

        return DetectSignalResponse(
            signal=ai_signal_to_schema(signal),
            should_alert=len(notifications) > 0,
            triggered_conditions=triggered_conditions,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/alerts/conditions", response_model=AlertConditionListResponse)
def get_alert_conditions(
    user_id: str = Query("default", description="User ID"),
) -> AlertConditionListResponse:
    """Get all alert conditions for a user."""
    evaluator = get_evaluator()
    conditions = evaluator.get_conditions(user_id)

    return AlertConditionListResponse(
        conditions=[
            AlertConditionSchema(
                id=c.id,
                user_id=c.user_id,
                symbol=c.symbol,
                min_confidence=c.min_confidence,
                min_consensus=c.min_consensus,
                require_pattern=c.require_pattern,
                signal_types=c.signal_types,
                enabled=c.enabled,
                telegram=c.telegram,
                web_push=c.web_push,
                email=c.email,
                in_app=c.in_app,
                cooldown_minutes=c.cooldown_minutes,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in conditions
        ],
        total=len(conditions),
    )


@app.post("/api/alerts/conditions", response_model=AlertConditionSchema)
def create_alert_condition(
    condition: AlertConditionSchema,
) -> AlertConditionSchema:
    """Create a new alert condition."""
    evaluator = get_evaluator()

    # Generate ID if not provided
    condition_id = condition.id if condition.id else str(uuid.uuid4())

    new_condition = AlertCondition(
        id=condition_id,
        user_id=condition.user_id,
        symbol=condition.symbol,
        min_confidence=condition.min_confidence,
        min_consensus=condition.min_consensus,
        require_pattern=condition.require_pattern,
        signal_types=condition.signal_types,
        enabled=condition.enabled,
        telegram=condition.telegram,
        web_push=condition.web_push,
        email=condition.email,
        in_app=condition.in_app,
        cooldown_minutes=condition.cooldown_minutes,
    )

    created = evaluator.add_condition(new_condition)

    return AlertConditionSchema(
        id=created.id,
        user_id=created.user_id,
        symbol=created.symbol,
        min_confidence=created.min_confidence,
        min_consensus=created.min_consensus,
        require_pattern=created.require_pattern,
        signal_types=created.signal_types,
        enabled=created.enabled,
        telegram=created.telegram,
        web_push=created.web_push,
        email=created.email,
        in_app=created.in_app,
        cooldown_minutes=created.cooldown_minutes,
        created_at=created.created_at,
        updated_at=created.updated_at,
    )


@app.put("/api/alerts/conditions/{condition_id}", response_model=AlertConditionSchema)
def update_alert_condition(
    condition_id: str,
    condition: AlertConditionSchema,
) -> AlertConditionSchema:
    """Update an existing alert condition."""
    evaluator = get_evaluator()

    existing = evaluator.condition_store.get(condition_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Condition not found")

    updated_condition = AlertCondition(
        id=condition_id,
        user_id=condition.user_id or existing.user_id,
        symbol=condition.symbol,
        min_confidence=condition.min_confidence,
        min_consensus=condition.min_consensus,
        require_pattern=condition.require_pattern,
        signal_types=condition.signal_types,
        enabled=condition.enabled,
        telegram=condition.telegram,
        web_push=condition.web_push,
        email=condition.email,
        in_app=condition.in_app,
        cooldown_minutes=condition.cooldown_minutes,
        created_at=existing.created_at,
    )

    updated = evaluator.update_condition(updated_condition)

    return AlertConditionSchema(
        id=updated.id,
        user_id=updated.user_id,
        symbol=updated.symbol,
        min_confidence=updated.min_confidence,
        min_consensus=updated.min_consensus,
        require_pattern=updated.require_pattern,
        signal_types=updated.signal_types,
        enabled=updated.enabled,
        telegram=updated.telegram,
        web_push=updated.web_push,
        email=updated.email,
        in_app=updated.in_app,
        cooldown_minutes=updated.cooldown_minutes,
        created_at=updated.created_at,
        updated_at=updated.updated_at,
    )


@app.delete("/api/alerts/conditions/{condition_id}")
def delete_alert_condition(condition_id: str) -> dict:
    """Delete an alert condition."""
    evaluator = get_evaluator()

    success = evaluator.delete_condition(condition_id)
    if not success:
        raise HTTPException(status_code=404, detail="Condition not found")

    return {"success": True, "deleted_id": condition_id}


@app.get("/api/alerts/notifications", response_model=NotificationListResponse)
def get_notifications(
    user_id: str = Query("default", description="User ID"),
    limit: int = Query(50, description="Maximum notifications to return"),
    unread_only: bool = Query(False, description="Only return unread notifications"),
) -> NotificationListResponse:
    """Get in-app notifications for a user."""
    service = get_notification_service()

    if unread_only:
        notifications = service.get_unread_notifications(user_id)
    else:
        notifications = service.get_all_notifications(user_id, limit)

    unread_count = len(service.get_unread_notifications(user_id))

    return NotificationListResponse(
        notifications=[
            InAppNotificationSchema(
                id=n.id,
                user_id=n.user_id,
                symbol=n.symbol,
                market=n.market,
                title=n.title,
                body=n.body,
                emoji=n.emoji,
                signal_type=n.signal_type,
                confidence=n.confidence,
                timestamp=n.timestamp,
                read=n.read,
                dismissed=n.dismissed,
            )
            for n in notifications
        ],
        unread_count=unread_count,
        total=len(notifications),
    )


@app.post("/api/alerts/notifications/read", response_model=MarkReadResponse)
def mark_notifications_read(
    request: MarkReadRequest,
    user_id: str = Query("default", description="User ID"),
) -> MarkReadResponse:
    """Mark notifications as read."""
    service = get_notification_service()

    if request.notification_ids is None:
        # Mark all as read
        count = service.mark_all_read(user_id)
    else:
        # Mark specific notifications as read
        count = 0
        for nid in request.notification_ids:
            if service.mark_notification_read(nid):
                count += 1

    return MarkReadResponse(success=True, marked_count=count)


@app.post("/api/alerts/notifications/{notification_id}/dismiss")
def dismiss_notification(notification_id: str) -> dict:
    """Dismiss a notification."""
    service = get_notification_service()

    success = service.dismiss_notification(notification_id)
    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"success": True, "dismissed_id": notification_id}


@app.get("/api/alerts/history", response_model=AlertHistoryResponse)
def get_alert_history(
    symbol: Optional[str] = Query(None, description="Filter by symbol"),
    limit: int = Query(50, description="Maximum entries to return"),
) -> AlertHistoryResponse:
    """Get alert history."""
    evaluator = get_evaluator()

    history = evaluator.get_history(symbol, limit)

    return AlertHistoryResponse(
        history=[
            AlertHistoryEntrySchema(
                notification_id=h.notification_id,
                condition_id=h.condition_id,
                symbol=h.symbol,
                market=h.market,
                signal_type=h.signal_type,
                timestamp=h.timestamp,
                channels_sent=h.channels_sent,
            )
            for h in history
        ],
        total=len(history),
    )


# --- Price Alert endpoints ---

from engine.alerts import PriceAlert, PriceAlertType, get_price_monitor
from engine.api.schemas import (
    PriceAlertSchema,
    CreatePriceAlertRequest,
    UpdatePriceAlertRequest,
    PriceAlertListResponse,
    CheckPriceRequest,
)


@app.post("/api/alerts/price", response_model=PriceAlertSchema)
def create_price_alert(
    request: CreatePriceAlertRequest,
    user_id: str = Query("default", description="User ID"),
) -> PriceAlertSchema:
    """Create a new price alert."""
    monitor = get_price_monitor()

    # Validate alert type
    try:
        PriceAlertType(request.alert_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid alert_type. Must be one of: above, below, change_up, change_down"
        )

    alert = PriceAlert(
        id=str(uuid.uuid4()),
        user_id=user_id,
        symbol=request.symbol,
        market=request.market,
        alert_type=request.alert_type,
        threshold=request.threshold,
        reference_price=request.reference_price,
        repeating=request.repeating,
        cooldown_minutes=request.cooldown_minutes,
        notification_channels=request.notification_channels,
    )

    created = monitor.add_alert(alert)

    return PriceAlertSchema(
        id=created.id,
        user_id=created.user_id,
        symbol=created.symbol,
        market=created.market,
        alert_type=created.alert_type,
        threshold=created.threshold,
        reference_price=created.reference_price,
        enabled=created.enabled,
        repeating=created.repeating,
        cooldown_minutes=created.cooldown_minutes,
        notification_channels=created.notification_channels,
        created_at=created.created_at,
        last_triggered=created.last_triggered,
        trigger_count=created.trigger_count,
    )


@app.get("/api/alerts/price", response_model=PriceAlertListResponse)
def get_price_alerts(
    symbol: Optional[str] = Query(None, description="Filter by symbol"),
    user_id: str = Query("default", description="User ID"),
) -> PriceAlertListResponse:
    """Get price alerts for a user/symbol."""
    monitor = get_price_monitor()

    if symbol:
        alerts = monitor.get_alerts_for_symbol(symbol)
        # Filter by user
        alerts = [a for a in alerts if a.user_id == user_id]
    else:
        alerts = monitor.get_alerts_for_user(user_id)

    return PriceAlertListResponse(
        alerts=[
            PriceAlertSchema(
                id=a.id,
                user_id=a.user_id,
                symbol=a.symbol,
                market=a.market,
                alert_type=a.alert_type,
                threshold=a.threshold,
                reference_price=a.reference_price,
                enabled=a.enabled,
                repeating=a.repeating,
                cooldown_minutes=a.cooldown_minutes,
                notification_channels=a.notification_channels,
                created_at=a.created_at,
                last_triggered=a.last_triggered,
                trigger_count=a.trigger_count,
            )
            for a in alerts
        ],
        total=len(alerts),
    )


@app.put("/api/alerts/price/{alert_id}", response_model=PriceAlertSchema)
def update_price_alert(
    alert_id: str,
    request: UpdatePriceAlertRequest,
) -> PriceAlertSchema:
    """Update a price alert."""
    monitor = get_price_monitor()

    alert = monitor.get_alert(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Update fields
    if request.enabled is not None:
        alert.enabled = request.enabled
    if request.threshold is not None:
        alert.threshold = request.threshold
    if request.repeating is not None:
        alert.repeating = request.repeating
    if request.cooldown_minutes is not None:
        alert.cooldown_minutes = request.cooldown_minutes
    if request.notification_channels is not None:
        alert.notification_channels = request.notification_channels

    updated = monitor.update_alert(alert)

    return PriceAlertSchema(
        id=updated.id,
        user_id=updated.user_id,
        symbol=updated.symbol,
        market=updated.market,
        alert_type=updated.alert_type,
        threshold=updated.threshold,
        reference_price=updated.reference_price,
        enabled=updated.enabled,
        repeating=updated.repeating,
        cooldown_minutes=updated.cooldown_minutes,
        notification_channels=updated.notification_channels,
        created_at=updated.created_at,
        last_triggered=updated.last_triggered,
        trigger_count=updated.trigger_count,
    )


@app.delete("/api/alerts/price/{alert_id}")
def delete_price_alert(alert_id: str) -> dict:
    """Delete a price alert."""
    monitor = get_price_monitor()

    success = monitor.delete_alert(alert_id)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"success": True, "deleted_id": alert_id}


@app.post("/api/alerts/price/check")
async def check_price_alerts(request: CheckPriceRequest) -> dict:
    """
    Check price against all alerts for a symbol.
    Returns list of triggered alerts.
    """
    monitor = get_price_monitor()

    triggered = await monitor.check_price(
        symbol=request.symbol,
        price=request.price,
        volume=request.volume,
    )

    return {
        "symbol": request.symbol,
        "price": request.price,
        "triggered_count": len(triggered),
        "triggered_alerts": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "threshold": a.threshold,
                "trigger_count": a.trigger_count,
            }
            for a in triggered
        ],
    }


# ============================================================
# FULL MARKET SCANNER ENDPOINTS
# ============================================================


@app.post("/api/scanner/scan")
async def scan_market(
    request: ScanMarketRequest,
) -> ScanMarketResponse:
    """
    Scan a market for SMA signals using parallel processing.
    Uses cached results if available (1 hour cache).
    """
    import time
    start_time = time.time()

    scanner = get_scanner()

    # Check if we have valid cache
    cache_status = scanner.get_cache_status()
    cache_key = f"{request.market.upper()}_{','.join(sorted(request.signal_types or ['golden_cross']))}"
    cached = cache_key in cache_status and cache_status[cache_key].get("is_valid", False)
    cache_age = cache_status.get(cache_key, {}).get("cache_age_minutes", 0) if cached else 0

    # Run the scan
    results = await scanner.scan_market_parallel(
        market=request.market,
        signal_types=request.signal_types,
        force_refresh=request.force_refresh,
    )

    scan_duration = time.time() - start_time

    return ScanMarketResponse(
        market=request.market.upper(),
        symbols_scanned=len(scanner.get_market_symbols(request.market)),
        signals_found=len(results),
        scan_duration_seconds=round(scan_duration, 2),
        cached=cached and not request.force_refresh,
        cache_age_minutes=cache_age,
        results=[
            ScanResultSchema(
                symbol=r.symbol,
                market=r.market,
                signal_type=r.signal_type,
                current_price=r.current_price,
                sma20=r.sma20,
                sma200=r.sma200,
                volume=r.volume,
                volume_ratio=r.volume_ratio,
                price_change_pct=r.price_change_pct,
                detected_at=r.detected_at,
                days_since_cross=r.days_since_cross,
            )
            for r in results
        ],
    )


@app.post("/api/scanner/scan_all")
async def scan_all_markets(
    request: ScanAllMarketsRequest,
) -> ScanAllMarketsResponse:
    """
    Scan all markets (US and KR) in parallel.
    Uses cached results if available (1 hour cache).
    """
    import time
    start_time = time.time()

    scanner = get_scanner()

    # Run the scan on both markets
    all_results = await scanner.scan_all_markets(
        signal_types=request.signal_types,
        force_refresh=request.force_refresh,
    )

    scan_duration = time.time() - start_time

    us_results = all_results.get("US", [])
    kr_results = all_results.get("KR", [])

    return ScanAllMarketsResponse(
        us_results=[
            ScanResultSchema(
                symbol=r.symbol,
                market=r.market,
                signal_type=r.signal_type,
                current_price=r.current_price,
                sma20=r.sma20,
                sma200=r.sma200,
                volume=r.volume,
                volume_ratio=r.volume_ratio,
                price_change_pct=r.price_change_pct,
                detected_at=r.detected_at,
                days_since_cross=r.days_since_cross,
            )
            for r in us_results
        ],
        kr_results=[
            ScanResultSchema(
                symbol=r.symbol,
                market=r.market,
                signal_type=r.signal_type,
                current_price=r.current_price,
                sma20=r.sma20,
                sma200=r.sma200,
                volume=r.volume,
                volume_ratio=r.volume_ratio,
                price_change_pct=r.price_change_pct,
                detected_at=r.detected_at,
                days_since_cross=r.days_since_cross,
            )
            for r in kr_results
        ],
        total_signals=len(us_results) + len(kr_results),
        scan_duration_seconds=round(scan_duration, 2),
    )


@app.get("/api/scanner/cache_status")
def get_scanner_cache_status() -> ScanCacheStatusResponse:
    """Get cache status for all markets."""
    scanner = get_scanner()
    return ScanCacheStatusResponse(markets=scanner.get_cache_status())


@app.post("/api/scanner/clear_cache")
def clear_scanner_cache(market: Optional[str] = None) -> dict:
    """Clear scanner cache."""
    scanner = get_scanner()
    scanner.clear_cache(market)
    return {
        "success": True,
        "message": f"Cache cleared for {'all markets' if market is None else market}",
    }


@app.get("/api/scanner/symbols/{market}")
def get_market_symbols(market: str) -> dict:
    """Get list of symbols for a market."""
    scanner = get_scanner()
    symbols = scanner.get_market_symbols(market)
    return {
        "market": market.upper(),
        "count": len(symbols),
        "symbols": symbols,
    }


# ============================================================
# HISTORICAL DATA ENDPOINTS (PostgreSQL/TimescaleDB)
# ============================================================

from engine.data.database import (
    check_connection as db_check_connection,
    get_db_info,
    get_ohlcv,
    get_symbols as db_get_symbols,
    get_data_summary,
    get_time_bucket_ohlcv,
)
from datetime import datetime, timedelta
import pandas as pd


@app.get("/api/data/status")
def get_database_status() -> dict:
    """Get database connection status and statistics."""
    info = get_db_info()
    return {
        "connected": info.get("connected", False),
        "postgresql_version": info.get("postgresql_version", "unknown"),
        "timescaledb_version": info.get("timescaledb_version", "unknown"),
        "total_records": info.get("ohlcv_rows", 0),
        "hypertable_chunks": info.get("hypertable_chunks", 0),
        "hypertable_size": info.get("hypertable_size", "unknown"),
    }


@app.get("/api/data/symbols")
def get_available_symbols(market: Optional[str] = None) -> dict:
    """
    Get list of symbols available in the database.

    Args:
        market: Filter by market (US, KR). If None, returns all.
    """
    try:
        if market:
            symbols = db_get_symbols(market.upper())
            return {
                "market": market.upper(),
                "count": len(symbols),
                "symbols": symbols,
            }
        else:
            kr_symbols = db_get_symbols("KR")
            us_symbols = db_get_symbols("US")
            return {
                "total": len(kr_symbols) + len(us_symbols),
                "markets": {
                    "KR": {"count": len(kr_symbols), "symbols": kr_symbols},
                    "US": {"count": len(us_symbols), "symbols": us_symbols},
                }
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/data/summary")
def get_data_statistics() -> dict:
    """Get summary statistics for all data in database."""
    try:
        summary_df = get_data_summary()

        if summary_df.empty:
            return {
                "total_symbols": 0,
                "total_records": 0,
                "markets": {},
            }

        # Convert to dict format
        summary_list = []
        for _, row in summary_df.iterrows():
            summary_list.append({
                "symbol": row["symbol"],
                "market": row["market"],
                "records": int(row["rows"]),
                "first_date": row["first_date"].isoformat() if pd.notna(row["first_date"]) else None,
                "last_date": row["last_date"].isoformat() if pd.notna(row["last_date"]) else None,
                "days_span": int(row["days_span"]) if pd.notna(row["days_span"]) else 0,
            })

        # Group by market
        kr_data = [s for s in summary_list if s["market"] == "KR"]
        us_data = [s for s in summary_list if s["market"] == "US"]

        return {
            "total_symbols": len(summary_list),
            "total_records": sum(s["records"] for s in summary_list),
            "markets": {
                "KR": {
                    "symbols": len(kr_data),
                    "records": sum(s["records"] for s in kr_data),
                },
                "US": {
                    "symbols": len(us_data),
                    "records": sum(s["records"] for s in us_data),
                },
            },
            "symbols": summary_list,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/data/history/{symbol}")
def get_historical_data(
    symbol: str,
    market: str = Query("US", description="Market: US or KR"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    interval: str = Query("1d", description="Interval: 1d, 1w, 1M"),
    limit: Optional[int] = Query(None, description="Max records to return"),
) -> dict:
    """
    Get historical OHLCV data for a symbol from PostgreSQL.

    Args:
        symbol: Stock symbol (e.g., AAPL, 005930)
        market: Market code (US or KR)
        start_date: Start date filter (YYYY-MM-DD)
        end_date: End date filter (YYYY-MM-DD)
        interval: Data interval (1d=daily, 1w=weekly, 1M=monthly)
        limit: Maximum number of records

    Returns:
        OHLCV data array with metadata
    """
    try:
        # Parse dates
        start_dt = datetime.strptime(start_date, "%Y-%m-%d") if start_date else None
        end_dt = datetime.strptime(end_date, "%Y-%m-%d") if end_date else None

        # Map interval to TimescaleDB bucket
        bucket_map = {
            "1d": "1 day",
            "1w": "1 week",
            "1M": "1 month",
            "1h": "1 hour",
        }
        bucket = bucket_map.get(interval, "1 day")

        # Query data
        if interval == "1d":
            df = get_ohlcv(symbol.upper(), market.upper(), start_dt, end_dt, limit)
        else:
            df = get_time_bucket_ohlcv(symbol.upper(), market.upper(), bucket, start_dt, end_dt)
            if limit and len(df) > limit:
                df = df.tail(limit)

        if df.empty:
            return {
                "symbol": symbol.upper(),
                "market": market.upper(),
                "interval": interval,
                "count": 0,
                "data": [],
            }

        # Convert to response format
        data = []
        for timestamp, row in df.iterrows():
            data.append({
                "timestamp": timestamp.isoformat(),
                "open": round(float(row["open"]), 2),
                "high": round(float(row["high"]), 2),
                "low": round(float(row["low"]), 2),
                "close": round(float(row["close"]), 2),
                "volume": int(row["volume"]),
            })

        return {
            "symbol": symbol.upper(),
            "market": market.upper(),
            "interval": interval,
            "count": len(data),
            "start_date": data[0]["timestamp"] if data else None,
            "end_date": data[-1]["timestamp"] if data else None,
            "data": data,
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/data/sma/{symbol}")
def get_sma_data(
    symbol: str,
    market: str = Query("US", description="Market: US or KR"),
    periods: str = Query("20,50,200", description="SMA periods (comma-separated)"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    limit: int = Query(500, description="Max records to return"),
) -> dict:
    """
    Get historical data with SMA calculations.

    Args:
        symbol: Stock symbol
        market: Market code (US or KR)
        periods: Comma-separated SMA periods (e.g., "20,50,200")
        start_date: Start date filter
        end_date: End date filter
        limit: Maximum records

    Returns:
        OHLCV data with SMA values
    """
    try:
        # Parse periods
        sma_periods = [int(p.strip()) for p in periods.split(",")]

        # Parse dates
        start_dt = datetime.strptime(start_date, "%Y-%m-%d") if start_date else None
        end_dt = datetime.strptime(end_date, "%Y-%m-%d") if end_date else None

        # Need extra data for SMA calculation
        max_period = max(sma_periods)

        # Get data
        df = get_ohlcv(symbol.upper(), market.upper(), start_dt, end_dt)

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data found for {symbol}")

        # Calculate SMAs
        for period in sma_periods:
            df[f"sma{period}"] = df["close"].rolling(window=period).mean()

        # Trim to requested limit (from end)
        if limit and len(df) > limit:
            df = df.tail(limit)

        # Convert to response format
        data = []
        for timestamp, row in df.iterrows():
            item = {
                "timestamp": timestamp.isoformat(),
                "open": round(float(row["open"]), 2),
                "high": round(float(row["high"]), 2),
                "low": round(float(row["low"]), 2),
                "close": round(float(row["close"]), 2),
                "volume": int(row["volume"]),
            }
            # Add SMA values
            for period in sma_periods:
                sma_val = row[f"sma{period}"]
                item[f"sma{period}"] = round(float(sma_val), 2) if pd.notna(sma_val) else None
            data.append(item)

        return {
            "symbol": symbol.upper(),
            "market": market.upper(),
            "sma_periods": sma_periods,
            "count": len(data),
            "data": data,
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid parameter: {e}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# TRADING BOT ENDPOINTS (Phase 6)
# ============================================================

from pydantic import BaseModel
from typing import List as PyList

# Global trading bot instance
_trading_bot = None
_trading_task = None


class TradingStartRequest(BaseModel):
    """Request to start trading bot"""
    interval_minutes: int = 5
    symbols: PyList[str] = ["005930", "000660"]
    market: str = "KR"
    stop_loss: float = 2.0
    take_profit: float = 5.0
    position_size: int = 10
    min_confluence: int = 80
    entry_mode: str = "MARKET"  # MARKET or LIMIT
    limit_price: float = 0  # Target price for LIMIT mode
    use_real: bool = False  # SAFETY: Default to paper trading


@app.post("/api/trading/start")
async def start_trading(request: TradingStartRequest):
    """
    Start automated trading bot

    SAFETY: Defaults to paper trading mode
    """
    global _trading_bot, _trading_task

    if _trading_bot and _trading_bot.running:
        raise HTTPException(400, "Trading bot already running")

    try:
        from engine.trading.bot import TradingBot

        # Create bot (default: paper trading)
        _trading_bot = TradingBot(use_real_account=request.use_real)
        _trading_bot.set_check_interval(request.interval_minutes)
        _trading_bot.set_strategy_params(
            stop_loss=request.stop_loss,
            take_profit=request.take_profit,
            position_size=request.position_size,
            min_confluence=request.min_confluence
        )
        _trading_bot.set_entry_mode(request.entry_mode, request.limit_price)

        # Add symbols
        for symbol in request.symbols:
            _trading_bot.strategy.add_symbol(symbol, request.market)

        # Start bot in background task
        _trading_task = asyncio.create_task(_trading_bot.start())

        return {
            "status": "started",
            "message": f"Trading bot started ({'REAL' if request.use_real else 'PAPER'})",
            "config": _trading_bot.get_status()
        }

    except Exception as e:
        raise HTTPException(500, f"Failed to start trading bot: {e}")


@app.post("/api/trading/stop")
async def stop_trading():
    """Stop automated trading bot"""
    global _trading_bot, _trading_task

    if not _trading_bot or not _trading_bot.running:
        raise HTTPException(400, "Trading bot not running")

    _trading_bot.stop()

    # Cancel the background task
    if _trading_task:
        _trading_task.cancel()
        try:
            await _trading_task
        except asyncio.CancelledError:
            pass
        _trading_task = None

    final_status = _trading_bot.get_status()
    _trading_bot = None

    return {
        "status": "stopped",
        "message": "Trading bot stopped",
        "final_status": final_status
    }


@app.get("/api/trading/status")
async def get_trading_status():
    """Get trading bot status"""
    global _trading_bot

    if not _trading_bot:
        return {
            "running": False,
            "is_real": False,
            "positions": {},
            "total_pnl": 0,
            "order_count": 0,
            "monitored_symbols": [],
            "strategy_params": {
                "stop_loss": 2.0,
                "take_profit": 5.0,
                "position_size": 10,
                "min_confluence": 80
            }
        }

    return _trading_bot.get_status()


@app.get("/api/trading/positions")
async def get_trading_positions():
    """Get current trading positions with P&L"""
    global _trading_bot

    if not _trading_bot:
        return []

    positions = _trading_bot.om.get_all_positions()

    result = []
    for symbol, pos in positions.items():
        market = pos.get('market', 'KR')
        current_price = _trading_bot.om._get_current_price(symbol, market)
        avg_price = pos['avg_price']
        quantity = pos['quantity']

        pnl = (current_price - avg_price) * quantity
        pnl_pct = ((current_price - avg_price) / avg_price * 100) if avg_price > 0 else 0

        result.append({
            "symbol": symbol,
            "market": market,
            "quantity": quantity,
            "avg_price": avg_price,
            "current_price": current_price,
            "pnl": pnl,
            "pnl_pct": pnl_pct
        })

    return result


@app.get("/api/trading/orders")
async def get_trading_orders(limit: int = 50):
    """Get order history"""
    global _trading_bot

    if not _trading_bot:
        return []

    return _trading_bot.om.get_order_history(limit)


@app.get("/api/trading/trades")
async def get_trade_history(limit: int = 50):
    """Get trade history with P&L"""
    global _trading_bot

    if not _trading_bot:
        return []

    return _trading_bot.strategy.get_trade_history(limit)


@app.post("/api/trading/add-symbol")
async def add_trading_symbol(symbol: str = Query(...), market: str = Query("KR")):
    """Add symbol to monitoring list"""
    global _trading_bot

    if not _trading_bot:
        raise HTTPException(400, "Trading bot not running")

    _trading_bot.strategy.add_symbol(symbol, market)

    return {
        "status": "added",
        "symbol": symbol,
        "market": market,
        "monitored_symbols": _trading_bot.strategy.get_symbols()
    }


@app.post("/api/trading/remove-symbol")
async def remove_trading_symbol(symbol: str = Query(...)):
    """Remove symbol from monitoring list"""
    global _trading_bot

    if not _trading_bot:
        raise HTTPException(400, "Trading bot not running")

    _trading_bot.strategy.remove_symbol(symbol)

    return {
        "status": "removed",
        "symbol": symbol,
        "monitored_symbols": _trading_bot.strategy.get_symbols()
    }


@app.get("/api/trading/account-info")
async def get_account_info():
    """
    Get account information from environment
    Returns masked account number for security
    """
    # Check both possible env var names
    account_number = os.getenv('KIS_ACCOUNT_NO', '') or os.getenv('KIS_ACCOUNT_NUMBER', '')
    account_type = os.getenv('KIS_ACCOUNT_TYPE', '01')
    use_mock = os.getenv('KIS_USE_MOCK', 'true').lower() == 'true'

    if not account_number:
        return {
            'connected': False,
            'account_number_masked': None,
            'account_type': None,
            'account_type_name': None,
            'mode': 'mock'
        }

    # Mask account number for security
    # Example: 43912468-01 -> ****8-01
    if len(account_number) >= 8:
        masked = '*' * (len(account_number) - 4) + account_number[-4:]
    else:
        masked = account_number

    return {
        'connected': True,
        'account_number_masked': masked,
        'account_type': account_type,
        'account_type_name': '종합계좌' if account_type == '01' else '위탁계좌',
        'mode': 'mock' if use_mock else 'real'
    }


# ============================================================================
# REAL-TIME DATA API
# ============================================================================

def get_realtime_db_conn():
    """Get database connection for real-time data"""
    import psycopg2
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        conn = psycopg2.connect(db_url)
        return conn
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")


@app.get("/api/realtime/price/{symbol}")
async def get_realtime_price(
    symbol: str,
    market: str = Query(default="KR", description="Market: KR or US")
):
    """
    Get latest real-time price for a symbol

    Returns the most recent tick data from the real-time collector.
    Returns null price if no data available (instead of error) to prevent frontend spam.
    """
    try:
        conn = get_realtime_db_conn()
    except Exception:
        # Database not available - return null response instead of error
        return {
            "symbol": symbol.upper(),
            "market": market.upper(),
            "price": None,
            "volume": 0,
            "timestamp": None,
            "is_extended_hours": False,
            "error": "realtime_db_unavailable"
        }

    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT price, volume, timestamp_utc, is_extended_hours
            FROM realtime_ticks
            WHERE symbol = %s AND market = %s
            ORDER BY timestamp_utc DESC
            LIMIT 1
        """, (symbol.upper(), market.upper()))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            # Return null response instead of 404 to prevent frontend retry spam
            return {
                "symbol": symbol.upper(),
                "market": market.upper(),
                "price": None,
                "volume": 0,
                "timestamp": None,
                "is_extended_hours": False,
                "error": "no_data"
            }

        return {
            "symbol": symbol.upper(),
            "market": market.upper(),
            "price": float(row[0]),
            "volume": int(row[1]) if row[1] else 0,
            "timestamp": row[2].isoformat() if row[2] else None,
            "is_extended_hours": row[3] if row[3] is not None else False
        }
    except Exception as e:
        try:
            conn.close()
        except:
            pass
        # Return null response with error info instead of 500
        return {
            "symbol": symbol.upper(),
            "market": market.upper(),
            "price": None,
            "volume": 0,
            "timestamp": None,
            "is_extended_hours": False,
            "error": str(e)[:100]
        }


@app.get("/api/realtime/latest")
async def get_latest_prices(
    market: Optional[str] = Query(default=None, description="Filter by market: KR or US"),
    limit: int = Query(default=200, ge=1, le=500, description="Max number of results")
):
    """
    Get latest real-time prices for all symbols

    Returns the most recent tick for each symbol.
    """
    conn = get_realtime_db_conn()
    try:
        cur = conn.cursor()

        market_filter = "AND market = %s" if market else ""
        params = [market.upper()] if market else []

        query = f"""
            SELECT DISTINCT ON (symbol, market)
                symbol, market, price, volume, timestamp_utc, is_extended_hours
            FROM realtime_ticks
            WHERE timestamp_utc > NOW() - INTERVAL '10 minutes'
            {market_filter}
            ORDER BY symbol, market, timestamp_utc DESC
            LIMIT %s
        """
        params.append(limit)

        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "count": len(rows),
            "prices": [
                {
                    "symbol": row[0],
                    "market": row[1],
                    "price": float(row[2]),
                    "volume": int(row[3]) if row[3] else 0,
                    "timestamp": row[4].isoformat() if row[4] else None,
                    "is_extended_hours": row[5] if row[5] is not None else False
                }
                for row in rows
            ]
        }
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/realtime/candles/{symbol}")
async def get_realtime_candles(
    symbol: str,
    market: str = Query(default="KR", description="Market: KR or US"),
    timeframe: str = Query(default="1min", description="Timeframe: 1min, 5min, 15min, 1h, 1D"),
    limit: int = Query(default=100, ge=1, le=500, description="Number of candles")
):
    """
    Get real-time OHLC candles for a symbol

    Returns candles built from real-time tick data.
    """
    valid_timeframes = ['1min', '5min', '15min', '1h', '1D']
    if timeframe not in valid_timeframes:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe. Use: {valid_timeframes}")

    conn = get_realtime_db_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT timestamp, open, high, low, close, volume
            FROM ohlcv_candles
            WHERE symbol = %s AND market = %s AND timeframe = %s
            ORDER BY timestamp DESC
            LIMIT %s
        """, (symbol.upper(), market.upper(), timeframe, limit))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        # Return in chronological order
        candles = [
            {
                "time": row[0].isoformat() if row[0] else None,
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": int(row[5]) if row[5] else 0
            }
            for row in reversed(rows)
        ]

        return {
            "symbol": symbol.upper(),
            "market": market.upper(),
            "timeframe": timeframe,
            "count": len(candles),
            "candles": candles
        }
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/realtime/status")
async def get_realtime_status():
    """
    Get real-time data collection status

    Returns statistics about the real-time data collection.
    """
    conn = get_realtime_db_conn()
    try:
        cur = conn.cursor()

        # Get recent tick stats
        cur.execute("""
            SELECT
                market,
                COUNT(DISTINCT symbol) as symbols,
                COUNT(*) as ticks,
                MIN(timestamp_utc) as oldest,
                MAX(timestamp_utc) as newest
            FROM realtime_ticks
            WHERE timestamp_utc > NOW() - INTERVAL '5 minutes'
            GROUP BY market
        """)
        tick_stats = {}
        for row in cur.fetchall():
            tick_stats[row[0]] = {
                "symbols": row[1],
                "ticks_5min": row[2],
                "oldest": row[3].isoformat() if row[3] else None,
                "newest": row[4].isoformat() if row[4] else None
            }

        # Get candle stats
        cur.execute("""
            SELECT
                timeframe,
                COUNT(*) as candles,
                MAX(timestamp) as latest
            FROM ohlcv_candles
            WHERE timestamp > NOW() - INTERVAL '1 hour'
            GROUP BY timeframe
        """)
        candle_stats = {}
        for row in cur.fetchall():
            candle_stats[row[0]] = {
                "candles_1h": row[1],
                "latest": row[2].isoformat() if row[2] else None
            }

        cur.close()
        conn.close()

        return {
            "status": "running" if tick_stats else "no_recent_data",
            "ticks": tick_stats,
            "candles": candle_stats
        }
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# DIRECT KIS API CHART DATA - Bypasses database for accuracy
# ============================================================

@app.get("/api/kis/history/{symbol}")
def get_kis_history_direct(
    symbol: str,
    market: str = Query("KR", description="Market: KR or US"),
    count: int = Query(100, description="Number of bars to fetch"),
):
    """
    Get chart data DIRECTLY from KIS API - bypasses database.

    This endpoint fetches fresh OHLCV data directly from Korea Investment
    Securities API, ensuring accurate and up-to-date chart data.

    Use this when you need guaranteed fresh data without database caching.

    Args:
        symbol: Stock symbol (e.g., "005930" for Samsung, "AAPL" for Apple)
        market: Market code - "KR" for Korean, "US" for US stocks
        count: Number of daily bars to fetch (default 100)

    Returns:
        Dict with bars array ready for charting:
        {
            "symbol": "005930",
            "market": "KR",
            "timeframe": "1D",
            "count": 100,
            "bars": [{"time": "2026-02-01", "open": 100, "high": 110, ...}, ...],
            "source": "kis_api_direct"
        }
    """
    market = market.upper()
    symbol = symbol.upper()

    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    try:
        client = get_kis_client()

        if not client.is_configured:
            raise HTTPException(
                status_code=503,
                detail="KIS API not configured. Set KIS_APP_KEY and KIS_APP_SECRET environment variables."
            )

        if market == "KR":
            result = client.get_daily_chart(symbol, count)
        else:
            result = client.get_daily_chart_us(symbol, count)

        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])

        return result

    except KISAPIError as e:
        raise HTTPException(status_code=502, detail=f"KIS API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")
