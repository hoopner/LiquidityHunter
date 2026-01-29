"""FastAPI application for LiquidityHunter Phase 2."""

from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
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
from engine.indicators.dynamic_manager import DynamicIndicatorManager
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
)
from engine.core.screener import ema, rsi, macd
from engine.strategy.backtest import run_backtest

app = FastAPI(
    title="LiquidityHunter",
    description="Phase 2: Order Block Detection API",
    version="0.1.0",
)

# Add CORS middleware for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
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
    try:
        data_dir = f"data/{market.lower()}" if market else "data"
        data = load_csv(symbol, tf, data_dir=data_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

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
    refresh: bool = Query(False, description="Force refresh from yfinance"),
    limit: int = Query(0, description="Max bars to return (0=auto based on timeframe)"),
) -> OHLCVResponse:
    """
    Get OHLCV data with indicators for charting.

    Supports all timeframes: 1m, 5m, 15m, 1h, 1D, 1W, 1M
    Data is automatically fetched from yfinance if not cached.

    Returns bars array with dates and indicator values.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    try:
        # Use load_with_refresh for dynamic data fetching
        data = load_with_refresh(symbol, market, tf, data_dir="data", force_refresh=refresh)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Apply default limits based on timeframe to prevent browser crashes
    default_limits = {
        "1m": 500,   # ~1 day of trading
        "5m": 500,   # ~2 days
        "15m": 500,  # ~5 days
        "30m": 500,  # ~10 days
        "1h": 500,   # ~3 weeks
        "1H": 500,
        "4h": 500,   # ~3 months
        "4H": 500,
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
    # For intraday timeframes, convert to Unix timestamp (lightweight-charts requirement)
    is_intraday = tf in ("1m", "5m", "15m", "30m", "1h", "1H", "4h", "4H")
    bars = []
    for i in range(len(data.close)):
        time_val = data.timestamps[i]
        # Convert intraday datetime strings to Unix timestamp
        if is_intraday and " " in time_val:
            from datetime import datetime
            try:
                dt = datetime.strptime(time_val, "%Y-%m-%d %H:%M:%S")
                time_val = int(dt.timestamp())
            except ValueError:
                pass  # Keep original if parsing fails
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

    # Convert to list, replacing NaN with None for EMAs (so frontend skips them)
    ema20_list = [float(v) if not np.isnan(v) else None for v in ema20_values]
    ema200_list = [float(v) if not np.isnan(v) else None for v in ema200_values]
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

    return OHLCVResponse(
        symbol=symbol,
        market=market,
        timeframe=tf,
        bars=bars,
        ema20=ema20_list,
        ema200=ema200_list,
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

    # Download data using yfinance
    try:
        import yfinance as yf
        from datetime import datetime, timedelta

        # Determine ticker format
        if market == "KR":
            ticker = f"{symbol}.KS"
        else:
            ticker = symbol

        end_date = datetime.now()
        start_date = end_date - timedelta(days=500)

        stock = yf.Ticker(ticker)
        df = stock.history(start=start_date, end=end_date)

        if df.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No data found for {symbol} in {market} market"
            )

        # Save to CSV
        df = df.reset_index()
        df = df[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')

        data_dir = DATA_DIR / market.lower()
        data_dir.mkdir(parents=True, exist_ok=True)
        data_path = data_dir / f"{symbol}_1D.csv"
        df.to_csv(data_path, index=False)

        bar_count = len(df)

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="yfinance not installed. Run: pip install yfinance"
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
