/**
 * Chart data mappers — converts API response data to lightweight-charts format.
 *
 * This is the SINGLE place where bar/indicator → chart series conversion is defined.
 * All mappers apply timezone shifting via timeToTz.
 */

import type { CandlestickData, LineData, HistogramData, Time } from 'lightweight-charts';
import { timeToTz } from './time';

/**
 * Map API bars to lightweight-charts CandlestickData.
 */
export function mapBarsToCandles(
  bars: Array<{ time: number; open: number; high: number; low: number; close: number }>,
  timeZone: string,
): CandlestickData<Time>[] {
  return bars.map(bar => ({
    time: timeToTz(bar.time, timeZone) as unknown as Time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
}

/**
 * Map parallel timestamp + value arrays to lightweight-charts LineData.
 * Filters out null / undefined / NaN / zero values.
 */
export function mapToLineSeries(
  timestamps: number[],
  values: (number | null | undefined)[],
  timeZone: string,
): LineData<Time>[] {
  const result: LineData<Time>[] = [];
  const len = Math.min(timestamps.length, values.length);

  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (v != null && !isNaN(v) && v !== 0) {
      result.push({
        time: timeToTz(timestamps[i], timeZone) as unknown as Time,
        value: v,
      });
    }
  }
  return result;
}

/**
 * Map parallel timestamp + value arrays to lightweight-charts HistogramData.
 * Keeps zero values (histograms often cross zero, e.g. MACD).
 * Filters out null / undefined / NaN only.
 */
export function mapToHistogramSeries(
  timestamps: number[],
  values: (number | null | undefined)[],
  timeZone: string,
): HistogramData<Time>[] {
  const result: HistogramData<Time>[] = [];
  const len = Math.min(timestamps.length, values.length);

  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (v != null && !isNaN(v)) {
      result.push({
        time: timeToTz(timestamps[i], timeZone) as unknown as Time,
        value: v,
      });
    }
  }
  return result;
}
