"""Pydantic schemas for API responses."""

from typing import List, Literal, Optional, Union

from pydantic import BaseModel


class FVGSchema(BaseModel):
    """Fair Value Gap schema."""
    index: int
    direction: str
    gap_high: float
    gap_low: float


class RetestSignalSchema(BaseModel):
    """Retest signal schema."""
    retest_active: bool
    direction: str = ""  # "bull" or "bear"
    distance_pct: float = 0.0  # Distance from OB mid as percentage
    volume_confirm: float = 0.0  # Current vol / avg vol ratio
    entry_price: float = 0.0
    ob_strength: int = 0  # Volumatic score of the OB
    signal_type: str = ""  # "retest_long" or "retest_short"


class OrderBlockSchema(BaseModel):
    """Order Block schema."""
    index: int
    direction: str
    zone_top: float
    zone_bottom: float
    displacement_index: int
    has_fvg: bool
    fvg: Optional[FVGSchema] = None
    # Volume analysis
    volume_strength: str = "normal"  # "strong", "normal", "weak"
    volume_ratio: float = 1.0  # displacement_volume / avg_volume
    # Volumatic strategy fields
    age_candles: int = 0
    age_status: str = "fresh"  # "fresh", "mature", "aged"
    fvg_fresh: bool = False
    volumatic_score: int = 0
    # Retest signal
    retest_signal: Optional[RetestSignalSchema] = None


class ValidationDetails(BaseModel):
    """Validation details for the analysis."""
    has_displacement: bool
    has_fvg: bool
    is_fresh: bool


class ConfluenceSchema(BaseModel):
    """Confluence analysis result."""
    has_confluence: bool
    score: int  # 0-100
    ob_score: int
    fvg_score: int
    overlap_bonus: int
    proximity_bonus: int
    reason: str
    details: dict = {}


class ActiveSignalSchema(BaseModel):
    """Active trading signal schema."""
    type: str  # "retest_long", "retest_short"
    price: float
    ob_strength: int
    volume_confirm: float
    direction: str  # "bull", "bear"


class AnalyzeResponse(BaseModel):
    """Response schema for /analyze endpoint."""
    bar_index: int
    current_price: float
    current_valid_ob: Optional[OrderBlockSchema] = None
    fvgs: List[FVGSchema] = []  # Independent FVGs
    validation_details: ValidationDetails
    reason_code: Literal["OK", "NO_VALID_OB"]
    # Confluence scoring
    confluence: Optional[ConfluenceSchema] = None
    atr: Optional[float] = None
    # Volume filtering
    filtered_weak_obs: int = 0  # Count of weak OBs filtered out
    # Active trading signals
    signals: List[ActiveSignalSchema] = []  # Active retest signals
    # Williams %R indicator
    williams_r: Optional["WilliamsRSignal"] = None


class ReplayResponse(BaseModel):
    """Response schema for /replay endpoint."""
    frames: List[AnalyzeResponse]


class ScreenResultSchema(BaseModel):
    """Screening result for a single symbol."""
    symbol: str
    market: str
    last_close: float
    ema20: float
    ema200: float
    gap: float
    slope_diff: float
    days_to_cross: Optional[int]
    score: int
    reason: str


class ScreenResponse(BaseModel):
    """Response schema for /screen endpoint."""
    market: str
    candidates: List[ScreenResultSchema]


class ScreenAllResponse(BaseModel):
    """Response schema for /screen_all endpoint."""
    kr_candidates: List[ScreenResultSchema]
    us_candidates: List[ScreenResultSchema]


class OHLCVBar(BaseModel):
    """Single OHLCV bar."""
    time: Union[str, int]  # ISO date string YYYY-MM-DD or Unix timestamp for intraday
    open: float
    high: float
    low: float
    close: float
    volume: float


