"""FastAPI application for LiquidityHunter Phase 2."""

from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from engine.core.orderblock import detect_orderblock, OrderBlock
from engine.core.screener import screen_watchlist, ScreenResult
from engine.api.data import load_csv, OHLCVData
from engine.api.schemas import (
    AnalyzeResponse,
    ReplayResponse,
    OrderBlockSchema,
    FVGSchema,
    ValidationDetails,
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
)
from engine.core.screener import ema, rsi, macd

app = FastAPI(
    title="LiquidityHunter",
    description="Phase 2: Order Block Detection API",
    version="0.1.0",
)

# Add CORS middleware for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ob_to_schema(ob: OrderBlock) -> OrderBlockSchema:
    """Convert OrderBlock dataclass to Pydantic schema."""
    fvg_schema = None
    if ob.fvg is not None:
        fvg_schema = FVGSchema(
            index=ob.fvg.index,
            direction=ob.fvg.direction.value,
            gap_high=ob.fvg.gap_high,
            gap_low=ob.fvg.gap_low,
        )

    return OrderBlockSchema(
        index=ob.index,
        direction=ob.direction.value,
        zone_top=float(ob.zone_top),
        zone_bottom=float(ob.zone_bottom),
        displacement_index=ob.displacement_index,
        has_fvg=ob.has_fvg,
        fvg=fvg_schema,
    )


def analyze_at_bar(data: OHLCVData, bar_index: int) -> AnalyzeResponse:
    """
    Analyze order block at a specific bar index.

    This is the core analysis function used by both /analyze and /replay.

    Args:
        data: OHLCV data
        bar_index: Bar index to analyze up to (inclusive)

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

    current_price = float(close[-1])

    # Detect order block
    ob = detect_orderblock(open_, high, low, close)

    if ob is None:
        return AnalyzeResponse(
            bar_index=bar_index,
            current_price=current_price,
            current_valid_ob=None,
            validation_details=ValidationDetails(
                has_displacement=False,
                has_fvg=False,
                is_fresh=False,
            ),
            reason_code="NO_VALID_OB",
        )

    return AnalyzeResponse(
        bar_index=bar_index,
        current_price=current_price,
        current_valid_ob=_ob_to_schema(ob),
        validation_details=ValidationDetails(
            has_displacement=True,
            has_fvg=ob.has_fvg,
            is_fresh=True,  # If OB is returned, it passed freshness check
        ),
        reason_code="OK",
    )


@app.get("/analyze", response_model=AnalyzeResponse)
def analyze(
    symbol: str = Query(..., description="Symbol name"),
    tf: str = Query(..., description="Timeframe"),
    bar_index: int = Query(..., description="Bar index to analyze"),
    market: str = Query("", description="Market (KR/US) for data directory"),
) -> AnalyzeResponse:
    """
    Analyze order block at a specific bar index.

    Returns the current valid order block (if any) and validation details.
    """
    try:
        data_dir = f"data/{market.lower()}" if market else "data"
        data = load_csv(symbol, tf, data_dir=data_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        return analyze_at_bar(data, bar_index)
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


# --- OHLCV endpoint (Phase 3.2) ---

@app.get("/ohlcv", response_model=OHLCVResponse)
def get_ohlcv(
    symbol: str = Query(..., description="Symbol name"),
    market: str = Query("KR", description="Market: KR or US"),
    tf: str = Query("1D", description="Timeframe"),
) -> OHLCVResponse:
    """
    Get OHLCV data with EMA indicators for charting.

    Returns bars array with dates and EMA20/EMA200 values.
    """
    market = market.upper()
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="Market must be KR or US")

    try:
        data_dir = f"data/{market.lower()}"
        data = load_csv(symbol, tf, data_dir=data_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Build bars list
    bars = []
    for i in range(len(data.close)):
        bars.append(OHLCVBar(
            time=data.timestamps[i],
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

    # Convert to list, replacing NaN with 0 for JSON
    ema20_list = [float(v) if not np.isnan(v) else 0 for v in ema20_values]
    ema200_list = [float(v) if not np.isnan(v) else 0 for v in ema200_values]
    rsi_list = [float(v) if not np.isnan(v) else 0 for v in rsi_values]
    macd_line_list = [float(v) if not np.isnan(v) else 0 for v in macd_line_values]
    macd_signal_list = [float(v) if not np.isnan(v) else 0 for v in macd_signal_values]
    macd_histogram_list = [float(v) if not np.isnan(v) else 0 for v in macd_histogram_values]

    return OHLCVResponse(
        symbol=symbol,
        market=market,
        timeframe=tf,
        bars=bars,
        ema20=ema20_list,
        ema200=ema200_list,
        rsi=rsi_list,
        macd_line=macd_line_list,
        macd_signal=macd_signal_list,
        macd_histogram=macd_histogram_list,
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
