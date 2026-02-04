import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  LineData,
  HistogramData,
  Time,
} from 'lightweight-charts';
import { fetchOHLCV } from '../../api/client';
import type { OHLCVResponse } from '../../api/types';
import type { DrawingToolType } from '../../types/drawings';
import { useDrawings } from '../../hooks/useDrawings';
import { SubChartDrawingCanvas } from '../chart/SubChartDrawingCanvas';
import type { ChartType } from '../../utils/DrawingManager';

/**
 * Get market timezone string for Intl API
 */
function getMarketTimezone(market: string): string {
  return market === 'KR' ? 'Asia/Seoul' : 'America/New_York';
}

/**
 * Convert UTC Unix timestamp to market local time for lightweight-charts.
 * Official approach: https://tradingview.github.io/lightweight-charts/docs/time-zones
 * lightweight-charts treats all times as UTC internally,
 * so we "trick" it by shifting the timestamp.
 */
function timeToTz(originalTime: number, timeZone: string): number {
  const zonedDate = new Date(
    new Date(originalTime * 1000).toLocaleString('en-US', { timeZone })
  );
  return Math.floor(zonedDate.getTime() / 1000);
}

/**
 * Check if timeframe is intraday (minute/hour based)
 * CASE-SENSITIVE: 1m=minute, 1M=month
 */
function isIntradayTimeframe(tf: string): boolean {
  return ['1m', '5m', '15m', '30m', '1h', '1H', '4h', '4H'].includes(tf);
}

// Indicator types - replaced Williams %R with 3 Stochastics
export type IndicatorType = 'stoch_slow' | 'stoch_med' | 'stoch_fast' | 'rsi' | 'macd' | 'volume' | 'rsi_bb';
export type ExpandedIndicator = IndicatorType | null;

interface SubChartsProps {
  symbol?: string;
  market?: string;
  timeframe?: string;
  visibleRange?: { from: number; to: number } | null;
  // Shared OHLCV data from MainChart (for timeline sync)
  sharedData?: OHLCVResponse | null;
  // Drawing support
  drawingToolActive?: DrawingToolType | null;
  activeChartType?: ChartType | null;
  onChartActivate?: (chartType: ChartType) => void;
  onDrawingComplete?: () => void;
}

// Indicator config with colors
const indicatorConfig: Record<IndicatorType, { label: string; shortLabel: string; color: string; kColor?: string; dColor?: string }> = {
  stoch_slow: {
    label: 'Stoch Slow (20,12,12)',
    shortLabel: 'Stoch S',
    color: '#3b82f6',  // Blue for %K
    kColor: '#3b82f6',
    dColor: '#f97316',  // Orange for %D
  },
  stoch_med: {
    label: 'Stoch Med (10,6,6)',
    shortLabel: 'Stoch M',
    color: '#22c55e',  // Green for %K
    kColor: '#22c55e',
    dColor: '#f97316',  // Orange for %D
  },
  stoch_fast: {
    label: 'Stoch Fast (5,3,3)',
    shortLabel: 'Stoch F',
    color: '#06b6d4',  // Cyan for %K
    kColor: '#06b6d4',
    dColor: '#f97316',  // Orange for %D
  },
  rsi: { label: 'RSI (14)', shortLabel: 'RSI', color: '#06b6d4' },
  macd: { label: 'MACD (12,26,9)', shortLabel: 'MACD', color: '#3b82f6' },
  volume: { label: 'Volume', shortLabel: 'Vol', color: '#26a69a' },
  rsi_bb: { label: 'RSI BB (14,30,2)', shortLabel: 'RSI BB', color: '#a855f7' },
};

// Default order: Stoch Slow (top), Stoch Med, Stoch Fast, RSI, MACD, Volume, RSI BB (bottom)
const DEFAULT_INDICATOR_ORDER: IndicatorType[] = ['stoch_slow', 'stoch_med', 'stoch_fast', 'rsi', 'macd', 'volume', 'rsi_bb'];

// LocalStorage key for persisting order
const INDICATOR_ORDER_KEY = 'subchart_indicator_order';

