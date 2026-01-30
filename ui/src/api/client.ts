/**
 * API client for LiquidityHunter backend
 */

import type {
  OHLCVResponse,
  ScreenResponse,
  WatchlistResponse,
  AddSymbolResponse,
  RemoveSymbolResponse,
  AnalyzeResponse,
  PortfolioResponse,
  AddHoldingResponse,
  UpdateHoldingResponse,
  RemoveHoldingResponse,
  VolumeProfileResponse,
  VolumaticBacktestResponse,
  MTFAnalyzeResponse,
  DynamicIndicatorsResponse,
  BacktestResponse,
  AlertSettings,
  AlertSettingsResponse,
  AlertTestResponse,
  AlertScanResponse,
} from './types';

const BASE_URL = 'http://localhost:8000';

/**
 * Fetch OHLCV data with EMA indicators
 */
export async function fetchOHLCV(
  symbol: string,
  market: string = 'KR',
  timeframe: string = '1D'
): Promise<OHLCVResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    tf: timeframe,
  });

  const response = await fetch(`${BASE_URL}/ohlcv?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch screening results for a market
 */
export async function fetchScreen(
  market: string = 'KR',
  topN: number = 20
): Promise<ScreenResponse> {
  const params = new URLSearchParams({
    market,
    top_n: topN.toString(),
  });

  const response = await fetch(`${BASE_URL}/screen?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch watchlist for a market
 */
export async function fetchWatchlist(market: string = 'KR'): Promise<WatchlistResponse> {
  const params = new URLSearchParams({ market });
  const response = await fetch(`${BASE_URL}/watchlist?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Add symbol to watchlist and download data
 */
export async function addToWatchlist(
  symbol: string,
  market: string
): Promise<AddSymbolResponse> {
  const response = await fetch(`${BASE_URL}/watchlist/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, market }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Remove symbol from watchlist
 */
export async function removeFromWatchlist(
  symbol: string,
  market: string
): Promise<RemoveSymbolResponse> {
  const response = await fetch(`${BASE_URL}/watchlist/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, market }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch Order Block analysis for a symbol at a specific bar index
 */
export async function fetchAnalyze(
  symbol: string,
  market: string,
  timeframe: string,
  barIndex: number,
  filterWeak: boolean = false
): Promise<AnalyzeResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    tf: timeframe,
    bar_index: barIndex.toString(),
    filter_weak: filterWeak.toString(),
  });

  const response = await fetch(`${BASE_URL}/analyze?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch portfolio holdings with P&L
 */
export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const response = await fetch(`${BASE_URL}/portfolio`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Add a holding to portfolio
 */
export async function addHolding(
  symbol: string,
  market: string,
  quantity: number,
  avgPrice: number,
  buyDate?: string
): Promise<AddHoldingResponse> {
  const response = await fetch(`${BASE_URL}/portfolio/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      market,
      quantity,
      avg_price: avgPrice,
      buy_date: buyDate,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Update a holding in portfolio
 */
export async function updateHolding(
  symbol: string,
  market: string,
  quantity?: number,
  avgPrice?: number
): Promise<UpdateHoldingResponse> {
  const response = await fetch(`${BASE_URL}/portfolio/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      market,
      quantity,
      avg_price: avgPrice,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Remove a holding from portfolio
 */
export async function removeHolding(
  symbol: string,
  market: string
): Promise<RemoveHoldingResponse> {
  const response = await fetch(`${BASE_URL}/portfolio/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, market }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch Volume Profile data for a symbol
 */
export async function fetchVolumeProfile(
  symbol: string,
  market: string = 'KR',
  timeframe: string = '1D',
  numBins: number = 50
): Promise<VolumeProfileResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    tf: timeframe,
    num_bins: numBins.toString(),
  });

  const response = await fetch(`${BASE_URL}/volume_profile?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch Volumatic Strategy backtest results
 */
export async function fetchVolumaticBacktest(
  symbol: string,
  market: string = 'KR',
  timeframe: string = '1D',
  lookback: number = 1000
): Promise<VolumaticBacktestResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    tf: timeframe,
    lookback: lookback.toString(),
  });

  const response = await fetch(`${BASE_URL}/strategy/backtest?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch MTF (Multi-Timeframe) analysis
 */
export async function fetchMTFAnalyze(
  symbol: string,
  market: string = 'KR',
  ltf: string = '1H',
  htf: string = '',
  lookback: number = 20,
  freshOnly: boolean = true
): Promise<MTFAnalyzeResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    ltf,
    lookback: lookback.toString(),
    fresh_only: freshOnly.toString(),
  });
  if (htf) {
    params.append('htf', htf);
  }

  const response = await fetch(`${BASE_URL}/mtf/analyze?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch dynamic indicators with signal lines
 */
export async function fetchDynamicIndicators(
  symbol: string,
  market: string = 'KR',
  timeframe: string = '1D',
  selected: string[] = ['wr']
): Promise<DynamicIndicatorsResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    tf: timeframe,
    selected: selected.join(','),
  });

  const response = await fetch(`${BASE_URL}/indicators/dynamic?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch strategy backtest results
 */
export async function fetchBacktest(
  symbol: string,
  market: string = 'KR',
  timeframe: string = '1D',
  days: number = 90,
  minScore: number = 85,
  riskReward: number = 3.0
): Promise<BacktestResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    tf: timeframe,
    days: days.toString(),
    min_score: minScore.toString(),
    risk_reward: riskReward.toString(),
  });

  const response = await fetch(`${BASE_URL}/backtest?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Send test alert to Telegram
 */
export async function sendTestAlert(): Promise<AlertTestResponse> {
  const response = await fetch(`${BASE_URL}/alerts/test`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get alert settings
 */
export async function getAlertSettings(): Promise<AlertSettingsResponse> {
  const response = await fetch(`${BASE_URL}/alerts/settings`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Update alert settings
 */
export async function updateAlertSettings(
  settings: AlertSettings
): Promise<AlertSettingsResponse> {
  const response = await fetch(`${BASE_URL}/alerts/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Manually scan for alerts
 */
export async function scanForAlerts(
  market: string = 'KR'
): Promise<AlertScanResponse> {
  const response = await fetch(`${BASE_URL}/alerts/scan?market=${market}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}
