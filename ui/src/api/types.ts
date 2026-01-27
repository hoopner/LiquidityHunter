/**
 * API response types matching FastAPI schemas
 */

export interface OHLCVBar {
  time: string;  // YYYY-MM-DD
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
  ema20: number[];
  ema200: number[];
  rsi: number[];
  macd_line: number[];
  macd_signal: number[];
  macd_histogram: number[];
}

// Order Block types
export interface FVG {
  index: number;
  direction: string;
  gap_high: number;
  gap_low: number;
}

export interface OrderBlock {
  index: number;
  direction: string;
  zone_top: number;
  zone_bottom: number;
  displacement_index: number;
  has_fvg: boolean;
  fvg: FVG | null;
}

export interface AnalyzeResponse {
  bar_index: number;
  current_price: number;
  current_valid_ob: OrderBlock | null;
  validation_details: {
    has_displacement: boolean;
    has_fvg: boolean;
    is_fresh: boolean;
  };
  reason_code: 'OK' | 'NO_VALID_OB';
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
