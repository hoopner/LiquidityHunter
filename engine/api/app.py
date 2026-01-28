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
    calculate_confluence,
    calculate_atr,
)
from engine.core.screener import screen_watchlist, ScreenResult
from engine.core.volume_profile import calculate_volume_profile
from engine.api.data import load_csv, OHLCVData
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


def _fvg_to_schema(fvg: FVG) -> FVGSchema:
    """Convert FVG dataclass to Pydantic schema."""
    return FVGSchema(
        index=fvg.index,
        direction=fvg.direction.value,
        gap_high=fvg.gap_high,
        gap_low=fvg.gap_low,
    )


def analyze_at_bar(data: OHLCVData, bar_index: int) -> AnalyzeResponse:
    """
    Analyze order block and FVGs at a specific bar index.

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
        )

    return AnalyzeResponse(
        bar_index=bar_index,
        current_price=current_price,
        current_valid_ob=_ob_to_schema(ob),
        fvgs=fvg_schemas,
        validation_details=ValidationDetails(
            has_displacement=True,
            has_fvg=len(fvgs) > 0,
            is_fresh=True,  # If OB is returned, it passed freshness check
        ),
        reason_code="OK",
        confluence=confluence_schema,
        atr=atr_value,
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
