/**
 * Production-safe logger utility
 *
 * Logs are only output in development mode (import.meta.env.DEV)
 * In production builds, all log calls become no-ops
 */

// Check if we're in development mode
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

// Force disable all logging for performance testing
// Set to true to enable logs even in dev mode
const FORCE_DISABLE_LOGS = true;

// Enable specific log categories (only when not force-disabled)
const ENABLED_CATEGORIES: Record<string, boolean> = {
  // High-frequency logs - ALWAYS DISABLED
  'price': false,
  'render': false,
  'position': false,
  'fvg': false,
  'backtest': false,

  // Low-frequency logs - can enable for debugging
  'fetch': false,
  'websocket': false,
  'subscription': false,
  'app': false,
  'error': true, // Always show errors
};

function shouldLog(category: string): boolean {
  if (FORCE_DISABLE_LOGS) return false;
  if (!isDev) return false;
  return ENABLED_CATEGORIES[category] ?? false;
}

function createLogger(category: string) {
  return {
    log: (...args: unknown[]) => {
      if (shouldLog(category)) {
        console.log(`[${category}]`, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog(category) || ENABLED_CATEGORIES['error']) {
        console.warn(`[${category}]`, ...args);
      }
    },
    error: (...args: unknown[]) => {
      // Always log errors
      console.error(`[${category}]`, ...args);
    },
    debug: (...args: unknown[]) => {
      if (shouldLog(category)) {
        console.debug(`[${category}]`, ...args);
      }
    },
  };
}

// Pre-created loggers for common categories
export const logger = {
  price: createLogger('price'),
  render: createLogger('render'),
  position: createLogger('position'),
  fvg: createLogger('fvg'),
  backtest: createLogger('backtest'),
  fetch: createLogger('fetch'),
  websocket: createLogger('websocket'),
  subscription: createLogger('subscription'),
  app: createLogger('app'),

  // Generic logger - use sparingly
  general: createLogger('general'),
};

// No-op function for completely removing logs
export const noop = (..._args: unknown[]) => {};

// Conditional log that can be turned off globally
export function debugLog(category: string, ...args: unknown[]) {
  if (shouldLog(category)) {
    console.log(`[${category}]`, ...args);
  }
}

export default logger;
