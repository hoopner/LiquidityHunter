/**
 * React hook for real-time price updates via HTTP polling
 * Polls /api/realtime/price endpoint every 5 seconds
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config/api';

export interface RealtimePrice {
  price: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  prevClose: number;
  timestamp: string;
  symbol?: string;
  isExtendedHours?: boolean;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseRealtimePriceOptions {
  enabled?: boolean;
  onPriceUpdate?: (price: RealtimePrice) => void;
  pollInterval?: number;
}

interface UseRealtimePriceResult {
  price: RealtimePrice | null;
  status: ConnectionStatus;
  error: string | null;
  direction: 'up' | 'down' | 'unchanged';
  reconnect: () => void;
  // Additional fields for simple access
  isExtended: boolean;
  lastUpdate: Date | null;
}

export function useRealtimePrice(
  symbol: string,
  market: string = 'KR',
  options: UseRealtimePriceOptions = {}
): UseRealtimePriceResult {
  const { enabled = true, onPriceUpdate, pollInterval = 5000 } = options;

  const [price, setPrice] = useState<RealtimePrice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<'up' | 'down' | 'unchanged'>('unchanged');
  const [isExtended, setIsExtended] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const lastPriceRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrice = useCallback(async () => {
    if (!isMountedRef.current || !symbol || !enabled) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/realtime/price/${encodeURIComponent(symbol)}?market=${encodeURIComponent(market)}`
      );

      if (!response.ok) {
        if (isMountedRef.current) {
          setStatus('error');
          setError(`HTTP ${response.status}`);
        }
        return;
      }

      const data = await response.json();

      if (!isMountedRef.current) return;

      const newPrice = data.price;
      const volume = data.volume || 0;
      const isExtendedHours = data.is_extended_hours || false;
      const timestamp = data.timestamp || new Date().toISOString();

      // Determine direction
      let newDirection: 'up' | 'down' | 'unchanged' = 'unchanged';
      if (lastPriceRef.current !== null) {
        if (newPrice > lastPriceRef.current) {
          newDirection = 'up';
        } else if (newPrice < lastPriceRef.current) {
          newDirection = 'down';
        }
      }
      lastPriceRef.current = newPrice;
      setDirection(newDirection);

      // Calculate change (use last price as reference since we don't have prevClose)
      const prevClose = lastPriceRef.current || newPrice;
      const change = newPrice - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

      const priceData: RealtimePrice = {
        price: newPrice,
        change: change,
        changePct: changePct,
        high: newPrice,
        low: newPrice,
        open: prevClose,
        volume: volume,
        prevClose: prevClose,
        timestamp: timestamp,
        symbol: symbol,
        isExtendedHours: isExtendedHours,
      };

      setPrice(priceData);
      setIsExtended(isExtendedHours);
      setLastUpdate(new Date(timestamp));
      setStatus('connected');
      setError(null);

      // Call callback if provided
      if (onPriceUpdate) {
        onPriceUpdate(priceData);
      }
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Failed to fetch real-time price:', err);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to fetch price');
      }
    }
  }, [symbol, market, enabled, onPriceUpdate]);

  // Start/stop polling based on enabled state
  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled || !symbol) {
      setStatus('disconnected');
      return;
    }

    // Reset state on symbol change
    setPrice(null);
    setDirection('unchanged');
    setError(null);
    lastPriceRef.current = null;
    setStatus('connecting');

    // Fetch immediately
    fetchPrice();

    // Then poll at interval
    intervalRef.current = setInterval(fetchPrice, pollInterval);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [symbol, market, enabled, fetchPrice, pollInterval]);

  const reconnect = useCallback(() => {
    setStatus('connecting');
    fetchPrice();
  }, [fetchPrice]);

  return {
    price,
    status,
    error,
    direction,
    reconnect,
    isExtended,
    lastUpdate,
  };
}

// Default export for backward compatibility
export default useRealtimePrice;
