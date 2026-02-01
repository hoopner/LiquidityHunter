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
  // KIS API types
  KISConfigRequest,
  KISConfigResponse,
  KISConnectionStatus,
  KISPriceResponse,
  DataSourceInfo,
  // AI Signal Alert types
  DetectSignalRequest,
  DetectSignalResponse,
  AlertCondition,
  AlertConditionListResponse,
  NotificationListResponse,
  MarkReadRequest,
  MarkReadResponse,
  AlertHistoryResponse,
  // Price Alert types
  PriceAlert,
  CreatePriceAlertRequest,
  UpdatePriceAlertRequest,
  PriceAlertListResponse,
  CheckPriceResponse,
  // Full Market Scanner types
  ScanSignalType,
  ScanMarketResponse,
  ScanAllMarketsResponse,
  ScanCacheStatus,
} from './types';

const BASE_URL = 'http://localhost:8000';

/**
 * Fetch OHLCV data with EMA indicators
 *
 * Data source is automatically selected:
 * - KIS API (real-time) if configured
 * - yfinance (delayed) as fallback
 *
 * Check response.source to see which source was used.
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

// --- AI Signal Alert Functions ---

/**
 * Detect AI signal from multiple predictions
 */
export async function detectAISignal(
  request: DetectSignalRequest
): Promise<DetectSignalResponse> {
  const response = await fetch(`${BASE_URL}/api/ai/detect-signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get alert conditions for a user
 */
export async function getAlertConditions(
  userId: string = 'default'
): Promise<AlertConditionListResponse> {
  const params = new URLSearchParams({ user_id: userId });
  const response = await fetch(`${BASE_URL}/api/alerts/conditions?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Create a new alert condition
 */
export async function createAlertCondition(
  condition: Partial<AlertCondition>
): Promise<AlertCondition> {
  const response = await fetch(`${BASE_URL}/api/alerts/conditions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(condition),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Update an existing alert condition
 */
export async function updateAlertCondition(
  conditionId: string,
  condition: Partial<AlertCondition>
): Promise<AlertCondition> {
  const response = await fetch(`${BASE_URL}/api/alerts/conditions/${conditionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(condition),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Delete an alert condition
 */
export async function deleteAlertCondition(
  conditionId: string
): Promise<{ success: boolean; deleted_id: string }> {
  const response = await fetch(`${BASE_URL}/api/alerts/conditions/${conditionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get in-app notifications
 */
export async function getNotifications(
  userId: string = 'default',
  limit: number = 50,
  unreadOnly: boolean = false
): Promise<NotificationListResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    limit: limit.toString(),
    unread_only: unreadOnly.toString(),
  });
  const response = await fetch(`${BASE_URL}/api/alerts/notifications?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(
  request: MarkReadRequest,
  userId: string = 'default'
): Promise<MarkReadResponse> {
  const params = new URLSearchParams({ user_id: userId });
  const response = await fetch(`${BASE_URL}/api/alerts/notifications/read?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Dismiss a notification
 */
export async function dismissNotification(
  notificationId: string
): Promise<{ success: boolean; dismissed_id: string }> {
  const response = await fetch(
    `${BASE_URL}/api/alerts/notifications/${notificationId}/dismiss`,
    { method: 'POST' }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get alert history
 */
export async function getAlertHistory(
  symbol?: string,
  limit: number = 50
): Promise<AlertHistoryResponse> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (symbol) params.set('symbol', symbol);

  const response = await fetch(`${BASE_URL}/api/alerts/history?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// --- Price Alert Functions ---

/**
 * Create a new price alert
 */
export async function createPriceAlert(
  request: CreatePriceAlertRequest,
  userId: string = 'default'
): Promise<PriceAlert> {
  const params = new URLSearchParams({ user_id: userId });
  const response = await fetch(`${BASE_URL}/api/alerts/price?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get price alerts for a user/symbol
 */
export async function getPriceAlerts(
  symbol?: string,
  userId: string = 'default'
): Promise<PriceAlertListResponse> {
  const params = new URLSearchParams({ user_id: userId });
  if (symbol) params.set('symbol', symbol);

  const response = await fetch(`${BASE_URL}/api/alerts/price?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Update a price alert
 */
export async function updatePriceAlert(
  alertId: string,
  request: UpdatePriceAlertRequest
): Promise<PriceAlert> {
  const response = await fetch(`${BASE_URL}/api/alerts/price/${alertId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Delete a price alert
 */
export async function deletePriceAlert(
  alertId: string
): Promise<{ success: boolean; deleted_id: string }> {
  const response = await fetch(`${BASE_URL}/api/alerts/price/${alertId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Check price against alerts (manual trigger)
 */
export async function checkPriceAlerts(
  symbol: string,
  price: number,
  volume?: number
): Promise<CheckPriceResponse> {
  const response = await fetch(`${BASE_URL}/api/alerts/price/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, price, volume }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// --- KIS API Functions ---

/**
 * Configure KIS API credentials
 */
export async function configureKIS(
  config: KISConfigRequest
): Promise<KISConfigResponse> {
  const response = await fetch(`${BASE_URL}/kis/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get KIS API connection status
 */
export async function getKISStatus(): Promise<KISConnectionStatus> {
  const response = await fetch(`${BASE_URL}/kis/status`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Test KIS API connection
 */
export async function testKISConnection(): Promise<{
  success: boolean;
  message: string;
  test_data?: {
    symbol: string;
    name: string;
    price: number;
    change: number;
    change_pct: number;
  };
  error_code?: string;
}> {
  const response = await fetch(`${BASE_URL}/kis/test`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get current price from KIS API
 */
export async function getKISPrice(
  symbol: string,
  market: string = 'KR'
): Promise<KISPriceResponse> {
  const params = new URLSearchParams({ symbol, market });
  const response = await fetch(`${BASE_URL}/kis/price?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get available data sources info
 */
export async function getDataSourceInfo(): Promise<DataSourceInfo> {
  const response = await fetch(`${BASE_URL}/data/source`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// --- Full Market Scanner Functions ---

/**
 * Scan a market for SMA signals
 * Uses parallel processing for high performance
 */
export async function scanMarket(
  market: string = 'US',
  signalTypes?: ScanSignalType[],
  forceRefresh: boolean = false
): Promise<ScanMarketResponse> {
  const response = await fetch(`${BASE_URL}/api/scanner/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      market,
      signal_types: signalTypes,
      force_refresh: forceRefresh,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Scan all markets (US and KR) in parallel
 */
export async function scanAllMarkets(
  signalTypes?: ScanSignalType[],
  forceRefresh: boolean = false
): Promise<ScanAllMarketsResponse> {
  const params = new URLSearchParams();
  if (signalTypes) {
    signalTypes.forEach(t => params.append('signal_types', t));
  }
  params.set('force_refresh', forceRefresh.toString());

  const response = await fetch(`${BASE_URL}/api/scanner/scan_all?${params}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get scanner cache status
 */
export async function getScannerCacheStatus(): Promise<ScanCacheStatus> {
  const response = await fetch(`${BASE_URL}/api/scanner/cache_status`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Clear scanner cache
 */
export async function clearScannerCache(
  market?: string
): Promise<{ success: boolean; message: string }> {
  const params = market ? new URLSearchParams({ market }) : new URLSearchParams();
  const response = await fetch(`${BASE_URL}/api/scanner/clear_cache?${params}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get list of symbols for a market
 */
export async function getMarketSymbols(
  market: string
): Promise<{ market: string; count: number; symbols: string[] }> {
  const response = await fetch(`${BASE_URL}/api/scanner/symbols/${market}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}
