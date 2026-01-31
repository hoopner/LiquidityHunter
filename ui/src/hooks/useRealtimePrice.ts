/**
 * React hook for real-time price updates via WebSocket
 *
 * ARCHITECTURE:
 * - Uses centralized SubscriptionManager for cleanup
 * - Validates all incoming messages against current symbol
 * - Ensures only ONE active subscription per symbol
 * - Proper cleanup on symbol change and unmount
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { subscriptionManager } from '../utils/subscriptionManager';
import { throttle } from '../utils/performance';
import { logger } from '../utils/logger';

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
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseRealtimePriceOptions {
  enabled?: boolean;
  onPriceUpdate?: (price: RealtimePrice) => void;
}

interface UseRealtimePriceResult {
  price: RealtimePrice | null;
  status: ConnectionStatus;
  error: string | null;
  direction: 'up' | 'down' | 'unchanged';
  reconnect: () => void;
}

const WS_BASE_URL = 'ws://localhost:8000';

// Unique ID generator for this hook instance
let instanceCounter = 0;

export function useRealtimePrice(
  symbol: string,
  market: string,
  options: UseRealtimePriceOptions = {}
): UseRealtimePriceResult {
  const { enabled = true, onPriceUpdate } = options;

  // State
  const [price, setPrice] = useState<RealtimePrice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<'up' | 'down' | 'unchanged'>('unchanged');

  // Refs for tracking
  const wsRef = useRef<WebSocket | null>(null);
  const lastPriceRef = useRef<number | null>(null);
  const instanceIdRef = useRef<string>(`realtime-${++instanceCounter}`);
  const isMountedRef = useRef(true);

  // Store current symbol/market in refs for validation
  const currentSymbolRef = useRef(symbol);
  const currentMarketRef = useRef(market);

  // Performance: Throttled price update setter to prevent excessive re-renders
  // Max update rate of ~60fps (16ms)
  const throttledPriceUpdateRef = useRef(
    throttle((newPrice: RealtimePrice, newDirection: 'up' | 'down' | 'unchanged', callback?: (price: RealtimePrice) => void) => {
      setPrice(newPrice);
      setDirection(newDirection);
      callback?.(newPrice);
    }, 16, { leading: true, trailing: true })
  );

  // Update refs when props change
  useEffect(() => {
    currentSymbolRef.current = symbol;
    currentMarketRef.current = market;
  }, [symbol, market]);

  // Cleanup throttled function on unmount
  useEffect(() => {
    return () => {
      throttledPriceUpdateRef.current.cancel();
    };
  }, []);

  // Cleanup function for this instance
  const cleanupConnection = useCallback(() => {
    logger.websocket.debug('Cleaning up connection for:', currentSymbolRef.current);

    // Unregister all subscriptions for this instance
    const instanceId = instanceIdRef.current;
    subscriptionManager.unregister(`${instanceId}-ws`);
    subscriptionManager.unregister(`${instanceId}-ping`);
    subscriptionManager.unregister(`${instanceId}-reconnect`);

    // Close WebSocket if still open
    if (wsRef.current) {
      const ws = wsRef.current;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    }
  }, []);

  // Connect function
  const connect = useCallback(() => {
    if (!enabled || !symbol) {
      logger.websocket.debug('Not connecting - enabled:', enabled, 'symbol:', symbol);
      return;
    }

    const instanceId = instanceIdRef.current;
    const connectionSymbol = symbol;
    const connectionMarket = market;

    // Clean up any existing connection first
    cleanupConnection();

    if (!isMountedRef.current) return;

    logger.websocket.log('Connecting to:', connectionSymbol, connectionMarket);
    setStatus('connecting');
    setError(null);

    try {
      const ws = new WebSocket(
        `${WS_BASE_URL}/ws/realtime/${encodeURIComponent(connectionSymbol)}?market=${encodeURIComponent(connectionMarket)}`
      );
      wsRef.current = ws;

      // Register WebSocket with subscription manager
      subscriptionManager.registerWebSocket(`${instanceId}-ws`, ws, connectionSymbol);

      ws.onopen = () => {
        // Validate we're still on the same symbol
        if (currentSymbolRef.current !== connectionSymbol) {
          logger.websocket.debug('Symbol changed during connect, closing stale connection');
          ws.close();
          return;
        }

        if (!isMountedRef.current) return;

        logger.websocket.log('Connected to:', connectionSymbol);
        setStatus('connected');
        setError(null);

        // Register ping interval
        subscriptionManager.registerInterval(
          `${instanceId}-ping`,
          () => {
            if (ws.readyState === WebSocket.OPEN && currentSymbolRef.current === connectionSymbol) {
              ws.send('ping');
            }
          },
          30000,
          connectionSymbol
        );
      };

      ws.onmessage = (event) => {
        // CRITICAL: Validate this message is for the current symbol
        if (currentSymbolRef.current !== connectionSymbol) {
          logger.websocket.debug('Ignoring message for stale symbol:', connectionSymbol);
          return;
        }

        if (!isMountedRef.current) return;

        try {
          const data = JSON.parse(event.data);

          if (data.type === 'price') {
            const newPrice: RealtimePrice = {
              price: data.price,
              change: data.change,
              changePct: data.change_pct,
              high: data.high,
              low: data.low,
              open: data.open,
              volume: data.volume,
              prevClose: data.prev_close,
              timestamp: data.timestamp,
              symbol: connectionSymbol,
            };

            // Determine price direction
            let newDirection: 'up' | 'down' | 'unchanged' = 'unchanged';
            if (lastPriceRef.current !== null) {
              if (newPrice.price > lastPriceRef.current) {
                newDirection = 'up';
              } else if (newPrice.price < lastPriceRef.current) {
                newDirection = 'down';
              }
            }
            lastPriceRef.current = newPrice.price;

            // Performance: Use throttled update to prevent excessive re-renders
            throttledPriceUpdateRef.current(newPrice, newDirection, onPriceUpdate);
          } else if (data.type === 'error') {
            logger.websocket.error('Error from server:', data.message);
            setError(data.message);
            if (data.code === 'KIS_NOT_CONFIGURED') {
              setStatus('error');
            }
          } else if (data.type === 'connected') {
            setStatus('connected');
          }
        } catch {
          // Ignore non-JSON messages (pong, etc.)
        }
      };

      ws.onclose = () => {
        // Only handle if this is still the current connection
        if (currentSymbolRef.current !== connectionSymbol) {
          logger.websocket.debug('Closed stale connection for:', connectionSymbol);
          return;
        }

        if (!isMountedRef.current) return;

        logger.websocket.log('Disconnected from:', connectionSymbol);
        setStatus('disconnected');

        // Cleanup ping interval
        subscriptionManager.unregister(`${instanceId}-ping`);

        // Auto-reconnect with backoff (only if still same symbol and enabled)
        if (enabled && currentSymbolRef.current === connectionSymbol) {
          const delay = 3000; // 3 second reconnect delay
          logger.websocket.debug('Scheduling reconnect in', delay, 'ms');

          subscriptionManager.registerTimeout(
            `${instanceId}-reconnect`,
            () => {
              if (currentSymbolRef.current === connectionSymbol && isMountedRef.current) {
                connect();
              }
            },
            delay,
            connectionSymbol
          );
        }
      };

      ws.onerror = () => {
        if (currentSymbolRef.current !== connectionSymbol) return;
        if (!isMountedRef.current) return;

        logger.websocket.error('WebSocket error for:', connectionSymbol);
        setStatus('error');
        setError('WebSocket connection error');
      };
    } catch (err) {
      if (!isMountedRef.current) return;
      logger.websocket.error('Connection failed:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [symbol, market, enabled, onPriceUpdate, cleanupConnection]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    logger.websocket.log('Manual reconnect requested');
    connect();
  }, [connect]);

  // Effect: Connect on mount and symbol change
  useEffect(() => {
    isMountedRef.current = true;

    logger.websocket.debug('Symbol effect triggered:', { symbol, market, enabled });

    if (enabled && symbol) {
      // CRITICAL: Reset ALL state when symbol changes
      setPrice(null);
      setDirection('unchanged');
      setError(null);
      lastPriceRef.current = null;

      // Update subscription manager's current ticker
      subscriptionManager.setCurrentTicker(symbol, market);

      // Connect to new symbol
      connect();
    }

    return () => {
      logger.websocket.debug('Cleanup effect for:', symbol);
      isMountedRef.current = false;
      cleanupConnection();
    };
  }, [symbol, market, enabled, connect, cleanupConnection]);

  // Effect: Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupConnection();
    };
  }, [cleanupConnection]);

  return {
    price,
    status,
    error,
    direction,
    reconnect,
  };
}