class OHLCVResponse(BaseModel):
    """Response schema for /ohlcv endpoint."""
    symbol: str
    market: str
    timeframe: str
    bars: List[OHLCVBar]
    ema20: List[Optional[float]]  # None for initial bars before EMA converges
    ema200: List[Optional[float]]  # None for initial bars before EMA converges
    rsi: List[float]
    rsi_signal: List[float] = []  # RSI Signal(9) - SMA of RSI
    macd_line: List[float]
    macd_signal: List[float]
    macd_histogram: List[float]
    # 3 Stochastic indicators with different timeframes
    stoch_slow_k: List[float] = []  # Stoch Slow (20,12,12) %K
    stoch_slow_d: List[float] = []  # Stoch Slow (20,12,12) %D
    stoch_med_k: List[float] = []   # Stoch Medium (10,6,6) %K
    stoch_med_d: List[float] = []   # Stoch Medium (10,6,6) %D
    stoch_fast_k: List[float] = []  # Stoch Fast (5,3,3) %K
    stoch_fast_d: List[float] = []  # Stoch Fast (5,3,3) %D
    # Bollinger Bands
    bb1_upper: List[float] = []    # BB1 (20, 0.5) - Tight - Green
    bb1_middle: List[float] = []
    bb1_lower: List[float] = []
    bb2_upper: List[float] = []    # BB2 (20, 3.0) - Wide - Red
    bb2_middle: List[float] = []
    bb2_lower: List[float] = []
    # RSI with Bollinger Band (for subchart)
    rsi_bb_upper: List[float] = []  # BB(30, 2.0) applied to RSI
    rsi_bb_middle: List[float] = []
    rsi_bb_lower: List[float] = []
    # VWAP (Volume Weighted Average Price)
    vwap: List[float] = []  # VWAP with daily reset (intraday only)
    # Keltner Channel
    kc_upper: List[float] = []   # EMA(20) + ATR(10) * 1.5
    kc_middle: List[float] = []  # EMA(20)
    kc_lower: List[float] = []   # EMA(20) - ATR(10) * 1.5
    # TTM Squeeze
    squeeze: List[bool] = []  # True = squeeze ON (BB inside KC), False = squeeze OFF


# --- Williams %R schemas ---

class WilliamsRSignal(BaseModel):
    """Williams %R signal data."""
    value: float  # Current %R value (-100 to 0)
    zone: str  # "extreme_overbought", "overbought", "neutral", "oversold", "extreme_oversold"
    signal: str  # "buy", "sell", "neutral"
    strength: float  # 0-10 scale
    divergence: Optional[str] = None  # "bullish", "bearish"
    cross_direction: Optional[str] = None  # "up", "down"
    ob_bonus: int = 0  # Bonus points for OB confluence
    summary: str = ""


# --- Watchlist schemas ---

class WatchlistItem(BaseModel):
    """Single watchlist item."""
    symbol: str
    market: str
    has_data: bool
    bar_count: int


class WatchlistResponse(BaseModel):
    """Response for GET /watchlist."""
    market: str
    symbols: List[WatchlistItem]


class AddSymbolRequest(BaseModel):
    """Request body for POST /watchlist/add."""
    symbol: str
    market: str


class AddSymbolResponse(BaseModel):
    """Response for POST /watchlist/add."""
    success: bool
    symbol: str
    market: str
    message: str
    bar_count: int


class RemoveSymbolRequest(BaseModel):
    """Request body for DELETE /watchlist/remove."""
    symbol: str
    market: str


class RemoveSymbolResponse(BaseModel):
    """Response for DELETE /watchlist/remove."""
    success: bool
    symbol: str
    market: str
    message: str


# --- Portfolio schemas ---

class PortfolioHolding(BaseModel):
    """Single portfolio holding."""
    symbol: str
    market: str
    quantity: float
    avg_price: float
    buy_date: str  # ISO date string YYYY-MM-DD


class PortfolioHoldingWithPnL(BaseModel):
    """Portfolio holding with current price and P&L."""
    symbol: str
    market: str
    quantity: float
    avg_price: float
    buy_date: str
    current_price: float
    pnl_amount: float  # Total P&L amount
    pnl_percent: float  # P&L percentage
    total_value: float  # Current total value


class PortfolioResponse(BaseModel):
    """Response for GET /portfolio."""
    holdings: List[PortfolioHoldingWithPnL]
    total_kr_value: float
    total_us_value: float
    total_kr_pnl: float
    total_us_pnl: float


