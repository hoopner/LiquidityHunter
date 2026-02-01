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
    sma20: List[Optional[float]] = []  # Simple Moving Average 20
    sma200: List[Optional[float]] = []  # Simple Moving Average 200
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
    # Data source info
    source: str = "yfinance"  # "kis" (real-time) or "yfinance" (delayed)


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


# --- KIS API schemas ---

class KISConfigRequest(BaseModel):
    """Request body for KIS API configuration."""
    app_key: str
    app_secret: str
    account_no: str = ""
    mock: bool = False


class KISConfigResponse(BaseModel):
    """Response for KIS API configuration."""
    success: bool
    message: str
    configured: bool
    mock_mode: bool


class KISConnectionStatus(BaseModel):
    """KIS API connection status."""
    configured: bool
    connected: bool
    mock_mode: bool
    message: str
    token_expires: Optional[str] = None


class KISPriceResponse(BaseModel):
    """Response for KIS current price query."""
    symbol: str
    market: str
    price: float
    change: float
    change_pct: float
    volume: int
    high: float
    low: float
    open: float
    prev_close: float
    timestamp: str


class DataSourceInfo(BaseModel):
    """Information about available data sources."""
    current_source: str  # "yfinance" or "kis"
    kis_configured: bool
    kis_connected: bool
    available_sources: List[str]


# --- AI Signal Alert schemas ---

class AIDirectionSchema(BaseModel):
    """AI direction prediction."""
    direction: str  # "bullish", "bearish", "neutral"
    confidence: float
    reasoning: str


class AIConsensusSchema(BaseModel):
    """AI consensus across multiple models."""
    direction: str  # "bullish", "bearish", "neutral", "divergence"
    agreement: int  # 0, 1, 2, or 3
    confidence: float
    directions: dict  # {"technical_ml": "bullish", "lstm": "bearish", "lh_ai": "bullish"}


class PatternAlignmentSchema(BaseModel):
    """Pattern alignment analysis."""
    ob_aligned: bool
    fvg_aligned: bool
    technical_confluence: int  # 0, 1, or 2
    description: str


class TradingLevelsSchema(BaseModel):
    """Trading levels from AI analysis."""
    entry: Optional[float] = None
    stop: Optional[float] = None
    targets: List[float] = []
    risk_reward: float = 0.0


class AISignalSchema(BaseModel):
    """Full AI signal analysis result."""
    symbol: str
    market: str
    timestamp: str
    signal_type: str  # "strong_buy", "strong_sell", "moderate_buy", "moderate_sell", "divergence", "neutral"
    confidence: float
    consensus: AIConsensusSchema
    pattern_alignment: PatternAlignmentSchema
    trading_levels: TradingLevelsSchema
    reasoning: List[str]
    individual_predictions: dict


class DetectSignalRequest(BaseModel):
    """Request to detect AI signal."""
    symbol: str
    market: str = "KR"
    technical_ml_prediction: dict
    lstm_prediction: dict
    lh_ai_prediction: dict
    current_price: float
    order_blocks: Optional[List[dict]] = None
    fvgs: Optional[List[dict]] = None


class DetectSignalResponse(BaseModel):
    """Response from signal detection."""
    signal: AISignalSchema
    should_alert: bool
    triggered_conditions: List[str] = []


class AlertConditionSchema(BaseModel):
    """User-defined alert condition."""
    id: str = ""
    user_id: str = "default"
    symbol: str = "*"  # "*" for all symbols
    min_confidence: float = 70.0
    min_consensus: int = 2  # 2/3 or 3/3
    require_pattern: bool = False
    signal_types: List[str] = ["strong_buy", "strong_sell"]
    enabled: bool = True
    telegram: bool = True
    web_push: bool = False
    email: bool = False
    in_app: bool = True
    cooldown_minutes: int = 30
    created_at: str = ""
    updated_at: str = ""


class AlertConditionListResponse(BaseModel):
    """Response for listing alert conditions."""
    conditions: List[AlertConditionSchema]
    total: int


