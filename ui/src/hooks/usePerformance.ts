/**
 * Performance-related React hooks
 *
 * Provides:
 * - useDebounce: Debounced value
 * - useDebouncedCallback: Debounced callback
 * - useThrottledCallback: Throttled callback
 * - useAnimationFrame: RAF-batched updates
 * - useCleanup: Automatic cleanup manager
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { debounce, throttle, CleanupManager, renderScheduler } from '../utils/performance';

// Check if we're in dev mode (Vite uses import.meta.env)
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

/**
 * Returns a debounced version of a value
 * Updates only after the specified delay has passed without changes
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns a debounced callback that won't change on each render
 * Automatically cancels pending calls on unmount
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  deps: React.DependencyList = []
): (...args: Parameters<T>) => void {
  const callbackRef = useRef(callback);

  // Update callback ref on each render
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedFn = useMemo(() => {
    const debounced = debounce((...args: Parameters<T>) => {
      callbackRef.current(...args);
    }, delay);
    return debounced;
  }, [delay, ...deps]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      debouncedFn.cancel();
    };
  }, [debouncedFn]);

  return debouncedFn;
}

/**
 * Returns a throttled callback that won't change on each render
 * Automatically cancels pending calls on unmount
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  options: { leading?: boolean; trailing?: boolean } = {},
  deps: React.DependencyList = []
): (...args: Parameters<T>) => void {
  const callbackRef = useRef(callback);

  // Update callback ref on each render
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledFn = useMemo(() => {
    const throttled = throttle((...args: Parameters<T>) => {
      callbackRef.current(...args);
    }, delay, options);
    return throttled;
  }, [delay, options.leading, options.trailing, ...deps]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      throttledFn.cancel();
    };
  }, [throttledFn]);

  return throttledFn;
}

/**
 * Schedule a callback to run in the next animation frame
 * Batches multiple calls into a single frame
 */
export function useAnimationFrame(): (callback: () => void) => void {
  const schedule = useCallback((callback: () => void) => {
    renderScheduler.schedule(callback);
  }, []);

  return schedule;
}

/**
 * Provides an automatic cleanup manager
 * All registered cleanup functions are called on unmount
 */
export function useCleanup(): CleanupManager {
  const managerRef = useRef<CleanupManager | null>(null);

  if (!managerRef.current) {
    managerRef.current = new CleanupManager();
  }

  useEffect(() => {
    return () => {
      managerRef.current?.cleanup();
    };
  }, []);

  return managerRef.current;
}

/**
 * Returns a stable callback that always calls the latest version
 * Useful when you need a stable reference but the callback changes
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const stableCallback = useCallback((...args: Parameters<T>) => {
    return callbackRef.current(...args);
  }, []) as T;

  return stableCallback;
}

/**
 * Returns the previous value of a variable
 * Useful for comparing current vs previous props
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

/**
 * Checks if component is mounted
 * Useful for async operations to prevent state updates after unmount
 */
export function useIsMounted(): () => boolean {
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return useCallback(() => isMountedRef.current, []);
}

/**
 * Force re-render the component
 * Use sparingly - only for edge cases where normal state updates don't work
 */
export function useForceUpdate(): () => void {
  const [, setTick] = useState(0);
  return useCallback(() => setTick(tick => tick + 1), []);
}

/**
 * Track render count for debugging performance
 * Only logs in development mode
 */
export function useRenderCount(componentName: string): void {
  const renderCount = useRef(0);
  renderCount.current += 1;

  useEffect(() => {
    if (isDev) {
      if (renderCount.current > 10) {
        console.log(`[RenderCount] ${componentName}: ${renderCount.current} renders`);
      }
    }
  });
}
