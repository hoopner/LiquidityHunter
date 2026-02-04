import { useMemo } from 'react';
import type { OHLCVResponse, OHLCVBar } from '../api/types';
import type { CandlestickData, LineData, Time } from 'lightweight-charts';

// ===== Types =====
export interface ProcessedBar {
  time: number;           // Unix seconds, timezone-shifted for display
  rawTime: number;        // Original UTC Unix seconds (for reference)
  originalIndex: number;  // Index in original data.bars array
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProcessedChartData {
  // Candlestick data ready for chart
  candlesticks: CandlestickData<Time>[];
  // Processed bars with metadata
  bars: ProcessedBar[];
  // Indicator line data (already filtered and time-shifted)
  ema20: LineData<Time>[];
  ema200: LineData<Time>[];
  sma20: LineData<Time>[];
  sma200: LineData<Time>[];
  // Bollinger Bands
  bb1Upper: LineData<Time>[];
  bb1Middle: LineData<Time>[];
  bb1Lower: LineData<Time>[];
  bb2Upper: LineData<Time>[];
  bb2Lower: LineData<Time>[];
  // Other indicators
  vwap: LineData<Time>[];
  kcUpper: LineData<Time>[];
  kcMiddle: LineData<Time>[];
  kcLower: LineData<Time>[];
}

// ===== Timezone Functions =====

export function getMarketTimezone(market: string): string {
  if (market === 'KR') return 'Asia/Seoul';
  return 'America/New_York';
}

/**
 * Browser-timezone-independent conversion for lightweight-charts display.
 * Uses Intl.DateTimeFormat.formatToParts to extract exact time components
 * in the target timezone, then builds a UTC timestamp with those values.
 * This tricks lightweight-charts into displaying the correct local time
 * regardless of the browser's timezone setting.
 */
export function timeToTz(utcSeconds: number, timeZone: string): number {
  const date = new Date(utcSeconds * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => {
    const val = parts.find(p => p.type === type)?.value || '0';
    return parseInt(val, 10);
  };

  // Build a UTC timestamp with the local time values
  // This tricks lightweight-charts into displaying local time
  const shifted = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second')
  );

  return Math.floor(shifted / 1000);
}

/**
 * Convert any time format to UTC seconds
 */
export function toUtcSeconds(time: string | number): number {
  if (typeof time === 'number') return time;
  return Math.floor(new Date(time).getTime() / 1000);
}

/**
 * Check if bar is within regular trading hours.
 * Uses Intl.DateTimeFormat.formatToParts for browser-timezone-independent results.
 */
export function isRegularHours(utcSeconds: number, market: string): boolean {
  const tz = getMarketTimezone(market);
  const date = new Date(utcSeconds * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const mins = hour * 60 + minute;

  if (market === 'US') return mins >= 570 && mins < 960;   // 9:30 - 16:00
  if (market === 'KR') return mins >= 540 && mins < 930;   // 9:00 - 15:30
  return true;
}

/**
 * Check if timeframe is intraday
 * CASE-SENSITIVE: 1m=minute (lowercase), 1M=month (uppercase)
 */
export function isIntradayTimeframe(tf: string): boolean {
  return ['1m', '5m', '15m', '30m', '1h', '1H', '4h', '4H'].includes(tf);
}

// ===== Main Processing Function =====

interface ProcessOptions {
  market: string;
  timeframe: string;
  filterExtendedHours?: boolean;  // default true for US intraday
}

function processOHLCVData(data: OHLCVResponse, options: ProcessOptions): ProcessedChartData {
  const { market, timeframe } = options;
  const isIntraday = isIntradayTimeframe(timeframe);
  const tz = getMarketTimezone(market);
  const shouldFilterExtended = isIntraday && market === 'US' && options.filterExtendedHours !== false;

  console.log('[ProcessBars] Starting processing:', data.bars.length, 'bars, market:', market, 'tf:', timeframe);
  console.log('[ProcessBars] shouldFilterExtended:', shouldFilterExtended);

  // Debug: Check first bar's time format
  if (data.bars.length > 0) {
    const firstBar = data.bars[0];
    const rawTime = toUtcSeconds(firstBar.time);
    const localDate = new Date(new Date(rawTime * 1000).toLocaleString('en-US', { timeZone: tz }));
    console.log('[ProcessBars] First bar - original time:', firstBar.time,
      'type:', typeof firstBar.time,
      'rawTime (UTC seconds):', rawTime,
      'UTC ISO:', new Date(rawTime * 1000).toISOString(),
      'Local time:', localDate.getHours() + ':' + String(localDate.getMinutes()).padStart(2, '0'));
  }

  // Step 1: Process bars - normalize times, filter extended hours, track indices
  const processedBars: ProcessedBar[] = [];
  const validIndices: number[] = [];  // Track which original indices made it through filtering
  let filteredCount = 0;

  for (let i = 0; i < data.bars.length; i++) {
    const bar = data.bars[i];
    const rawTime = toUtcSeconds(bar.time);

    // Filter extended hours for US intraday
    if (shouldFilterExtended && !isRegularHours(rawTime, market)) {
      filteredCount++;
      // Debug first few filtered bars
      if (filteredCount <= 3) {
        const localDate = new Date(new Date(rawTime * 1000).toLocaleString('en-US', { timeZone: tz }));
        console.log('[ProcessBars] FILTERED OUT bar:', i,
          'local time:', localDate.getHours() + ':' + String(localDate.getMinutes()).padStart(2, '0'));
      }
      continue;
    }

    // Apply timezone shift for display
    const displayTime = isIntraday ? timeToTz(rawTime, tz) : rawTime;

    processedBars.push({
      time: displayTime,
      rawTime,
      originalIndex: i,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    });
    validIndices.push(i);
  }

  console.log('[ProcessBars] After extended hours filter:', processedBars.length, 'kept,', filteredCount, 'filtered out');

  // Debug: Show time range of kept bars
  if (processedBars.length > 0) {
    const firstKept = processedBars[0];
    const lastKept = processedBars[processedBars.length - 1];
    const firstDate = new Date(firstKept.time * 1000);
    const lastDate = new Date(lastKept.time * 1000);
    console.log('[ProcessBars] Kept bars time range (display time):',
      firstDate.getUTCHours() + ':' + String(firstDate.getUTCMinutes()).padStart(2, '0'),
      '→',
      lastDate.getUTCHours() + ':' + String(lastDate.getUTCMinutes()).padStart(2, '0'));
  }

  // Step 2: Dedup by time
  const seen = new Set<number>();
  const dedupedBars: ProcessedBar[] = [];
  const dedupedIndices: number[] = [];

  for (let i = 0; i < processedBars.length; i++) {
    const bar = processedBars[i];
    if (!seen.has(bar.time)) {
      seen.add(bar.time);
      dedupedBars.push(bar);
      dedupedIndices.push(validIndices[i]);
    }
  }

  // Step 3: Sort ascending
  const sortedPairs = dedupedBars
    .map((bar, i) => ({ bar, idx: dedupedIndices[i] }))
    .sort((a, b) => a.bar.time - b.bar.time);

  const finalBars = sortedPairs.map(p => p.bar);
  const finalIndices = sortedPairs.map(p => p.idx);

  // Step 4: Create candlestick data
  const candlesticks: CandlestickData<Time>[] = finalBars.map(bar => {
    const isUp = bar.close > bar.open;
    return {
      time: bar.time as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      // Korean standard: Red=Up, Green=Down
      color: isUp ? '#ef5350' : '#26a69a',
      borderColor: isUp ? '#ef5350' : '#26a69a',
      wickColor: isUp ? '#ef5350' : '#26a69a',
    };
  });

  // Step 5: Create indicator line data using aligned indices
  const toLineData = (arr: (number | null)[] | undefined): LineData<Time>[] => {
    if (!arr) return [];
    const result: LineData<Time>[] = [];
    for (let i = 0; i < finalBars.length; i++) {
      const origIdx = finalIndices[i];
      const value = arr[origIdx];
      if (value != null && value > 0) {
        result.push({
          time: finalBars[i].time as Time,
          value,
        });
      }
    }
    return result;
  };

  // Debug logging
  console.log(`[useProcessedBars] ${timeframe} ${market}: ${data.bars.length} raw → ${finalBars.length} processed`);
  if (finalBars.length > 0 && isIntraday) {
    const first = finalBars[0];
    const last = finalBars[finalBars.length - 1];
    const firstDate = new Date(first.time * 1000);
    const lastDate = new Date(last.time * 1000);
    console.log(`[useProcessedBars] Time range: ${firstDate.getUTCHours()}:${String(firstDate.getUTCMinutes()).padStart(2,'0')} → ${lastDate.getUTCHours()}:${String(lastDate.getUTCMinutes()).padStart(2,'0')}`);
  }

  return {
    candlesticks,
    bars: finalBars,
    ema20: toLineData(data.ema20),
    ema200: toLineData(data.ema200),
    sma20: toLineData(data.sma20),
    sma200: toLineData(data.sma200),
    bb1Upper: toLineData(data.bb1_upper),
    bb1Middle: toLineData(data.bb1_middle),
    bb1Lower: toLineData(data.bb1_lower),
    bb2Upper: toLineData(data.bb2_upper),
    bb2Lower: toLineData(data.bb2_lower),
    vwap: toLineData(data.vwap),
    kcUpper: toLineData(data.kc_upper),
    kcMiddle: toLineData(data.kc_middle),
    kcLower: toLineData(data.kc_lower),
  };
}

// ===== React Hook =====

/**
 * Process OHLCV data for intraday chart rendering.
 * - Converts timestamps to local market time (ET for US, KST for KR)
 * - Filters extended hours for US stocks
 * - Deduplicates and sorts bars
 * - Aligns indicator arrays with filtered bars
 */
export function useProcessedChartData(
  data: OHLCVResponse | null | undefined,
  market: string,
  timeframe: string
): ProcessedChartData | null {
  return useMemo(() => {
    if (!data || !data.bars || data.bars.length === 0) return null;
    return processOHLCVData(data, { market, timeframe });
  }, [data, market, timeframe]);
}

/**
 * Get number of bars in one trading day for a given timeframe
 * CASE-SENSITIVE: 1m=minute, 1M=month
 */
export function getOneDayBars(tf: string): number {
  switch(tf) {
    case '1m': return 390;   // 6.5 hours * 60
    case '5m': return 78;    // 6.5 hours * 12
    case '15m': return 26;   // 6.5 hours * 4
    case '30m': return 13;   // 6.5 hours * 2
    case '1h':
    case '1H': return 7;     // ~6.5 hours
    case '4h':
    case '4H': return 2;     // ~2 bars per day
    default: return 78;
  }
}

// Legacy export for backward compatibility
export function useProcessedBars(
  rawBars: OHLCVBar[] | null | undefined,
  market: string,
  timeframe: string
): ProcessedBar[] {
  return useMemo(() => {
    if (!rawBars || rawBars.length === 0) return [];

    // Create a minimal OHLCVResponse structure
    const mockResponse: OHLCVResponse = {
      symbol: '',
      market,
      timeframe,
      bars: rawBars,
      ema20: [],
      ema200: [],
      sma20: [],
      sma200: [],
      rsi: [],
      rsi_signal: [],
      macd_line: [],
      macd_signal: [],
      macd_histogram: [],
      stoch_slow_k: [],
      stoch_slow_d: [],
      stoch_med_k: [],
      stoch_med_d: [],
      stoch_fast_k: [],
      stoch_fast_d: [],
      bb1_upper: [],
      bb1_middle: [],
      bb1_lower: [],
      bb2_upper: [],
      bb2_middle: [],
      bb2_lower: [],
      rsi_bb_upper: [],
      rsi_bb_middle: [],
      rsi_bb_lower: [],
      vwap: [],
      kc_upper: [],
      kc_middle: [],
      kc_lower: [],
      squeeze: [],
      source: 'kis',
    };

    const result = processOHLCVData(mockResponse, { market, timeframe });
    return result.bars;
  }, [rawBars, market, timeframe]);
}