class InAppNotificationSchema(BaseModel):
    """In-app notification."""
    id: str
    user_id: str
    symbol: str
    market: str
    title: str
    body: str
    emoji: str
    signal_type: str
    confidence: float
    timestamp: str
    read: bool = False
    dismissed: bool = False


class NotificationListResponse(BaseModel):
    """Response for listing notifications."""
    notifications: List[InAppNotificationSchema]
    unread_count: int
    total: int


class MarkReadRequest(BaseModel):
    """Request to mark notifications as read."""
    notification_ids: Optional[List[str]] = None  # None means mark all as read


class MarkReadResponse(BaseModel):
    """Response for mark read operation."""
    success: bool
    marked_count: int


class AlertHistoryEntrySchema(BaseModel):
    """Historical alert entry."""
    notification_id: str
    condition_id: str
    symbol: str
    market: str
    signal_type: str
    timestamp: str
    channels_sent: List[str]


class AlertHistoryResponse(BaseModel):
    """Response for alert history."""
    history: List[AlertHistoryEntrySchema]
    total: int


# --- Price Alert schemas ---

class PriceAlertSchema(BaseModel):
    """Price alert configuration."""
    id: str = ""
    user_id: str = "default"
    symbol: str
    market: str = "KR"
    alert_type: str  # "above", "below", "change_up", "change_down"
    threshold: float
    reference_price: Optional[float] = None
    enabled: bool = True
    repeating: bool = False
    cooldown_minutes: int = 60
    notification_channels: List[str] = ["telegram", "in_app"]
    created_at: str = ""
    last_triggered: Optional[str] = None
    trigger_count: int = 0


class CreatePriceAlertRequest(BaseModel):
    """Request to create a price alert."""
    symbol: str
    market: str = "KR"
    alert_type: str
    threshold: float
    reference_price: Optional[float] = None
    repeating: bool = False
    cooldown_minutes: int = 60
    notification_channels: List[str] = ["telegram", "in_app"]


class UpdatePriceAlertRequest(BaseModel):
    """Request to update a price alert."""
    enabled: Optional[bool] = None
    threshold: Optional[float] = None
    repeating: Optional[bool] = None
    cooldown_minutes: Optional[int] = None
    notification_channels: Optional[List[str]] = None


class PriceAlertListResponse(BaseModel):
    """Response for listing price alerts."""
    alerts: List[PriceAlertSchema]
    total: int


class CheckPriceRequest(BaseModel):
    """Request to check price against alerts."""
    symbol: str
    price: float
    volume: Optional[float] = None


# --- Full Market Scanner schemas ---

class ScanResultSchema(BaseModel):
    """Result from scanning a single symbol."""
    symbol: str
    market: str
    signal_type: str  # "golden_cross", "death_cross", "bullish_alignment", "bearish_alignment"
    current_price: float
    sma20: float
    sma200: float
    volume: int
    volume_ratio: float  # Current volume vs 20-day average
    price_change_pct: float
    detected_at: str
    days_since_cross: int = 0


class ScanMarketRequest(BaseModel):
    """Request to scan a market."""
    market: str = "US"  # "US" or "KR"
    signal_types: Optional[List[str]] = None  # Default: ["golden_cross"]
    force_refresh: bool = False


class ScanAllMarketsRequest(BaseModel):
    """Request to scan all markets."""
    signal_types: Optional[List[str]] = None  # Default: ["golden_cross"]
    force_refresh: bool = False


class ScanMarketResponse(BaseModel):
    """Response from market scan."""
    market: str
    symbols_scanned: int
    signals_found: int
    scan_duration_seconds: float
    cached: bool
    cache_age_minutes: int
    results: List[ScanResultSchema]


class ScanAllMarketsResponse(BaseModel):
    """Response from scanning all markets."""
    us_results: List[ScanResultSchema]
    kr_results: List[ScanResultSchema]
    total_signals: int
    scan_duration_seconds: float


class ScanCacheStatusResponse(BaseModel):
    """Cache status for scanner."""
    markets: dict  # market -> cache info
