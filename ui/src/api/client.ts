/**
 * API client for LiquidityHunter backend
 */

import type {
  OHLCVResponse,
  ScreenResponse,
  WatchlistResponse,
  AddSymbolResponse,
  RemoveSymbolResponse,
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
