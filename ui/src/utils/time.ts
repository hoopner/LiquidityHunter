/**
 * Time conversion utilities for lightweight-charts.
 *
 * This is the SINGLE source of truth for all timezone conversion in the frontend.
 * DO NOT create timeToTz / getMarketTimezone / isIntradayTimeframe anywhere else.
 * Always: import { timeToTz, getMarketTimezone, isIntradayTimeframe } from '../../utils/time';
 */

/**
 * Get the IANA timezone string for a market.
 */
export function getMarketTimezone(market: string): string {
  return market === 'KR' ? 'Asia/Seoul' : 'America/New_York';
}

/**
 * Convert a UTC Unix timestamp to a timezone-adjusted timestamp for lightweight-charts.
 *
 * lightweight-charts treats all times as UTC internally, so we "trick" it by
 * extracting the wall-clock components in the target timezone via
 * Intl.DateTimeFormat.formatToParts, then building a new UTC timestamp from
 * those components. This is browser-timezone-independent.
 *
 * Official approach: https://tradingview.github.io/lightweight-charts/docs/time-zones
 */
export function timeToTz(utcTimestamp: number, timeZone: string): number {
  if (!Number.isFinite(utcTimestamp) || utcTimestamp <= 0) {
    return 0;
  }
  const date = new Date(utcTimestamp * 1000);
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
 * Convert any time format (string or number) to UTC seconds.
 */
export function toUtcSeconds(time: string | number): number {
  if (typeof time === 'number') return time;
  return Math.floor(new Date(time).getTime() / 1000);
}

/**
 * Check if a timeframe is intraday (minute/hour based).
 * CASE-SENSITIVE: 1m = minute (lowercase), 1M = month (uppercase).
 */
export function isIntradayTimeframe(tf: string): boolean {
  return ['1m', '5m', '15m', '30m', '1h', '1H', '4h', '4H'].includes(tf);
}