class AddHoldingRequest(BaseModel):
    """Request body for POST /portfolio/add."""
    symbol: str
    market: str
    quantity: float
    avg_price: float
    buy_date: Optional[str] = None  # Defaults to today


class AddHoldingResponse(BaseModel):
    """Response for POST /portfolio/add."""
    success: bool
    message: str
    holding: Optional[PortfolioHolding] = None


class UpdateHoldingRequest(BaseModel):
    """Request body for POST /portfolio/update."""
    symbol: str
    market: str
    quantity: Optional[float] = None
    avg_price: Optional[float] = None


class UpdateHoldingResponse(BaseModel):
    """Response for POST /portfolio/update."""
    success: bool
    message: str
    holding: Optional[PortfolioHolding] = None


class RemoveHoldingRequest(BaseModel):
    """Request body for DELETE /portfolio/remove."""
    symbol: str
    market: str


class RemoveHoldingResponse(BaseModel):
    """Response for DELETE /portfolio/remove."""
    success: bool
    message: str


# --- Volume Profile schemas ---

class VolumeProfileBin(BaseModel):
    """Single bin in volume profile histogram."""
    price: float
    volume: float
    percent: float  # Percentage of max volume (for bar width)
    in_value_area: bool


class VolumeProfileResponse(BaseModel):
    """Response for GET /volume_profile endpoint."""
    symbol: str
    market: str
    timeframe: str
    poc_price: float          # Point of Control - price with highest volume
    vah_price: float          # Value Area High
    val_price: float          # Value Area Low
    total_volume: float
    value_area_volume: float
    histogram: List[VolumeProfileBin]


# --- OB Screener schemas ---

class OBScreenResult(BaseModel):
    """Order Block screening result for a single symbol."""
    symbol: str
    market: str
    direction: str  # "buy" or "sell"
    zone_top: float
    zone_bottom: float
    current_price: float
    distance_percent: float  # Distance from current price to zone center (%)
    has_fvg: bool


class OBScreenResponse(BaseModel):
    """Response for /screen/ob endpoint."""
    kr_candidates: List[OBScreenResult]
    us_candidates: List[OBScreenResult]


# --- RSI Screener schemas ---

class RSIScreenResult(BaseModel):
    """RSI screening result for a single symbol."""
    symbol: str
    market: str
    rsi_value: float
    signal: str  # "overbought" or "oversold"
    current_price: float


class RSIScreenResponse(BaseModel):
    """Response for /screen/rsi endpoint."""
    kr_candidates: List[RSIScreenResult]
    us_candidates: List[RSIScreenResult]


# --- Volumatic Strategy schemas ---

class VolumaticSignalSchema(BaseModel):
    """Single trading signal from Volumatic strategy."""
    signal_type: str  # "long" or "short"
    bar_index: int
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    ob_index: int
    fvg_index: Optional[int]
    volumatic_score: int
    rsi_value: float
    reason: str


class VolumaticBacktestResponse(BaseModel):
    """Response for /strategy/backtest endpoint."""
    symbol: str
    market: str
    timeframe: str
    total_trades: int
    wins: int
    losses: int
    win_rate: float  # Percentage
    profit_factor: float
    total_profit_r: float  # Total profit in R multiples
    avg_win_r: float
    avg_loss_r: float
    max_drawdown_r: float
    sharpe_ratio: float
    signals: List[VolumaticSignalSchema]
    equity_curve: List[float]


class VolumaticAnalysis(BaseModel):
    """Volumatic analysis for an OB zone."""
    volumatic_score: int
    age_candles: int
    age_status: str  # "fresh", "mature", "aged"
    fvg_fresh: bool
    volume_strength: str


# --- MTF (Multi-Timeframe) schemas ---

class HTFOrderBlockSchema(BaseModel):
    """Higher Timeframe Order Block schema."""
    htf_index: int
    direction: str  # "buy" or "sell"
    zone_top: float
    zone_bottom: float
    htf_timeframe: str  # e.g., "4H"
    ltf_start: int  # LTF bar index where zone starts
    ltf_end: int  # LTF bar index where zone ends
    volume_strength: float
    displacement_pct: float
    distance_from_price_pct: float
    price_in_zone: bool


