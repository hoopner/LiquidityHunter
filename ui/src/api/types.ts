/**
 * API response types matching FastAPI schemas
 */

export interface OHLCVBar {
  time: string | number;  // YYYY-MM-DD for daily, Unix timestamp for intraday
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCVResponse {
  symbol: string;
  market: string;
  timeframe: string;
  bars: OHLCVBar[];
  ema20: (number | null)[];  // null for bars before EMA converges
  ema200: (number | null)[];  // null for bars before EMA converges
  sma20: (number | null)[];  // null for bars before SMA converges
  sma200: (number | null)[];  // null for bars before SMA converges
  rsi: number[];
  rsi_signal: number[];  // RSI Signal(9) - SMA of RSI
  macd_line: number[];
  macd_signal: number[];
  macd_histogram: number[];
  // 3 Stochastic indicators with different timeframes
  stoch_slow_k: number[];  // Stoch Slow (20,12,12) %K - Long-term
  stoch_slow_d: number[];  // Stoch Slow (20,12,12) %D
  stoch_med_k: number[];   // Stoch Medium (10,6,6) %K - Medium-term
  stoch_med_d: number[];   // Stoch Medium (10,6,6) %D
  stoch_fast_k: number[];  // Stoch Fast (5,3,3) %K - Short-term
  stoch_fast_d: number[];  // Stoch Fast (5,3,3) %D
  // Bollinger Bands
  bb1_upper: number[];     // BB1 (20, 0.5) - Tight - Green
  bb1_middle: number[];
  bb1_lower: number[];
  bb2_upper: number[];     // BB2 (20, 3.0) - Wide - Red
  bb2_middle: number[];
  bb2_lower: number[];
  // RSI with Bollinger Band (for subchart)
  rsi_bb_upper: number[];  // BB(30, 2.0) applied to RSI
  rsi_bb_middle: number[];
  rsi_bb_lower: number[];
  // VWAP (Volume Weighted Average Price) - intraday only
  vwap: number[];
  // Keltner Channel
  kc_upper: number[];   // EMA(20) + ATR(10) * 1.5
  kc_middle: number[];  // EMA(20)
  kc_lower: number[];   // EMA(20) - ATR(10) * 1.5
  // TTM Squeeze
  squeeze: boolean[];  // true = squeeze ON (BB inside KC)
  // Data source info
  source: 'kis' | 'yfinance';  // 'kis' = real-time, 'yfinance' = delayed
}

// Order Block types
export interface FVG {
  index: number;
  direction: string;
  gap_high: number;
  gap_low: number;
}

export interface RetestSignal {
  retest_active: boolean;
  direction: 'bull' | 'bear' | '';
  distance_pct: number;
  volume_confirm: number;
  entry_price: number;
  ob_strength: number;
  signal_type: 'retest_long' | 'retest_short' | '';
}

export interface OrderBlock {
  index: number;
  direction: string;
  zone_top: number;
  zone_bottom: number;
  displacement_index: number;
  has_fvg: boolean;
  fvg: FVG | null;
  // Volume analysis
  volume_strength: 'strong' | 'normal' | 'weak';
  volume_ratio: number;  // displacement_volume / avg_volume
  // Volumatic strategy fields
  age_candles: number;
  age_status: 'fresh' | 'mature' | 'aged';
  fvg_fresh: boolean;
  volumatic_score: number;  // 0-100
  // Retest signal
  retest_signal: RetestSignal | null;
}

export interface ActiveSignal {
  type: 'retest_long' | 'retest_short';
  price: number;
  ob_strength: number;
  volume_confirm: number;
  direction: 'bull' | 'bear';
}

export interface ConfluenceData {
  has_confluence: boolean;
  score: number;  // 0-100
  ob_score: number;
  fvg_score: number;
  overlap_bonus: number;
  proximity_bonus: number;
  reason: string;
  details: Record<string, unknown>;
}

// Williams %R types
export type WilliamsRZone =
  | 'extreme_overbought'
  | 'overbought'
  | 'neutral'
  | 'oversold'
  | 'extreme_oversold';

export interface WilliamsRSignal {
  value: number;           // Current %R value (-100 to 0)
  zone: WilliamsRZone;     // Zone classification
  signal: 'buy' | 'sell' | 'neutral';
  strength: number;        // 0-10 scale
  divergence: 'bullish' | 'bearish' | null;
  cross_direction: 'up' | 'down' | null;  // Crossing -50 level
  ob_bonus: number;        // Bonus points for OB confluence (0-25)
  summary: string;         // Human-readable summary
}

export interface AnalyzeResponse {
  bar_index: number;
  current_price: number;
  current_valid_ob: OrderBlock | null;
  fvgs: FVG[];  // Independent FVGs
  validation_details: {
    has_displacement: boolean;
    has_fvg: boolean;
    is_fresh: boolean;
  };
  reason_code: 'OK' | 'NO_VALID_OB';
  confluence: ConfluenceData | null;
  atr: number | null;
  filtered_weak_obs: number;  // Count of weak OBs filtered out
  signals: ActiveSignal[];  // Active trading signals (e.g., retest)
  williams_r: WilliamsRSignal | null;  // Williams %R signal with OB confluence
}

// Portfolio types
export interface PortfolioHolding {
  symbol: string;
  market: string;
  quantity: number;
  avg_price: number;
  buy_date: string;
  current_price: number;
  pnl_amount: number;
  pnl_percent: number;
  total_value: number;
}

export interface PortfolioResponse {
  holdings: PortfolioHolding[];
  total_kr_value: number;
  total_us_value: number;
  total_kr_pnl: number;
  total_us_pnl: number;
}

export interface AddHoldingResponse {
  success: boolean;
  message: string;
}

export interface UpdateHoldingResponse {
  success: boolean;
  message: string;
}

export interface RemoveHoldingResponse {
  success: boolean;
  message: string;
}

export interface ScreenResult {
  symbol: string;
  market: string;
  last_close: number;
  ema20: number;
  ema200: number;
  gap: number;
  slope_diff: number;
  days_to_cross: number | null;
  score: number;
  reason: string;
}

export interface ScreenResponse {
  market: string;
  candidates: ScreenResult[];
}

// Watchlist types

export interface WatchlistItem {
  symbol: string;
  market: string;
  has_data: boolean;
  bar_count: number;
}

export interface WatchlistResponse {
  market: string;
  symbols: WatchlistItem[];
}

export interface AddSymbolResponse {
  success: boolean;
  symbol: string;
  market: string;
  message: string;
  bar_count: number;
}

export interface RemoveSymbolResponse {
  success: boolean;
  symbol: string;
  market: string;
  message: string;
}

// Volume Profile types

export interface VolumeProfileBin {
  price: number;
  volume: number;
  percent: number;  // Percentage of max volume (for bar width)
  in_value_area: boolean;
}

export interface VolumeProfileResponse {
  symbol: string;
  market: string;
  timeframe: string;
  poc_price: number;          // Point of Control - price with highest volume
  vah_price: number;          // Value Area High
  val_price: number;          // Value Area Low
  total_volume: number;
  value_area_volume: number;
  histogram: VolumeProfileBin[];
}

// Volumatic Strategy types

export interface VolumaticSignal {
  signal_type: 'long' | 'short';
  bar_index: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  ob_index: number;
  fvg_index: number | null;
  volumatic_score: number;
  rsi_value: number;
  reason: string;
}

export interface VolumaticBacktestResponse {
  symbol: string;
  market: string;
  timeframe: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;       // Percentage
  profit_factor: number;
  total_profit_r: number; // Total profit in R multiples
  avg_win_r: number;
  avg_loss_r: number;
  max_drawdown_r: number;
  sharpe_ratio: number;
  signals: VolumaticSignal[];
  equity_curve: number[];
}

// MTF (Multi-Timeframe) types

export interface HTFOrderBlock {
  htf_index: number;
  direction: 'buy' | 'sell';
  zone_top: number;
  zone_bottom: number;
  htf_timeframe: string;
  ltf_start: number;  // LTF bar index where zone starts
  ltf_end: number;    // LTF bar index where zone ends
  volume_strength: number;
  displacement_pct: number;
  distance_from_price_pct: number;
  price_in_zone: boolean;
}

export interface HTFFVG {
  htf_index: number;
  direction: 'buy' | 'sell';
  gap_high: number;
  gap_low: number;
  htf_timeframe: string;
  ltf_start: number;
  ltf_end: number;
  is_fresh: boolean;
  fill_percentage: number;
  distance_from_price_pct: number;
  price_in_gap: boolean;
}

export interface MTFAnalyzeResponse {
  symbol: string;
  market: string;
  ltf_timeframe: string;
  htf_timeframe: string;
  current_price: number;
  htf_bar_count: number;
  ltf_bar_count: number;
  htf_obs: HTFOrderBlock[];
  htf_fvgs: HTFFVG[];
  bull_obs_count: number;
  bear_obs_count: number;
  bull_fvgs_count: number;
  bear_fvgs_count: number;
  nearest_bull_zone: number | null;
  nearest_bear_zone: number | null;
}

// Dynamic Indicator types

export interface IndicatorColors {
  main: string;
  signal: string;
  oversold: string;
  overbought: string;
}

export interface WilliamsRIndicator {
  name: string;
  label: string;
  wr: number[];
  wr_signal: number[];
  oversold: number;
  overbought: number;
  min_value: number;
  max_value: number;
  current_value: number;
  current_signal: number;
  crossover: 'bullish' | 'bearish' | null;
  colors: IndicatorColors;
}

export interface RSIIndicator {
  name: string;
  label: string;
  rsi: number[];
  rsi_signal: number[];
  oversold: number;
  overbought: number;
  min_value: number;
  max_value: number;
  current_value: number;
  current_signal: number;
  crossover: 'bullish' | 'bearish' | null;
  colors: IndicatorColors;
}

export interface DynamicIndicatorsResponse {
  symbol: string;
  market: string;
  timeframe: string;
  bar_count: number;
  wr: WilliamsRIndicator | null;
  rsi: RSIIndicator | null;
}

// Backtest types

export interface BacktestTrade {
  date: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  take_profit: number;
  pnl_percent: number;
  pnl_amount: number;
  result: string;
  hold_bars: number;
  confluence_score: number;
  williams_r: number;
  rsi: number;
  volume_confirm: number;
}

export interface BacktestMetrics {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  total_return: number;
  max_drawdown: number;
  avg_win: number;
  avg_loss: number;
  max_consecutive_wins: number;
  max_consecutive_losses: number;
  avg_hold_bars: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
}

export interface BacktestResponse {
  symbol: string;
  market: string;
  timeframe: string;
  period: string;
  initial_capital: number;
  final_capital: number;
  currency: string;
  metrics: BacktestMetrics;
  equity_curve: EquityPoint[];
  trades: BacktestTrade[];
}

// Alert types

export interface AlertSettings {
  enabled: boolean;
  min_confluence: number;
  alert_types: string[];
  cooldown_minutes: number;
}

export interface AlertSettingsResponse {
  settings: AlertSettings;
  connected: boolean;
}

export interface AlertTestResponse {
  success: boolean;
  message: string;
}

export interface AlertScanResponse {
  scanned: number;
  alerts_sent: number;
  message: string;
}

// KIS API types

export interface KISConfigRequest {
  app_key: string;
  app_secret: string;
  account_no?: string;
  mock?: boolean;
}

export interface KISConfigResponse {
  success: boolean;
  message: string;
  configured: boolean;
  mock_mode: boolean;
}

export interface KISConnectionStatus {
  configured: boolean;
  connected: boolean;
  mock_mode: boolean;
  message: string;
  token_expires?: string;
}

export interface KISPriceResponse {
  symbol: string;
  market: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  prev_close: number;
  timestamp: string;
}

export interface DataSourceInfo {
  current_source: string;
  kis_configured: boolean;
  kis_connected: boolean;
  available_sources: string[];
}

export type DataSource = 'yfinance' | 'kis';

// AI Signal Alert types

export interface AIDirection {
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
}

export interface AIConsensus {
  direction: 'bullish' | 'bearish' | 'neutral' | 'divergence';
  agreement: number; // 0, 1, 2, or 3
  confidence: number;
  directions: {
    technical_ml: string;
    lstm: string;
    lh_ai: string;
  };
}

export interface PatternAlignment {
  ob_aligned: boolean;
  fvg_aligned: boolean;
  technical_confluence: number; // 0, 1, or 2
  description: string;
}

export interface TradingLevels {
  entry: number | null;
  stop: number | null;
  targets: number[];
  risk_reward: number;
}

export type SignalType = 'strong_buy' | 'strong_sell' | 'moderate_buy' | 'moderate_sell' | 'divergence' | 'neutral';

export interface AISignal {
  symbol: string;
  market: string;
  timestamp: string;
  signal_type: SignalType;
  confidence: number;
  consensus: AIConsensus;
  pattern_alignment: PatternAlignment;
  trading_levels: TradingLevels;
  reasoning: string[];
  individual_predictions: Record<string, unknown>;
}

export interface DetectSignalRequest {
  symbol: string;
  market: string;
  technical_ml_prediction: Record<string, unknown>;
  lstm_prediction: Record<string, unknown>;
  lh_ai_prediction: Record<string, unknown>;
  current_price: number;
  order_blocks?: Record<string, unknown>[];
  fvgs?: Record<string, unknown>[];
}

export interface DetectSignalResponse {
  signal: AISignal;
  should_alert: boolean;
  triggered_conditions: string[];
}

export interface AlertCondition {
  id: string;
  user_id: string;
  symbol: string;
  min_confidence: number;
  min_consensus: number;
  require_pattern: boolean;
  signal_types: SignalType[];
  enabled: boolean;
  telegram: boolean;
  web_push: boolean;
  email: boolean;
  in_app: boolean;
  cooldown_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface AlertConditionListResponse {
  conditions: AlertCondition[];
  total: number;
}

export interface InAppNotification {
  id: string;
  user_id: string;
  symbol: string;
  market: string;
  title: string;
  body: string;
  emoji: string;
  signal_type: string;
  confidence: number;
  timestamp: string;
  read: boolean;
  dismissed: boolean;
}

export interface NotificationListResponse {
  notifications: InAppNotification[];
  unread_count: number;
  total: number;
}

export interface MarkReadRequest {
  notification_ids?: string[]; // null means mark all as read
}

export interface MarkReadResponse {
  success: boolean;
  marked_count: number;
}

export interface AlertHistoryEntry {
  notification_id: string;
  condition_id: string;
  symbol: string;
  market: string;
  signal_type: string;
  timestamp: string;
  channels_sent: string[];
}

export interface AlertHistoryResponse {
  history: AlertHistoryEntry[];
  total: number;
}

// Price Alert types

export type PriceAlertType = 'above' | 'below' | 'change_up' | 'change_down';

export interface PriceAlert {
  id: string;
  user_id: string;
  symbol: string;
  market: string;
  alert_type: PriceAlertType;
  threshold: number;
  reference_price: number | null;
  enabled: boolean;
  repeating: boolean;
  cooldown_minutes: number;
  notification_channels: string[];
  created_at: string;
  last_triggered: string | null;
  trigger_count: number;
}

export interface CreatePriceAlertRequest {
  symbol: string;
  market: string;
  alert_type: PriceAlertType;
  threshold: number;
  reference_price?: number;
  repeating?: boolean;
  cooldown_minutes?: number;
  notification_channels?: string[];
}

export interface UpdatePriceAlertRequest {
  enabled?: boolean;
  threshold?: number;
  repeating?: boolean;
  cooldown_minutes?: number;
  notification_channels?: string[];
}

export interface PriceAlertListResponse {
  alerts: PriceAlert[];
  total: number;
}

export interface CheckPriceResponse {
  symbol: string;
  price: number;
  triggered_count: number;
  triggered_alerts: {
    id: string;
    alert_type: string;
    threshold: number;
    trigger_count: number;
  }[];
}

// Full Market Scanner types

export type ScanSignalType = 'golden_cross' | 'death_cross' | 'bullish_alignment' | 'bearish_alignment';

export interface ScanResult {
  symbol: string;
  market: string;
  signal_type: ScanSignalType;
  current_price: number;
  sma20: number;
  sma200: number;
  volume: number;
  volume_ratio: number;  // Current volume vs 20-day average
  price_change_pct: number;
  detected_at: string;
  days_since_cross: number;
}

export interface ScanMarketRequest {
  market: string;
  signal_types?: ScanSignalType[];
  force_refresh?: boolean;
}

export interface ScanMarketResponse {
  market: string;
  symbols_scanned: number;
  signals_found: number;
  scan_duration_seconds: number;
  cached: boolean;
  cache_age_minutes: number;
  results: ScanResult[];
}

export interface ScanAllMarketsResponse {
  us_results: ScanResult[];
  kr_results: ScanResult[];
  total_signals: number;
  scan_duration_seconds: number;
}

export interface ScanCacheStatus {
  markets: Record<string, {
    symbols_scanned: number;
    signals_found: number;
    scanned_at: string;
    cache_age_minutes: number;
    is_valid: boolean;
    scan_duration_seconds: number;
  }>;
}