// Load indicator order from localStorage
function loadIndicatorOrder(): IndicatorType[] {
  try {
    const stored = localStorage.getItem(INDICATOR_ORDER_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as IndicatorType[];
      // Validate that all indicators are present
      if (parsed.length === DEFAULT_INDICATOR_ORDER.length &&
          DEFAULT_INDICATOR_ORDER.every(ind => parsed.includes(ind))) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return [...DEFAULT_INDICATOR_ORDER];
}

// Save indicator order to localStorage
function saveIndicatorOrder(order: IndicatorType[]): void {
  try {
    localStorage.setItem(INDICATOR_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Sub-charts component - ALL charts are SLAVES to main candlestick chart
 * - No independent mouse interaction
 * - All use same OHLCV data timestamps
 * - All sync to main chart's visible range
 */
export function SubCharts({
  symbol = '005930',
  market = 'KR',
  timeframe = '1D',
  visibleRange: externalVisibleRange,
  sharedData,
  drawingToolActive,
  activeChartType,
  onChartActivate,
  onDrawingComplete,
}: SubChartsProps) {
  // Use shared data from MainChart if provided, otherwise fetch independently (fallback)
  const [localData, setLocalData] = useState<OHLCVResponse | null>(null);
  const data = sharedData ?? localData;
  // RSI BB is off by default (user can toggle it on)
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorType>>(
    new Set(['stoch_slow', 'stoch_med', 'stoch_fast', 'rsi', 'macd', 'volume'])
  );
  const [expandedIndicator, setExpandedIndicator] = useState<ExpandedIndicator>(null);

  // Indicator order (for drag-and-drop reordering)
  const [indicatorOrder, setIndicatorOrder] = useState<IndicatorType[]>(loadIndicatorOrder);

  // Drag state
  const [draggedIndicator, setDraggedIndicator] = useState<IndicatorType | null>(null);
  const [dropTargetIndicator, setDropTargetIndicator] = useState<IndicatorType | null>(null);

  // Chart refs - store all chart instances for syncing
  const chartRefs = useRef<Map<IndicatorType, IChartApi>>(new Map());

  // Series refs - store series for drawing coordinate conversion
  const seriesRefs = useRef<Map<IndicatorType, ISeriesApi<'Line' | 'Histogram'>>>(new Map());

  // Drawing hooks for each indicator type
  const stochSlowDrawings = useDrawings(symbol, timeframe, 'stoch_slow');
  const stochMedDrawings = useDrawings(symbol, timeframe, 'stoch_med');
  const stochFastDrawings = useDrawings(symbol, timeframe, 'stoch_fast');
  const rsiDrawings = useDrawings(symbol, timeframe, 'rsi');
  const macdDrawings = useDrawings(symbol, timeframe, 'macd');
  const volumeDrawings = useDrawings(symbol, timeframe, 'volume');
  const rsiBBDrawings = useDrawings(symbol, timeframe, 'rsi_bb');

  // Map indicator type to drawing hook
  const drawingHooks: Record<IndicatorType, typeof stochSlowDrawings> = {
    stoch_slow: stochSlowDrawings,
    stoch_med: stochMedDrawings,
    stoch_fast: stochFastDrawings,
    rsi: rsiDrawings,
    macd: macdDrawings,
    volume: volumeDrawings,
    rsi_bb: rsiBBDrawings,
  };


  // Only fetch data if sharedData is not provided (fallback mode)
  useEffect(() => {
    if (sharedData) return; // Use shared data from MainChart instead
    fetchOHLCV(symbol, market, timeframe)
      .then(setLocalData)
      .catch(() => setLocalData(null));
  }, [symbol, market, timeframe, sharedData]);

  // CRITICAL: Sync ALL subcharts to main chart's visible range
  useEffect(() => {
    if (!externalVisibleRange) return;

    // Apply same range to ALL subchart instances
    chartRefs.current.forEach((chart) => {
      try {
        chart.timeScale().setVisibleLogicalRange(externalVisibleRange);
      } catch {
        // Chart may not be ready
      }
    });
  }, [externalVisibleRange]);

  // ESC to close expanded view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expandedIndicator) {
        setExpandedIndicator(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedIndicator]);

  // Toggle indicator visibility
  const toggleIndicator = (indicator: IndicatorType) => {
    setActiveIndicators(prev => {
      const next = new Set(prev);
      if (next.has(indicator)) {
        next.delete(indicator);
      } else {
        next.add(indicator);
      }
      return next;
    });
  };

  // Drag-and-drop handlers
  const handleDragStart = useCallback((indicator: IndicatorType) => (e: React.DragEvent) => {
    setDraggedIndicator(indicator);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', indicator);
    // Add a slight delay to allow the drag image to be captured
    setTimeout(() => {
      (e.target as HTMLElement).style.opacity = '0.5';
    }, 0);
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setDraggedIndicator(null);
    setDropTargetIndicator(null);
  }, []);

  const handleDragOver = useCallback((indicator: IndicatorType) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndicator && indicator !== draggedIndicator) {
      setDropTargetIndicator(indicator);
    }
  }, [draggedIndicator]);

  const handleDragLeave = useCallback(() => {
    setDropTargetIndicator(null);
  }, []);

  const handleDrop = useCallback((targetIndicator: IndicatorType) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedIndicator || draggedIndicator === targetIndicator) {
      setDraggedIndicator(null);
      setDropTargetIndicator(null);
      return;
    }

    setIndicatorOrder(prev => {
      const newOrder = [...prev];
      const draggedIndex = newOrder.indexOf(draggedIndicator);
      const targetIndex = newOrder.indexOf(targetIndicator);

      // Remove dragged item
      newOrder.splice(draggedIndex, 1);
      // Insert at target position
      newOrder.splice(targetIndex, 0, draggedIndicator);

      // Save to localStorage
      saveIndicatorOrder(newOrder);
      return newOrder;
    });

    setDraggedIndicator(null);
    setDropTargetIndicator(null);
  }, [draggedIndicator]);

  // Store external visible range in ref for use in callbacks
  const visibleRangeRef = useRef(externalVisibleRange);
  visibleRangeRef.current = externalVisibleRange;

  // Register chart instance for syncing - stable callback
  const registerChart = useCallback((indicator: IndicatorType, chart: IChartApi | null) => {
    if (chart) {
      chartRefs.current.set(indicator, chart);
      // Immediately sync to current visible range
      if (visibleRangeRef.current) {
        try {
          chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
        } catch {
          // Ignore
        }
      }
    } else {
      chartRefs.current.delete(indicator);
    }
  }, []);

  // Register series instance for drawing coordinate conversion
  const registerSeries = useCallback((indicator: IndicatorType, series: ISeriesApi<'Line' | 'Histogram'> | null) => {
    if (series) {
      seriesRefs.current.set(indicator, series);
    } else {
      seriesRefs.current.delete(indicator);
    }
  }, []);

  // Render toggle button
  const renderToggleButton = (indicator: IndicatorType) => {
    const config = indicatorConfig[indicator];
    const isActive = activeIndicators.has(indicator);
    return (
      <button
        key={indicator}
        onClick={() => toggleIndicator(indicator)}
        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
          isActive
            ? 'text-white'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
        style={isActive ? { backgroundColor: config.color } : {}}
      >
        {config.shortLabel}
      </button>
    );
  };

  // Get current value for display
  const getCurrentValue = (indicator: IndicatorType) => {
    if (!data) return null;
    const config = indicatorConfig[indicator];

    switch (indicator) {
      case 'stoch_slow': {
        const k = data.stoch_slow_k?.[data.stoch_slow_k.length - 1];
        const d = data.stoch_slow_d?.[data.stoch_slow_d.length - 1];
        return (
          <>
            {k != null && !isNaN(k) && <span style={{ color: config.kColor }}>K:{k.toFixed(0)}</span>}
            {' '}
            {d != null && !isNaN(d) && <span style={{ color: config.dColor }}>D:{d.toFixed(0)}</span>}
          </>
        );
      }
      case 'stoch_med': {
        const k = data.stoch_med_k?.[data.stoch_med_k.length - 1];
        const d = data.stoch_med_d?.[data.stoch_med_d.length - 1];
        return (
          <>
            {k != null && !isNaN(k) && <span style={{ color: config.kColor }}>K:{k.toFixed(0)}</span>}
            {' '}
            {d != null && !isNaN(d) && <span style={{ color: config.dColor }}>D:{d.toFixed(0)}</span>}
          </>
        );
      }
      case 'stoch_fast': {
        const k = data.stoch_fast_k?.[data.stoch_fast_k.length - 1];
        const d = data.stoch_fast_d?.[data.stoch_fast_d.length - 1];
        return (
          <>
            {k != null && !isNaN(k) && <span style={{ color: config.kColor }}>K:{k.toFixed(0)}</span>}
            {' '}
            {d != null && !isNaN(d) && <span style={{ color: config.dColor }}>D:{d.toFixed(0)}</span>}
          </>
        );
      }
      case 'rsi': {
        const v = data.rsi?.[data.rsi.length - 1];
        if (v == null || v <= 0) return null;
        const color = v >= 70 ? '#ef5350' : v <= 30 ? '#26a69a' : '#06b6d4';
        return <span style={{ color, fontWeight: 500 }}>{v.toFixed(1)}</span>;
      }
      case 'macd': {
        const v = data.macd_line?.[data.macd_line.length - 1];
        if (v == null || v === 0) return null;
        const color = v >= 0 ? '#26a69a' : '#ef5350';
        return <span style={{ color, fontWeight: 500 }}>{v.toFixed(0)}</span>;
      }
      case 'volume': {
        const bar = data.bars?.[data.bars.length - 1];
        if (!bar) return null;
        return <span style={{ color: 'var(--text-primary)' }}>{(bar.volume / 1000000).toFixed(1)}M</span>;
      }
      case 'rsi_bb': {
        const v = data.rsi?.[data.rsi.length - 1];
        if (v == null || v <= 0) return null;
        const color = v >= 70 ? '#ef5350' : v <= 30 ? '#26a69a' : '#a855f7';
        return <span style={{ color, fontWeight: 500 }}>{v.toFixed(1)}</span>;
      }
    }
  };

  // Expanded view
  if (expandedIndicator) {
    const config = indicatorConfig[expandedIndicator];
    return (
      <div className="flex flex-col h-full border-t border-[var(--border-color)]">
        {/* Toggle buttons - order follows subchart order */}
        <div className="px-2 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-2">
          {indicatorOrder.map(renderToggleButton)}
        </div>

        {/* Expanded header */}
        <div className="px-2 py-1 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)] flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: config.color }}>{config.label}</span>
          {getCurrentValue(expandedIndicator)}
          <button
            onClick={() => setExpandedIndicator(null)}
            className="ml-auto px-2 py-0.5 text-xs bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
          >
            닫기 (ESC)
          </button>
        </div>

        {/* Expanded chart */}
        <div className="flex-1">
          <IndicatorChart
            key={`${expandedIndicator}-${timeframe}-expanded`}
            indicator={expandedIndicator}
            data={data}
            showTimeScale={true}
            onChartReady={(chart) => registerChart(expandedIndicator, chart)}
            onSeriesReady={(series) => registerSeries(expandedIndicator, series)}
            drawingToolActive={drawingToolActive}
            isActiveChart={activeChartType === expandedIndicator}
            onChartActivate={() => onChartActivate?.(expandedIndicator)}
            onDrawingComplete={onDrawingComplete}
            drawingHook={drawingHooks[expandedIndicator]}
            externalVisibleRange={externalVisibleRange}
            market={market}
            timeframe={timeframe}
          />
        </div>
      </div>
    );
  }

  // Normal view with all active indicators
  return (
    <div className="flex flex-col h-full border-t border-[var(--border-color)]">
      {/* Toggle buttons - order follows subchart order */}
      <div className="px-2 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)] mr-1">지표:</span>
        {indicatorOrder.map(renderToggleButton)}
      </div>

      {/* Subcharts - all use same data, all synced, draggable for reordering */}
      {/* scrollbar-gutter: stable reserves space for scrollbar to prevent width changes */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        {indicatorOrder.map(indicator => {
          if (!activeIndicators.has(indicator)) return null;
          const config = indicatorConfig[indicator];
          const isDragging = draggedIndicator === indicator;
          const isDropTarget = dropTargetIndicator === indicator;
          return (
            <div
              key={indicator}
              className={`flex flex-col border-b border-[var(--border-color)] transition-all ${
                isDragging ? 'opacity-50' : ''
              } ${isDropTarget ? 'border-t-2 border-t-[var(--accent-blue)]' : ''}`}
              style={{ height: '90px' }}
            >
              {/* Header - draggable */}
              <div
                draggable
                onDragStart={handleDragStart(indicator)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver(indicator)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(indicator)}
                onClick={() => setExpandedIndicator(indicator)}
                className="px-2 py-0.5 text-xs bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-2 cursor-grab hover:bg-[var(--bg-tertiary)] transition-colors active:cursor-grabbing select-none"
              >
                {/* Drag handle icon */}
                <span className="text-[var(--text-secondary)] opacity-50 hover:opacity-100" title="드래그하여 순서 변경">
                  ⠿
                </span>
                <span className="text-[var(--text-secondary)]">{config.label}</span>
                {getCurrentValue(indicator)}
                <span className="ml-auto text-[10px] text-[var(--text-secondary)]">클릭: 확대 | 드래그: 순서 변경</span>
              </div>
              {/* Chart */}
              <div className="flex-1 min-h-0">
                <IndicatorChart
                  key={`${indicator}-${timeframe}`}
                  indicator={indicator}
                  data={data}
                  showTimeScale={indicator === 'volume'}
                  onChartReady={(chart) => registerChart(indicator, chart)}
                  onSeriesReady={(series) => registerSeries(indicator, series)}
                  drawingToolActive={drawingToolActive}
                  isActiveChart={activeChartType === indicator}
                  onChartActivate={() => onChartActivate?.(indicator)}
                  onDrawingComplete={onDrawingComplete}
                  drawingHook={drawingHooks[indicator]}
                  externalVisibleRange={externalVisibleRange}
                  market={market}
                  timeframe={timeframe}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Individual indicator chart - NO independent mouse control
 * Timeline is controlled externally via parent's sync mechanism
 */
function IndicatorChart({
  indicator,
  data,
  showTimeScale = false,
  onChartReady,
  onSeriesReady,
  drawingToolActive,
  isActiveChart,
  onChartActivate,
  onDrawingComplete,
  drawingHook,
  externalVisibleRange,
  market = 'KR',
  timeframe = '1D',
}: {
  indicator: IndicatorType;
  data: OHLCVResponse | null;
  showTimeScale?: boolean;
  onChartReady: (chart: IChartApi | null) => void;
  onSeriesReady?: (series: ISeriesApi<'Line' | 'Histogram'> | null) => void;
  drawingToolActive?: DrawingToolType | null;
  isActiveChart?: boolean;
  onChartActivate?: () => void;
  onDrawingComplete?: () => void;
  drawingHook?: ReturnType<typeof useDrawings>;
  externalVisibleRange?: { from: number; to: number } | null;
  market?: string;
  timeframe?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line' | 'Histogram'>[]>([]);
  const [chartReady, setChartReady] = useState(false);
  // Fingerprint to prevent infinite setData loops
  const prevDataFingerprintRef = useRef<string>('');

  const config = indicatorConfig[indicator];


  // Create chart with NO mouse interactions for timeline
  useEffect(() => {
    if (!containerRef.current) return;

    // NOTE: Data timestamps are already shifted to local market time
    // NO additional offset needed in formatter - just format directly
    // CASE-SENSITIVE: 1m=minute, 1M=month
    const isIntradayTf = ['1m', '5m', '15m', '30m', '1h', '1H', '4h', '4H'].includes(timeframe);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        scaleMargins: { top: 0.1, bottom: 0.1 },
        minimumWidth: 60,  // Fixed width for alignment with main chart
      },
      timeScale: {
        borderColor: '#2a2e39',
        visible: showTimeScale,
        timeVisible: isIntradayTf,
        secondsVisible: false,
        rightOffset: 20,  // MUST match main chart exactly for timeline sync
        // CRITICAL: These settings must match MainChart for consistent labels
        // Custom tick formatter for intraday: show HH:MM
        tickMarkFormatter: isIntradayTf ? (time: number) => {
          const date = new Date(time * 1000);
          const hours = date.getUTCHours().toString().padStart(2, '0');
          const minutes = date.getUTCMinutes().toString().padStart(2, '0');
          return `${hours}:${minutes}`;
        } : undefined,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#758696', width: 1, style: 3, labelVisible: false },
        horzLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2a2e39' },
      },
      // CRITICAL: Disable ALL mouse interactions - subchart is SLAVE to main chart
      handleScroll: false,
      handleScale: false,
      // Localization - data is already timezone-shifted, no additional offset needed
      localization: {
        timeFormatter: (time: number | { year: number; month: number; day: number }) => {
          if (typeof time === 'number') {
            // Unix timestamp already shifted to local market time
            const date = new Date(time * 1000);
            if (isIntradayTf) {
              const hours = date.getUTCHours().toString().padStart(2, '0');
              const minutes = date.getUTCMinutes().toString().padStart(2, '0');
              return `${hours}:${minutes}`;
            }
            // Daily: YYYY-MM-DD
            const y = date.getUTCFullYear();
            const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
            const d = date.getUTCDate().toString().padStart(2, '0');
            return `${y}-${m}-${d}`;
          }
          // BusinessDay object
          return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
        },
      },
    });

    chartRef.current = chart;
    seriesRef.current = [];

    // Add series based on indicator type
    switch (indicator) {
      case 'stoch_slow':
      case 'stoch_med':
      case 'stoch_fast': {
        // %D line (drawn first, behind %K)
        const d = chart.addSeries(LineSeries, {
          color: config.dColor || '#f97316',
          lineWidth: 1,
          priceLineVisible: false,
        });
        // %K line (drawn on top)
        const k = chart.addSeries(LineSeries, {
          color: config.kColor || config.color,
          lineWidth: 2,
          priceLineVisible: false,
        });
        // Reference lines: 80 (overbought), 50 (middle), 20 (oversold)
        k.createPriceLine({ price: 80, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        k.createPriceLine({ price: 50, color: '#758696', lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
        k.createPriceLine({ price: 20, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        seriesRef.current = [k, d];
        break;
      }
      case 'rsi': {
        const signal = chart.addSeries(LineSeries, {
          color: '#a855f7',
          lineWidth: 1,
          priceLineVisible: false,
        });
        const main = chart.addSeries(LineSeries, {
          color: '#06b6d4',
          lineWidth: 2,
          priceLineVisible: false,
        });
        main.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        main.createPriceLine({ price: 50, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        main.createPriceLine({ price: 30, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        seriesRef.current = [main, signal];
        break;
      }
      case 'macd': {
        const histogram = chart.addSeries(HistogramSeries, {
          priceLineVisible: false,
        });
        const signal = chart.addSeries(LineSeries, {
          color: '#f97316',
          lineWidth: 1,
          priceLineVisible: false,
        });
        const line = chart.addSeries(LineSeries, {
          color: '#3b82f6',
          lineWidth: 2,
          priceLineVisible: false,
        });
        seriesRef.current = [line, signal, histogram];
        break;
      }
      case 'volume': {
        const main = chart.addSeries(HistogramSeries, {
          priceLineVisible: false,
          priceFormat: { type: 'volume' },
        });
        seriesRef.current = [main];
        break;
      }
      case 'rsi_bb': {
        // BB lower line - red
        const bbLower = chart.addSeries(LineSeries, {
          color: '#ef4444',
          lineWidth: 1,
          priceLineVisible: false,
        });
        // BB upper line - red
        const bbUpper = chart.addSeries(LineSeries, {
          color: '#ef4444',
          lineWidth: 1,
          priceLineVisible: false,
        });
        // RSI line - purple (thinner at 2px)
        const rsiLine = chart.addSeries(LineSeries, {
          color: '#a855f7',
          lineWidth: 2,
          priceLineVisible: false,
        });
        // Only 50 level line (no 70, 30)
        rsiLine.createPriceLine({ price: 50, color: '#6b7280', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        seriesRef.current = [rsiLine, bbUpper, bbLower];
        break;
      }
    }

    // Resize handler
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    // Notify parent that chart is ready
    onChartReady(chart);
    setChartReady(true);

    return () => {
      window.removeEventListener('resize', handleResize);
      onChartReady(null);
      onSeriesReady?.(null);
      setChartReady(false);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicator, showTimeScale, market, timeframe]); // onChartReady, onSeriesReady intentionally excluded - they're stable via useCallback

  // Update chart data - use SAME timestamps from OHLCV data
  // TIMEZONE: Apply same shift as MainChart to align with main candles
  useEffect(() => {
    if (!data || !chartRef.current || seriesRef.current.length === 0) {
      return;
    }

    // Create fingerprint to avoid re-setting identical data (prevents infinite loop)
    const firstTime = data.bars[0]?.time;
    const lastTime = data.bars[data.bars.length - 1]?.time;
    const fingerprint = `${indicator}-${data.bars.length}-${firstTime}-${lastTime}-${timeframe}-${market}`;
    if (fingerprint === prevDataFingerprintRef.current) {
      return; // Skip - data hasn't changed
    }
    prevDataFingerprintRef.current = fingerprint;

    console.log('[SubChart]', indicator, 'Setting data:', data.bars.length, 'bars');

    // Use official lightweight-charts timezone approach (must match MainChart)
    const isIntraday = isIntradayTimeframe(timeframe);
    const tz = getMarketTimezone(market);

    // Helper to apply timezone shift to a bar's time
    const shiftTime = (barTime: any): Time => {
      if (isIntraday && typeof barTime === 'number') {
        return timeToTz(barTime, tz) as Time;
      } else if (isIntraday && typeof barTime === 'string') {
        // Handle both ISO datetime "2024-02-05T09:30:00" and plain date "2024-02-05"
        const utcSeconds = Math.floor(new Date(barTime).getTime() / 1000);
        return timeToTz(utcSeconds, tz) as Time;
      }
      return barTime as Time;
    };

    // All indicators use the SAME timestamp array from data.bars (with timezone shift)
    const times = data.bars.map(bar => shiftTime(bar.time));

    // Safe setData wrapper with error handling
    const safeSetData = (series: ISeriesApi<'Line' | 'Histogram'>, chartData: any[], name: string) => {
      try {
        series.setData(chartData);
        console.log('[SubChart]', indicator, name, ':', chartData.length, 'points');
      } catch (e) {
        console.error('[SubChart]', indicator, name, 'setData error:', e);
      }
    };

    switch (indicator) {
      case 'stoch_slow': {
        const [k, d] = seriesRef.current;
        const kData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.stoch_slow_k?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        const dData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.stoch_slow_d?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        safeSetData(k as ISeriesApi<'Line'>, kData, '%K');
        safeSetData(d as ISeriesApi<'Line'>, dData, '%D');
        break;
      }
      case 'stoch_med': {
        const [k, d] = seriesRef.current;
        const kData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.stoch_med_k?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        const dData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.stoch_med_d?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        safeSetData(k as ISeriesApi<'Line'>, kData, '%K');
        safeSetData(d as ISeriesApi<'Line'>, dData, '%D');
        break;
      }
      case 'stoch_fast': {
        const [k, d] = seriesRef.current;
        const kData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.stoch_fast_k?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        const dData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.stoch_fast_d?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        safeSetData(k as ISeriesApi<'Line'>, kData, '%K');
        safeSetData(d as ISeriesApi<'Line'>, dData, '%D');
        break;
      }
      case 'rsi': {
        const [main, signal] = seriesRef.current;
        const rsiData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.rsi?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value) && d.value > 0);
        const rsiSignalData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.rsi_signal?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        safeSetData(main as ISeriesApi<'Line'>, rsiData, 'RSI');
        safeSetData(signal as ISeriesApi<'Line'>, rsiSignalData, 'Signal');
        break;
      }
      case 'macd': {
        const [line, signal, histogram] = seriesRef.current;
        // DO NOT filter out zero values - zero is valid for MACD
        const macdLineData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.macd_line?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        const signalData: LineData<Time>[] = times
          .map((time, i) => ({ time, value: data.macd_signal?.[i] }))
          .filter(d => d.value != null && !isNaN(d.value));
        const histogramData: HistogramData<Time>[] = times
          .map((time, i) => ({
            time,
            value: data.macd_histogram?.[i],
            color: (data.macd_histogram?.[i] ?? 0) >= 0 ? '#26a69a' : '#ef5350',
          }))
          .filter(d => d.value != null && !isNaN(d.value));
        safeSetData(line as ISeriesApi<'Line'>, macdLineData, 'MACD');
        safeSetData(signal as ISeriesApi<'Line'>, signalData, 'Signal');
        safeSetData(histogram as ISeriesApi<'Histogram'>, histogramData, 'Histogram');
        break;
      }
      case 'volume': {
        const [main] = seriesRef.current;
        // Use more opaque colors for better visibility
        // Apply timezone shift to time
        const volumeData: HistogramData<Time>[] = data.bars.map((bar, i) => ({
          time: times[i],
          value: bar.volume,
          color: bar.close >= bar.open ? '#26a69aCC' : '#ef5350CC',  // CC = 80% opacity
        }));
        safeSetData(main as ISeriesApi<'Histogram'>, volumeData, 'Volume');
        break;
      }
      case 'rsi_bb': {
        const [rsiLine, bbUpper, bbLower] = seriesRef.current;
        // RSI data - use shifted times
        const rsiData: LineData<Time>[] = times.map((time, i) => ({
          time,
          value: data.rsi?.[i] || 50,
        }));
        safeSetData(rsiLine, rsiData, 'RSI');
        // BB upper data (skip initial zeros)
        const bbUpperData: LineData<Time>[] = times
          .map((time, i) => ({
            time,
            value: data.rsi_bb_upper?.[i] || 0,
          }))
          .filter((d): d is LineData<Time> => d.value > 0);
        safeSetData(bbUpper, bbUpperData, 'BB Upper');
        // BB lower data (skip initial zeros)
        const bbLowerData: LineData<Time>[] = times
          .map((time, i) => ({
            time,
            value: data.rsi_bb_lower?.[i] || 0,
          }))
          .filter((d): d is LineData<Time> => d.value > 0);
        safeSetData(bbLower, bbLowerData, 'BB Lower');
        break;
      }
    }

    // Notify parent of primary series for drawing coordinate conversion
    if (seriesRef.current.length > 0) {
      onSeriesReady?.(seriesRef.current[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, indicator, timeframe, market]); // onSeriesReady excluded - stable callback

  // Separate effect for visible range sync (prevents infinite loop)
  useEffect(() => {
    if (externalVisibleRange && chartRef.current) {
      try {
        chartRef.current.timeScale().setVisibleLogicalRange(externalVisibleRange);
      } catch {
        // Ignore - chart might not be ready
      }
    }
  }, [externalVisibleRange]);

  const canRenderDrawing = chartReady && drawingHook && chartRef.current && seriesRef.current.length > 0;

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Drawing canvas overlay - renders after chart is ready */}
      {canRenderDrawing && (
        <SubChartDrawingCanvas
          chart={chartRef.current!}
          series={seriesRef.current[0]}
          drawings={drawingHook!.drawings}
          manager={drawingHook!.manager}
          activeTool={drawingToolActive ?? null}
          isActiveChart={isActiveChart ?? false}
          onChartActivate={onChartActivate ?? (() => {})}
          onDrawingComplete={onDrawingComplete ?? (() => {})}
          indicatorName={indicatorConfig[indicator].shortLabel}
        />
      )}
    </div>
  );
}
