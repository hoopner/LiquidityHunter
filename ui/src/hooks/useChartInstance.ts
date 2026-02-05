/**
 * useChartInstance — exclusive owner of lightweight-charts lifecycle.
 *
 * RULES:
 * - This is the ONLY place in the codebase where createChart() should be called.
 * - This is the ONLY place where chart.remove() should be called.
 * - Other code uses chartRef.current to interact with the chart (add series, set data, etc.)
 * - The hook handles: creation, cleanup on unmount, resize, and orphan canvas cleanup.
 */

import { useRef, useEffect, useState } from 'react';
import { createChart } from 'lightweight-charts';
import type { IChartApi, DeepPartial, ChartOptions } from 'lightweight-charts';

interface UseChartInstanceOptions {
  /** Chart options passed to createChart(). */
  options?: DeepPartial<ChartOptions>;
  /** If true (default), automatically resize chart when container size changes. */
  autoResize?: boolean;
}

interface UseChartInstanceReturn {
  /** Ref to the chart instance. Use this to add series, set data, etc. */
  chartRef: React.MutableRefObject<IChartApi | null>;
  /** Whether the chart instance is currently created and valid. */
  isReady: boolean;
}

/**
 * Hook that exclusively manages a lightweight-charts instance lifecycle.
 *
 * Usage:
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const { chartRef, isReady } = useChartInstance(containerRef, {
 *   options: { layout: { background: { color: '#131722' } } },
 * });
 *
 * useEffect(() => {
 *   if (!isReady || !chartRef.current) return;
 *   const series = chartRef.current.addSeries(CandlestickSeries);
 *   series.setData(candles);
 * }, [isReady, candles]);
 * ```
 */
export function useChartInstance(
  containerRef: React.RefObject<HTMLDivElement | null>,
  { options = {}, autoResize = true }: UseChartInstanceOptions = {},
): UseChartInstanceReturn {
  const chartRef = useRef<IChartApi | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Safety: remove any existing chart (handles React StrictMode double-mount)
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch (_) {
        // Chart may already be disposed
      }
      chartRef.current = null;
    }

    // Clean orphan canvases left in the container
    container.querySelectorAll('canvas').forEach((c) => {
      try { c.remove(); } catch (_) { /* ignore */ }
    });

    // Create chart
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid' as unknown as undefined, color: 'transparent' },
        textColor: '#d1d5db',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: 'rgba(42, 46, 57, 0.5)',
      },
      timeScale: {
        borderColor: 'rgba(42, 46, 57, 0.5)',
        timeVisible: true,
        secondsVisible: false,
      },
      ...options,
    });

    chartRef.current = chart;
    setIsReady(true);

    // Resize observer
    let resizeObserver: ResizeObserver | null = null;
    if (autoResize) {
      resizeObserver = new ResizeObserver((entries) => {
        if (!chartRef.current) return;
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          chartRef.current.applyOptions({ width, height });
        }
      });
      resizeObserver.observe(container);
    }

    // Cleanup on unmount
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (_) {
          // Chart may already be disposed
        }
        chartRef.current = null;
      }
      setIsReady(false);

      // Final safety: remove any remaining canvases from container
      container.querySelectorAll('canvas').forEach((c) => {
        try { c.remove(); } catch (_) { /* ignore */ }
      });
    };
  }, []); // Empty deps — chart is created once and cleaned up on unmount

  return { chartRef, isReady };
}
