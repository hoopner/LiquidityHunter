/**
 * API client for LiquidityHunter backend
 */

import type { OHLCVResponse, ScreenResponse } from './types';

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
