/**
 * Centralized Subscription Manager
 *
 * Manages all timers, intervals, and event listeners to prevent memory leaks
 * and ensure clean state transitions when switching tickers.
 *
 * USAGE:
 * - Call register() to add a timer/interval
 * - Call clearAll() when switching tickers
 * - Provides debugging info about active subscriptions
 */

import { logger } from './logger';

type TimerId = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
type CleanupFunction = () => void;

interface Subscription {
  id: string;
  type: 'timer' | 'interval' | 'listener' | 'websocket' | 'cleanup';
  symbol?: string;
  createdAt: number;
  cleanup: CleanupFunction;
}

class SubscriptionManager {
  private subscriptions: Map<string, Subscription> = new Map();
  private currentSymbol: string = '';
  private currentMarket: string = '';
  private debug: boolean = false; // Disabled by default for performance

  /**
   * Set the current active symbol/market
   */
  setCurrentTicker(symbol: string, market: string): void {
    const previousSymbol = this.currentSymbol;
    this.currentSymbol = symbol;
    this.currentMarket = market;

    if (this.debug) {
      logger.subscription.debug('Ticker changed:', {
        from: previousSymbol || '(none)',
        to: symbol,
        market,
        activeSubscriptions: this.subscriptions.size,
      });
    }
  }

  /**
   * Get current ticker info
   */
  getCurrentTicker(): { symbol: string; market: string } {
    return { symbol: this.currentSymbol, market: this.currentMarket };
  }

  /**
   * Register a setTimeout
   */
  registerTimeout(
    id: string,
    callback: () => void,
    delay: number,
    symbol?: string
  ): TimerId {
    // Clear existing timer with same ID
    this.unregister(id);

    const timerId = setTimeout(() => {
      // Auto-cleanup after execution
      this.subscriptions.delete(id);
      callback();
    }, delay);

    this.subscriptions.set(id, {
      id,
      type: 'timer',
      symbol: symbol || this.currentSymbol,
      createdAt: Date.now(),
      cleanup: () => clearTimeout(timerId),
    });

    if (this.debug) {
      logger.subscription.debug('Registered timeout:', id, { delay, symbol: symbol || this.currentSymbol });
    }

    return timerId;
  }

  /**
   * Register a setInterval
   */
  registerInterval(
    id: string,
    callback: () => void,
    interval: number,
    symbol?: string
  ): TimerId {
    // Clear existing interval with same ID
    this.unregister(id);

    const timerId = setInterval(callback, interval);

    this.subscriptions.set(id, {
      id,
      type: 'interval',
      symbol: symbol || this.currentSymbol,
      createdAt: Date.now(),
      cleanup: () => clearInterval(timerId),
    });

    if (this.debug) {
      logger.subscription.debug('Registered interval:', id, { interval, symbol: symbol || this.currentSymbol });
    }

    return timerId;
  }

  /**
   * Register a WebSocket connection
   */
  registerWebSocket(id: string, ws: WebSocket, symbol?: string): void {
    // Clear existing WebSocket with same ID
    this.unregister(id);

    this.subscriptions.set(id, {
      id,
      type: 'websocket',
      symbol: symbol || this.currentSymbol,
      createdAt: Date.now(),
      cleanup: () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      },
    });

    if (this.debug) {
      logger.subscription.debug('Registered WebSocket:', id, { symbol: symbol || this.currentSymbol });
    }
  }

  /**
   * Register a generic cleanup function
   */
  registerCleanup(id: string, cleanup: CleanupFunction, symbol?: string): void {
    // Clear existing cleanup with same ID
    this.unregister(id);

    this.subscriptions.set(id, {
      id,
      type: 'cleanup',
      symbol: symbol || this.currentSymbol,
      createdAt: Date.now(),
      cleanup,
    });

    if (this.debug) {
      logger.subscription.debug('Registered cleanup:', id);
    }
  }

  /**
   * Unregister a specific subscription
   */
  unregister(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (subscription) {
      try {
        subscription.cleanup();
      } catch (e) {
        logger.subscription.warn('Cleanup error for:', id, e);
      }
      this.subscriptions.delete(id);

      if (this.debug) {
        logger.subscription.debug('Unregistered:', id);
      }
    }
  }

  /**
   * Clear all subscriptions for a specific symbol
   */
  clearForSymbol(symbol: string): void {
    const toRemove: string[] = [];

    this.subscriptions.forEach((sub, id) => {
      if (sub.symbol === symbol) {
        toRemove.push(id);
      }
    });

    toRemove.forEach((id) => this.unregister(id));

    if (this.debug) {
      logger.subscription.debug('Cleared for symbol:', symbol, { count: toRemove.length });
    }
  }

  /**
   * Clear ALL subscriptions - use when switching tickers
   */
  clearAll(): void {
    const count = this.subscriptions.size;

    if (this.debug) {
      logger.subscription.debug('Clearing ALL subscriptions:', {
        count,
        subscriptions: Array.from(this.subscriptions.keys()),
      });
    }

    this.subscriptions.forEach((sub, id) => {
      try {
        sub.cleanup();
      } catch (e) {
        logger.subscription.warn('Cleanup error for:', id, e);
      }
    });

    this.subscriptions.clear();

    if (this.debug) {
      logger.subscription.debug('All subscriptions cleared');
    }
  }

  /**
   * Get debug info about active subscriptions
   */
  getDebugInfo(): {
    count: number;
    subscriptions: Array<{ id: string; type: string; symbol?: string; age: number }>;
    currentSymbol: string;
    currentMarket: string;
  } {
    const now = Date.now();
    return {
      count: this.subscriptions.size,
      subscriptions: Array.from(this.subscriptions.values()).map((sub) => ({
        id: sub.id,
        type: sub.type,
        symbol: sub.symbol,
        age: now - sub.createdAt,
      })),
      currentSymbol: this.currentSymbol,
      currentMarket: this.currentMarket,
    };
  }

  /**
   * Check if a symbol matches the current active symbol
   */
  isCurrentSymbol(symbol: string): boolean {
    return this.currentSymbol === symbol;
  }

  /**
   * Enable/disable debug logging
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }
}

// Global singleton instance
export const subscriptionManager = new SubscriptionManager();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as unknown as { __subscriptionManager: SubscriptionManager }).__subscriptionManager = subscriptionManager;
}