class HTFFVGSchema(BaseModel):
    """Higher Timeframe Fair Value Gap schema."""
    htf_index: int
    direction: str  # "buy" or "sell"
    gap_high: float
    gap_low: float
    htf_timeframe: str
    ltf_start: int
    ltf_end: int
    is_fresh: bool
    fill_percentage: float
    distance_from_price_pct: float
    price_in_gap: bool


class MTFAnalyzeResponse(BaseModel):
    """Response for /mtf/analyze endpoint."""
    symbol: str
    market: str
    ltf_timeframe: str
    htf_timeframe: str
    current_price: float
    htf_bar_count: int
    ltf_bar_count: int
    htf_obs: List[HTFOrderBlockSchema]
    htf_fvgs: List[HTFFVGSchema]
    # Summary
    bull_obs_count: int
    bear_obs_count: int
    bull_fvgs_count: int
    bear_fvgs_count: int
    nearest_bull_zone: Optional[float] = None  # Distance % to nearest bull OB/FVG
    nearest_bear_zone: Optional[float] = None  # Distance % to nearest bear OB/FVG


# --- Dynamic Indicator schemas ---

class IndicatorColors(BaseModel):
    """Color configuration for indicator."""
    main: str
    signal: str
    oversold: str
    overbought: str


class WilliamsRIndicator(BaseModel):
    """Williams %R indicator with signal line."""
    name: str = "williams_r"
    label: str = "Williams %R (14)"
    wr: List[float]
    wr_signal: List[float]
    oversold: float = -80
    overbought: float = -20
    min_value: float = -100
    max_value: float = 0
    current_value: float
    current_signal: float
    crossover: Optional[str] = None  # "bullish", "bearish"
    colors: IndicatorColors


class RSIIndicator(BaseModel):
    """RSI indicator with Fibonacci signal line."""
    name: str = "rsi"
    label: str = "RSI (14)"
    rsi: List[float]
    rsi_signal: List[float]
    oversold: float = 30
    overbought: float = 70
    min_value: float = 0
    max_value: float = 100
    current_value: float
    current_signal: float
    crossover: Optional[str] = None  # "bullish", "bearish"
    colors: IndicatorColors


class DynamicIndicatorsResponse(BaseModel):
    """Response for /indicators/dynamic endpoint."""
    symbol: str
    market: str
    timeframe: str
    bar_count: int
    wr: Optional[WilliamsRIndicator] = None
    rsi: Optional[RSIIndicator] = None


# --- Backtest schemas ---

class BacktestTradeSchema(BaseModel):
    """Single trade from backtest."""
    date: str
    direction: str
    entry_price: float
    exit_price: float
    stop_loss: float
    take_profit: float
    pnl_percent: float
    pnl_amount: float
    result: str  # "win", "loss", "breakeven"
    hold_bars: int
    confluence_score: float
    williams_r: float
    rsi: float
    volume_confirm: float


class BacktestMetricsSchema(BaseModel):
    """Backtest performance metrics."""
    total_trades: int
    wins: int
    losses: int
    win_rate: float
    profit_factor: float
    sharpe_ratio: float
    total_return: float
    max_drawdown: float
    avg_win: float
    avg_loss: float
    max_consecutive_wins: int
    max_consecutive_losses: int
    avg_hold_bars: float


class EquityPointSchema(BaseModel):
    """Equity curve data point."""
    date: str
    equity: float
    drawdown: float


class BacktestResponse(BaseModel):
    """Response for /backtest endpoint."""
    symbol: str
    market: str
    timeframe: str
    period: str
    initial_capital: float
    final_capital: float
    currency: str
    metrics: BacktestMetricsSchema
    equity_curve: List[EquityPointSchema]
    trades: List[BacktestTradeSchema]


# --- Alert schemas ---

class AlertSettingsSchema(BaseModel):
    """Alert settings configuration."""
    enabled: bool = True
    min_confluence: int = 80
    alert_types: List[str] = ["retest", "new_ob", "breakout"]
    cooldown_minutes: int = 15


class AlertTestResponse(BaseModel):
    """Response for alert test."""
    success: bool
    message: str


class AlertSettingsResponse(BaseModel):
    """Response for alert settings."""
    settings: AlertSettingsSchema
    connected: bool
