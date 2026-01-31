/**
 * Performance utilities for LiquidityHunter
 *
 * Provides:
 * - Debounce/throttle functions
 * - Performance measurement
 * - Memory monitoring
 * - Animation frame batching
 */

// Check if we're in production mode (Vite uses import.meta.env)
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

/**
 * Debounce function - delays execution until after wait ms have elapsed
 * since the last call. Useful for resize handlers, search input, etc.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, wait);
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

/**
 * Throttle function - limits execution to once per wait ms
 * Useful for scroll handlers, real-time updates, etc.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  const { leading = true, trailing = true } = options;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastCallTime: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();

    // First call
    if (lastCallTime === null) {
      if (leading) {
        fn(...args);
      } else {
        lastArgs = args;
      }
      lastCallTime = now;
      return;
    }

    const elapsed = now - lastCallTime;

    if (elapsed >= wait) {
      // Enough time has passed, execute immediately
      fn(...args);
      lastCallTime = now;
      lastArgs = null;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    } else {
      // Store args for trailing call
      lastArgs = args;

      // Schedule trailing call if not already scheduled
      if (!timeoutId && trailing) {
        timeoutId = setTimeout(() => {
          if (lastArgs) {
            fn(...lastArgs);
            lastCallTime = Date.now();
            lastArgs = null;
          }
          timeoutId = null;
        }, wait - elapsed);
      }
    }
  };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
    lastCallTime = null;
  };

  return throttled;
}

/**
 * RequestAnimationFrame-based render scheduler
 * Batches multiple updates into a single animation frame
 */
export class RenderScheduler {
  private pendingCallbacks: Set<() => void> = new Set();
  private frameId: number | null = null;

  schedule(callback: () => void): void {
    this.pendingCallbacks.add(callback);

    if (this.frameId === null) {
      this.frameId = requestAnimationFrame(() => {
        const callbacks = Array.from(this.pendingCallbacks);
        this.pendingCallbacks.clear();
        this.frameId = null;

        callbacks.forEach(cb => {
          try {
            cb();
          } catch (err) {
            console.error('[RenderScheduler] Callback error:', err);
          }
        });
      });
    }
  }

  cancel(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.pendingCallbacks.clear();
  }
}

// Global render scheduler instance
export const renderScheduler = new RenderScheduler();

/**
 * Performance measurement utility
 * Only logs if operation takes longer than threshold
 */
export function measurePerformance<T>(
  label: string,
  fn: () => T,
  thresholdMs: number = 16 // 60fps = 16ms per frame
): T {
  if (!isDev) {
    return fn();
  }

  const start = performance.now();
  const result = fn();
  const end = performance.now();
  const duration = end - start;

  if (duration > thresholdMs) {
    console.warn(`[Performance] ${label} took ${duration.toFixed(2)}ms (threshold: ${thresholdMs}ms)`);
  }

  return result;
}

/**
 * Async performance measurement
 */
export async function measurePerformanceAsync<T>(
  label: string,
  fn: () => Promise<T>,
  thresholdMs: number = 100
): Promise<T> {
  if (!isDev) {
    return fn();
  }

  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  const duration = end - start;

  if (duration > thresholdMs) {
    console.warn(`[Performance] ${label} took ${duration.toFixed(2)}ms (threshold: ${thresholdMs}ms)`);
  }

  return result;
}

/**
 * Memory usage monitor
 * Logs memory usage periodically in development
 */
