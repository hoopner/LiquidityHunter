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
  barIndex: number
): Promise<AnalyzeResponse> {
  const params = new URLSearchParams({
    symbol,
    market,
    tf: timeframe,
    bar_index: barIndex.toString(),
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
