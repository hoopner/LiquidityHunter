"""FastAPI application for LiquidityHunter Phase 2."""

from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query

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
)

app = FastAPI(
    title="LiquidityHunter",
    description="Phase 2: Order Block Detection API",
    version="0.1.0",
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