export class MemoryMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private peakMemory: number = 0;

  start(intervalMs: number = 10000): void {
    if (!isDev) return;
    if (this.intervalId) return;

    // Check if performance.memory is available (Chrome only)
    if (!('memory' in performance)) {
      console.log('[MemoryMonitor] performance.memory not available (Chrome only)');
      return;
    }

    this.intervalId = setInterval(() => {
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      if (memory) {
        const usedMB = memory.usedJSHeapSize / (1024 * 1024);
        const limitMB = memory.jsHeapSizeLimit / (1024 * 1024);
        const percentUsed = (usedMB / limitMB) * 100;

        if (usedMB > this.peakMemory) {
          this.peakMemory = usedMB;
        }

        // Only warn if usage is high
        if (percentUsed > 70) {
          console.warn(`[MemoryMonitor] High memory usage: ${usedMB.toFixed(1)}MB / ${limitMB.toFixed(1)}MB (${percentUsed.toFixed(1)}%)`);
        }
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getPeakMemory(): number {
    return this.peakMemory;
  }

  logSummary(): void {
    console.log(`[MemoryMonitor] Peak memory usage: ${this.peakMemory.toFixed(1)}MB`);
  }
}

// Global memory monitor (disabled by default)
export const memoryMonitor = new MemoryMonitor();

/**
 * Limited size array that auto-removes oldest items
 * Useful for prediction history, log buffers, etc.
 */
export class LimitedArray<T> {
  private items: T[] = [];
  private maxSize: number;

  constructor(maxSize: number = 30) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    this.items.push(item);
    while (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  getAll(): T[] {
    return [...this.items];
  }

  getLast(n: number = 1): T[] {
    return this.items.slice(-n);
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }
}

/**
 * Shallow comparison for React.memo
 * Compares only specified keys
 */
export function shallowEqualKeys<T extends Record<string, unknown>>(
  keys: (keyof T)[]
): (prev: T, next: T) => boolean {
  return (prev: T, next: T): boolean => {
    for (const key of keys) {
      if (prev[key] !== next[key]) {
        return false;
      }
    }
    return true;
  };
}

/**
 * Deep comparison for specific props
 * Use sparingly - only for complex objects that need deep comparison
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a !== typeof b) return false;

  if (a === null || b === null) return a === b;

  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const keysA = Object.keys(aObj);
  const keysB = Object.keys(bObj);

  if (keysA.length !== keysB.length) return false;

  return keysA.every(key => deepEqual(aObj[key], bObj[key]));
}

/**
 * Cleanup manager - tracks and cleans up resources
 */
export class CleanupManager {
  private cleanupFns: (() => void)[] = [];

  add(cleanupFn: () => void): void {
    this.cleanupFns.push(cleanupFn);
  }

  addInterval(intervalId: ReturnType<typeof setInterval>): void {
    this.cleanupFns.push(() => clearInterval(intervalId));
  }

  addTimeout(timeoutId: ReturnType<typeof setTimeout>): void {
    this.cleanupFns.push(() => clearTimeout(timeoutId));
  }

  addAnimationFrame(frameId: number): void {
    this.cleanupFns.push(() => cancelAnimationFrame(frameId));
  }

  addEventListener(
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ): void {
    target.addEventListener(event, handler, options);
    this.cleanupFns.push(() => target.removeEventListener(event, handler, options));
  }

  cleanup(): void {
    this.cleanupFns.forEach(fn => {
      try {
        fn();
      } catch (err) {
        console.error('[CleanupManager] Cleanup error:', err);
      }
    });
    this.cleanupFns = [];
  }
}

/**
 * FPS counter for debugging
 */
export class FPSCounter {
  private frameCount: number = 0;
  private lastTime: number = performance.now();
  private fps: number = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (!isDev) return;
    if (this.intervalId) return;

    const countFrame = () => {
      this.frameCount++;
      requestAnimationFrame(countFrame);
    };

    requestAnimationFrame(countFrame);

    this.intervalId = setInterval(() => {
      const now = performance.now();
      const elapsed = now - this.lastTime;
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastTime = now;

      if (this.fps < 30) {
        console.warn(`[FPSCounter] Low FPS: ${this.fps}`);
      }
    }, 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getFPS(): number {
    return this.fps;
  }
}

// Export singleton instances
export const fpsCounter = new FPSCounter();
