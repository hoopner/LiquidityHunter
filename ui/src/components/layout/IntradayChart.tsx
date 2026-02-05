import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import { debounce, throttle, CleanupManager } from '../../utils/performance';
import { logger } from '../../utils/logger';
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  Time,
} from 'lightweight-charts';
import { fetchOHLCV, fetchAnalyze, fetchVolumeProfile, fetchMTFAnalyze, addToWatchlist, removeFromWatchlist } from '../../api/client';
import type { OHLCVResponse, AnalyzeResponse, WatchlistItem, VolumeProfileResponse, MTFAnalyzeResponse } from '../../api/types';
import type { RealtimePrice } from '../../hooks/useRealtimePrice';
import type { TradingLevels } from '../ai/AIPredictionsPanel';
import { useAIPredictions, type AIType, type OHLCVBar } from '../../hooks/useAIPredictions';
import { useProcessedChartData, getOneDayBars } from '../../hooks/useProcessedBars';
import { timeToTz, getMarketTimezone, isIntradayTimeframe } from '../../utils/time';
import { useDrawings } from '../../hooks/useDrawings';
import { DrawingToolbar } from '../chart/DrawingToolbar';
import { DrawingCanvas } from '../chart/DrawingCanvas';
import { DrawingPropertyEditor } from '../chart/DrawingPropertyEditor';
import type { DrawingToolType } from '../../types/drawings';

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1D', '1W', '1M'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

// Note: dedup/sort now handled in useProcessedBars hook

interface IntradayChartProps {
  symbol?: string;
  market?: string;
  compact?: boolean;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  isSelected?: boolean;
  onDoubleClick?: () => void;
  showHeader?: boolean;
  // Hide main chart's time scale when subcharts are visible (timeline shown on bottom panel only)
  showTimeScale?: boolean;
  onSymbolChange?: (symbol: string, market: string) => void;
  watchlistSymbols?: WatchlistItem[];
  onWatchlistChange?: () => void;
  onChartReady?: (chartRef: React.RefObject<IChartApi | null>) => void;
  onVisibleRangeChange?: (range: { from: number; to: number } | null) => void;
  // Callback to share OHLCV data with subcharts (for timeline sync)
  onDataLoaded?: (data: OHLCVResponse | null) => void;
  // Drawing tool coordination with subcharts
  onDrawingToolChange?: (tool: DrawingToolType | null, showTools: boolean) => void;
  onMainChartActivate?: () => void;
  isActiveForDrawing?: boolean;
  // Real-time price update from WebSocket
  realtimePrice?: RealtimePrice | null;
  // Trading levels from AI panel (entry, stop, targets)
  tradingLevels?: TradingLevels | null;
}

interface BoxPosition {
  left: number;
  right: number;
  top: number;
  bottom: number;
  visible: boolean;
}

// Note: getMarketTimezone, timeToTz, isIntradayTimeframe imported from useProcessedBars hook

/**
 * Safe setData wrapper - removes duplicates and sorts ascending by time
 * Prevents lightweight-charts crash: "data must be asc ordered by time"
 */
function safeSetData(series: any, data: any[]): void {
  if (!series) return;
  if (!data || data.length === 0) {
    series.setData([]);
    return;
  }

  // Dedup by time - handle all time formats
  const seen = new Set<string>();
  const unique = data.filter(item => {
    const key = typeof item.time === 'object'
      ? `${item.time.year}-${item.time.month}-${item.time.day}`
      : String(item.time);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort ascending - convert to number for comparison only, keep original time type
  unique.sort((a, b) => {
    const toNum = (t: any): number => {
      if (typeof t === 'number') return t;
      if (typeof t === 'string') return new Date(t).getTime();
      if (typeof t === 'object' && t.year) {
        return new Date(t.year, (t.month || 1) - 1, t.day || 1).getTime();
      }
      return 0;
    };
    return toNum(a.time) - toNum(b.time);
  });

  // DO NOT modify item.time - keep original format exactly as-is!
  series.setData(unique);
}

/**
 * Intraday chart area with TradingView lightweight-charts
 * Handles intraday timeframes (1m, 5m, 15m, 30m, 1h, 4h)
 * - Converts timestamps to local market time (ET for US, KST for KR)
 * - Filters out extended/pre-market hours for US stocks
 * - Uses day-based range presets (1D, 2D, 5D, 10D, ALL)
 * Performance: Wrapped with React.memo to prevent unnecessary re-renders
 */
export const IntradayChart = memo(function IntradayChart({
  symbol = '005930',
  market = 'KR',
  compact = false,
  timeframe: externalTimeframe,
  onTimeframeChange,
  isSelected = false,
  onDoubleClick,
  showHeader = true,
  showTimeScale = true,  // Default true, set false when subcharts visible
  onSymbolChange,
  watchlistSymbols = [],
  onWatchlistChange,
  onChartReady,
  onVisibleRangeChange,
  onDataLoaded,
  onDrawingToolChange,
  onMainChartActivate,
  isActiveForDrawing = true,
  realtimePrice,
  tradingLevels,
}: IntradayChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  // Bollinger Band series refs
  const bb1UpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bb1MiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bb1LowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bb2UpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bb2LowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  // VWAP series ref
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);
  // Keltner Channel series refs
  const kcUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const kcMiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const kcLowerRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Trading level price lines (stored to allow removal)
  const tradingLevelLinesRef = useRef<{ id: string; line: ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> }[]>([]);
  const [showTradingLevels, setShowTradingLevels] = useState(true);

  // AI Prediction line series refs - FUTURE predictions (bold)
  const aiPredTechnicalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aiPredLSTMRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aiPredLHRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aiPredConsensusRef = useRef<ISeriesApi<'Line'> | null>(null);
  // AI Prediction line series refs - BACKTEST predictions (faded)
  const aiBacktestTechnicalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aiBacktestLSTMRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aiBacktestLHRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aiBacktestConsensusRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Ref to store the latest onVisibleRangeChange callback (avoids stale closure)
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  onVisibleRangeChangeRef.current = onVisibleRangeChange;

  // Ref to track last processed data to prevent duplicate setData calls
  const lastDataIdRef = useRef<string | null>(null);

  const [data, setData] = useState<OHLCVResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalTimeframe, setInternalTimeframe] = useState<Timeframe>('1D');
  const [noData, setNoData] = useState(false);

  // Range preset for visible data (intraday presets: days)
  type IntradayPreset = '1D' | '2D' | '5D' | '10D' | 'ALL';
  const [rangePreset, setRangePreset] = useState<IntradayPreset>('5D');

  // Share data with SubCharts when it changes
  useEffect(() => {
    onDataLoaded?.(data);
  }, [data, onDataLoaded]);

  // Calculate default visible range based on timeframe (intraday: bars per day)
  const getDefaultVisibleBars = useCallback((tf: string, preset: string): number => {
    const bpd = getOneDayBars(tf);

    // Intraday presets (in trading days)
    const intradayPresets: Record<string, number> = {
      '1D': bpd * 1,      // 1 day
      '2D': bpd * 2,      // 2 days
      '5D': bpd * 5,      // 5 days (default)
      '10D': bpd * 10,    // 10 days
      'ALL': 9999,        // Show all
    };
    return intradayPresets[preset] || bpd * 5;
  }, []);

  // Track if intraday data is available for this ticker
  const [intradayAvailable, setIntradayAvailable] = useState(true);
  const [intradayMessage, setIntradayMessage] = useState<string | null>(null);

  // Editable symbol state (for compact mode)
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editMarket, setEditMarket] = useState<'KR' | 'US'>('KR');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editContainerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close editing
  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (editContainerRef.current && !editContainerRef.current.contains(e.target as Node)) {
        setIsEditing(false);
        setShowSuggestions(false);
      }
    };

    // Add listener with slight delay to avoid immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditing]);

  // Use external timeframe if provided, otherwise use internal
  const timeframe = externalTimeframe ?? internalTimeframe;
  const setTimeframe = (tf: Timeframe) => {
    console.log('[Timeframe] Button clicked:', tf, 'Current:', timeframe);
    if (onTimeframeChange) {
      onTimeframeChange(tf);
    } else {
      setInternalTimeframe(tf);
    }
  };

  // ========== PROCESSED DATA FROM HOOK ==========
  // This is the SINGLE SOURCE OF TRUTH for all chart data
  // - Timezone-shifted timestamps (ET for US, KST for KR)
  // - Extended hours filtered (US only)
  // - Deduplicated and sorted
  // - Indicator arrays aligned with filtered bars
  const processedData = useProcessedChartData(data, market || 'US', timeframe);

  // IntradayChart handles intraday timeframes (1m, 5m, 15m, 1h)
  // Note: Render logging removed to reduce console noise

  // Order Block state
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  // Order Block and FVG toggles
  const [showOB, setShowOB] = useState(true);
  // FVG toggle (independent from OB)
  const [showFVG, setShowFVG] = useState(true);

  // Bollinger Band toggle states
  const [showBB1, setShowBB1] = useState(false);  // BB1 (20, 0.5) - Green
  const [showBB2, setShowBB2] = useState(false);  // BB2 (20, 3.0) - Red
  // VWAP toggle state
  const [showVWAP, setShowVWAP] = useState(false);
  // Keltner Channel toggle state
  const [showKC, setShowKC] = useState(false);
  // TTM Squeeze toggle state
  const [showSqueeze, setShowSqueeze] = useState(false);
  // Moving Average toggle states (EMA and SMA)
  const [showEMA20, setShowEMA20] = useState(true);   // Default ON
  const [showSMA20, setShowSMA20] = useState(false);  // Default OFF
  const [showEMA200, setShowEMA200] = useState(true); // Default ON
  const [showSMA200, setShowSMA200] = useState(false); // Default OFF
  const [obBoxPosition, setObBoxPosition] = useState<BoxPosition>({ left: 0, right: 0, top: 0, bottom: 0, visible: false });
  // FVG positions - now supports multiple independent FVGs
  const [fvgBoxPositions, setFvgBoxPositions] = useState<(BoxPosition & { direction: string })[]>([]);

  // OB adjustment state (user can resize horizontally - RIGHT SIDE ONLY)
  // rightOffset: pixels to extend (positive) or shorten (negative) the right edge
  const [obRightOffset, setObRightOffset] = useState(0);
  const [isResizingOB, setIsResizingOB] = useState(false);
  const resizeStartRef = useRef<{ x: number; value: number }>({ x: 0, value: 0 });

  // Ctrl+wheel zoom anchor lock (prevents jitter during zoom gesture)
  const zoomAnchorRef = useRef<{ locked: boolean; anchorLogical: number; lastWheelTime: number }>({
    locked: false,
    anchorLogical: 0,
    lastWheelTime: 0,
  });
  const zoomResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Volume Profile state
  const [volumeProfile, setVolumeProfile] = useState<VolumeProfileResponse | null>(null);
  const [showVP, setShowVP] = useState(false);
  const [vpLoading, setVpLoading] = useState(false);

  // Volume filter state - hide weak OBs
  const [hideWeakOB, setHideWeakOB] = useState(false);

  // MTF (Multi-Timeframe) state
  const [mtfData, setMtfData] = useState<MTFAnalyzeResponse | null>(null);
  const [showMTF, setShowMTF] = useState(false);
  const [mtfLoading, setMtfLoading] = useState(false);

  // Watchlist state
  const [isWatchlistLoading, setIsWatchlistLoading] = useState(false);
  const [watchlistAdded, setWatchlistAdded] = useState(false);
  const [watchlistRemoved, setWatchlistRemoved] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Drawing tools state
  const [showDrawingTools, setShowDrawingTools] = useState(false);
  const {
    drawings,
    manager: drawingManager,
    activeTool,
    setActiveTool,
    selectedDrawingId,
    setSelectedDrawingId,
    editingDrawing,
    setEditingDrawing,
    clearAll: clearAllDrawings,
    updateDrawing,
  } = useDrawings(symbol, timeframe);

  // AI Predictions hook - get current price and historical data for backtesting
  const currentPrice = data?.bars[data.bars.length - 1]?.close ?? null;
  const historicalBars: OHLCVBar[] | undefined = useMemo(() => {
    if (!data?.bars) return undefined;
    const bars = data.bars.map(bar => ({
      time: String(bar.time), // Ensure time is string for OHLCVBar interface
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));

    return bars;
  }, [data?.bars]);

  // ========== USE PROCESSED DATA FROM HOOK ==========
  // All timezone conversion, extended hours filtering, dedup, and sorting is done in useProcessedChartData
  const candlestickData = useMemo((): CandlestickData<Time>[] => {
    if (!processedData) return [];
    console.log('[IntradayChart] Using', processedData.candlesticks.length, 'processed candles');
    return processedData.candlesticks;
  }, [processedData]);

  // ========== MA DATA FROM HOOK ==========
  const maData = useMemo(() => {
    if (!processedData) {
      return {
        ema20: [] as LineData<Time>[],
        ema200: [] as LineData<Time>[],
        sma20: [] as LineData<Time>[],
        sma200: [] as LineData<Time>[],
      };
    }
    return {
      ema20: processedData.ema20,
      ema200: processedData.ema200,
      sma20: processedData.sma20,
      sma200: processedData.sma200,
    };
  }, [processedData]);

  // ========== BB DATA FROM HOOK ==========
  const bbData = useMemo(() => {
    if (!processedData) {
      return {
        bb1Upper: [] as LineData<Time>[],
        bb1Middle: [] as LineData<Time>[],
        bb1Lower: [] as LineData<Time>[],
        bb2Upper: [] as LineData<Time>[],
        bb2Lower: [] as LineData<Time>[],
      };
    }
    return {
      bb1Upper: processedData.bb1Upper,
      bb1Middle: processedData.bb1Middle,
      bb1Lower: processedData.bb1Lower,
      bb2Upper: processedData.bb2Upper,
      bb2Lower: processedData.bb2Lower,
    };
  }, [processedData]);

  // ========== OTHER INDICATORS FROM HOOK ==========
  const otherIndicatorData = useMemo(() => {
    if (!processedData) {
      return {
        vwap: [] as LineData<Time>[],
        kcUpper: [] as LineData<Time>[],
        kcMiddle: [] as LineData<Time>[],
        kcLower: [] as LineData<Time>[],
      };
    }
    return {
      vwap: processedData.vwap,
      kcUpper: processedData.kcUpper,
      kcMiddle: processedData.kcMiddle,
      kcLower: processedData.kcLower,
    };
  }, [processedData]);

  // Helper: Apply timezone shift to a bar's time (for inline useEffect hooks)
  // Use this for on-demand indicator data conversion
  const shiftBarTime = useCallback((barTime: any): Time => {
    const isIntraday = isIntradayTimeframe(timeframe);
    const tz = getMarketTimezone(market);

    if (isIntraday && typeof barTime === 'number') {
      return timeToTz(barTime, tz) as Time;
    } else if (isIntraday && typeof barTime === 'string') {
      // String date/datetime for intraday - convert to Unix and shift
      const utcSeconds = Math.floor(new Date(barTime).getTime() / 1000);
      return timeToTz(utcSeconds, tz) as Time;
    }
    // Daily: keep as-is
    return barTime as Time;
  }, [timeframe, market]);

  const {
    lines: aiPredLines,
    loading: aiPredLoading,
    toggleLine: toggleAIPredLine,
    generatePredictions,
    hasEnabledPredictions,
  } = useAIPredictions(symbol, market, currentPrice, historicalBars);

  // Notify parent when drawing tool state changes (for subchart coordination)
  useEffect(() => {
    onDrawingToolChange?.(activeTool, showDrawingTools);
  }, [activeTool, showDrawingTools, onDrawingToolChange]);

  // Check if symbol is in watchlist
  const isInWatchlist = watchlistSymbols.some(
    item => item.symbol === symbol && item.market === market
  ) || watchlistAdded;

  // Effective watchlist status (considering local state changes)
  const effectiveInWatchlist = (isInWatchlist && !watchlistRemoved) || watchlistAdded;

  // Reset local state when symbol changes
  useEffect(() => {
    setWatchlistAdded(false);
    setWatchlistRemoved(false);
  }, [symbol, market]);

  // Handle adding to watchlist
  const handleAddToWatchlist = async () => {
    if (isWatchlistLoading || effectiveInWatchlist) return;

    setIsWatchlistLoading(true);
    try {
      const result = await addToWatchlist(symbol, market);
      if (result.success) {
        setWatchlistAdded(true);
        setWatchlistRemoved(false);
        setToastMessage(`★ ${symbol} (${market}) 관심목록에 추가됨`);
        setTimeout(() => setToastMessage(null), 3000);
        onWatchlistChange?.();
        // Reload data after adding
        setNoData(false);
        setLoading(true);
        const intradayLimit = isIntradayTimeframe(timeframe) ? 2000 : 0;
        fetchOHLCV(symbol, market, timeframe, intradayLimit)
          .then((response) => {
            if (response.bars.length === 0) {
              setNoData(true);
              setData(null);
            } else {
              setData(response);
            }
            setLoading(false);
          })
          .catch(() => setLoading(false));
      } else {
        setToastMessage(`추가 실패: ${result.message}`);
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (err) {
      setToastMessage(`오류: ${err instanceof Error ? err.message : 'Unknown'}`);
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsWatchlistLoading(false);
    }
  };

  // Handle removing from watchlist
  const handleRemoveFromWatchlist = async () => {
    if (isWatchlistLoading || !effectiveInWatchlist) return;

    setIsWatchlistLoading(true);
    try {
      const result = await removeFromWatchlist(symbol, market);
      if (result.success) {
        setWatchlistRemoved(true);
        setWatchlistAdded(false);
        setToastMessage(`☆ ${symbol} (${market}) 관심목록에서 제거됨`);
        setTimeout(() => setToastMessage(null), 3000);
        onWatchlistChange?.();
      } else {
        setToastMessage(`제거 실패: ${result.message}`);
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (err) {
      setToastMessage(`오류: ${err instanceof Error ? err.message : 'Unknown'}`);
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsWatchlistLoading(false);
    }
  };

  // Toggle watchlist
  const handleWatchlistToggle = () => {
    if (effectiveInWatchlist) {
      handleRemoveFromWatchlist();
    } else {
      handleAddToWatchlist();
    }
  };

  // NOTE: isIntradayTimeframe() is defined at module level (line ~122)

  // Fetch OHLCV data
  useEffect(() => {
    setLoading(true);
    setError(null);
    setNoData(false);
    setAnalyzeData(null);
    setIntradayMessage(null);

    // Request more bars for intraday timeframes (need 200+ for EMA200, plus scrolling)
    const intradayLimit = isIntradayTimeframe(timeframe) ? 2000 : 0;

    logger.fetch.log('OHLCV Fetch:', symbol, market, timeframe, 'limit:', intradayLimit);

    fetchOHLCV(symbol, market, timeframe, intradayLimit)
      .then((response) => {
        // DEBUG: Check API response for duplicates
        const apiTimes = response.bars.map(b => b.time);
        const uniqueApiTimes = new Set(apiTimes);
        if (uniqueApiTimes.size !== apiTimes.length) {
          console.error('[API] DUPLICATE in response! Unique:', uniqueApiTimes.size, 'Total:', apiTimes.length);
        } else {
          console.log('[API] Response:', response.bars.length, 'unique bars');
        }
        logger.fetch.debug('OHLCV Response:', { symbol, timeframe, barsCount: response.bars.length });

        if (response.bars.length === 0) {
          // Check if this is an intraday timeframe failure
          if (isIntradayTimeframe(timeframe)) {
            logger.fetch.debug('Intraday data not available, switching to 1D');
            setIntradayAvailable(false);
            setIntradayMessage(`분/시간 데이터 없음 - ${symbol}은(는) 일봉만 제공됩니다`);
            // Auto-switch to 1D timeframe
            setTimeframe('1D');
            return;
          }
          setNoData(true);
          setData(null);
        } else {
          // Intraday data is available for this ticker
          if (isIntradayTimeframe(timeframe)) {
            setIntradayAvailable(true);
            setIntradayMessage(null);
          }

          // CRITICAL: Filter ALL invalid bars (not just trailing) to ensure timeline sync
          // This ensures candlestick chart and all subcharts have identical bar indices
          // Invalid bars have zero OHLC values (incomplete data from yfinance)
          const validIndices: number[] = [];
          response.bars.forEach((bar, i) => {
            if (bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0) {
              validIndices.push(i);
            }
          });

          if (validIndices.length === 0) {
            setNoData(true);
            setData(null);
          } else {
            // Create filtered arrays using valid indices - ALL charts will use same data
            const filterByValidIndices = <T,>(arr: T[] | undefined): T[] => {
              if (!arr) return [];
              return validIndices.map(i => arr[i]);
            };

            const filteredData: OHLCVResponse = {
              ...response,
              bars: filterByValidIndices(response.bars),
              ema20: filterByValidIndices(response.ema20),
              ema200: filterByValidIndices(response.ema200),
              sma20: filterByValidIndices(response.sma20),
              sma200: filterByValidIndices(response.sma200),
              rsi: filterByValidIndices(response.rsi),
              rsi_signal: filterByValidIndices(response.rsi_signal),
              macd_line: filterByValidIndices(response.macd_line),
              macd_signal: filterByValidIndices(response.macd_signal),
              macd_histogram: filterByValidIndices(response.macd_histogram),
              stoch_slow_k: filterByValidIndices(response.stoch_slow_k),
              stoch_slow_d: filterByValidIndices(response.stoch_slow_d),
              stoch_med_k: filterByValidIndices(response.stoch_med_k),
              stoch_med_d: filterByValidIndices(response.stoch_med_d),
              stoch_fast_k: filterByValidIndices(response.stoch_fast_k),
              stoch_fast_d: filterByValidIndices(response.stoch_fast_d),
              bb1_upper: filterByValidIndices(response.bb1_upper),
              bb1_middle: filterByValidIndices(response.bb1_middle),
              bb1_lower: filterByValidIndices(response.bb1_lower),
              bb2_upper: filterByValidIndices(response.bb2_upper),
              bb2_middle: filterByValidIndices(response.bb2_middle),
              bb2_lower: filterByValidIndices(response.bb2_lower),
              rsi_bb_upper: filterByValidIndices(response.rsi_bb_upper),
              rsi_bb_middle: filterByValidIndices(response.rsi_bb_middle),
              rsi_bb_lower: filterByValidIndices(response.rsi_bb_lower),
              vwap: filterByValidIndices(response.vwap),
              kc_upper: filterByValidIndices(response.kc_upper),
              kc_middle: filterByValidIndices(response.kc_middle),
              kc_lower: filterByValidIndices(response.kc_lower),
              squeeze: filterByValidIndices(response.squeeze),
            };

            setData(filteredData);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        logger.fetch.error('OHLCV Error:', { symbol, timeframe, error: err.message });

        if (err.message.includes('not found') || err.message.includes('404')) {
          // Check if this is an intraday timeframe failure
          if (isIntradayTimeframe(timeframe)) {
            logger.fetch.debug('Intraday data error, switching to 1D');
            setIntradayAvailable(false);
            setIntradayMessage(`분/시간 데이터 없음 - ${symbol}은(는) 일봉만 제공됩니다`);
            // Auto-switch to 1D timeframe
            setTimeframe('1D');
            setLoading(false);
            return;
          }
          setNoData(true);
          setData(null);
        } else {
          setError(err.message);
        }
        setLoading(false);
      });
  }, [symbol, market, timeframe]);

  // Reset intraday availability and data tracking when symbol changes
  useEffect(() => {
    setIntradayAvailable(true);
    setIntradayMessage(null);
    lastDataIdRef.current = null; // Reset to allow fresh data load
  }, [symbol, market]);

  // Fetch Order Block analysis after data loads
  useEffect(() => {
    if (!data || data.bars.length === 0) return;

    const barIndex = data.bars.length - 1;

    fetchAnalyze(symbol, market, timeframe, barIndex, hideWeakOB)
      .then((result) => {
        // Debug logging for OB detection
        setAnalyzeData(result);
      })
      .catch((err) => {
        logger.fetch.error('OB Analyze Error:', err.message);
        setAnalyzeData(null);
      });
  }, [data, symbol, market, timeframe, hideWeakOB]);

  // Show alert toast when retest signal is detected
  useEffect(() => {
    if (!analyzeData?.signals || analyzeData.signals.length === 0) return;

    const signal = analyzeData.signals[0]; // Show first active signal
    const ob = analyzeData.current_valid_ob;
    if (!ob) return;

    const obMid = (ob.zone_top + ob.zone_bottom) / 2;
    const priceStr = obMid.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const volStr = signal.volume_confirm.toFixed(1);
    const directionEmoji = signal.direction === 'bull' ? '▲' : '▼';
    const directionText = signal.direction === 'bull' ? '매수' : '매도';
    const alertColor = signal.direction === 'bull' ? '🟢' : '🔴';

    setToastMessage(`${alertColor} ${priceStr} OB 리테스트! ${directionEmoji} ${directionText} 신호 - 볼륨 ${volStr}x 확인`);
    const timer = setTimeout(() => setToastMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [analyzeData?.signals]);

  // Fetch Volume Profile when enabled
  useEffect(() => {
    if (!showVP || !data || data.bars.length === 0) {
      setVolumeProfile(null);
      return;
    }

    setVpLoading(true);
    fetchVolumeProfile(symbol, market, timeframe, 50)
      .then((vp) => {
        setVolumeProfile(vp);
        setVpLoading(false);
      })
      .catch(() => {
        setVolumeProfile(null);
        setVpLoading(false);
      });
  }, [showVP, data, symbol, market, timeframe]);

  // Fetch MTF (Multi-Timeframe) zones when enabled
  useEffect(() => {
    if (!showMTF || !data || data.bars.length === 0) {
      setMtfData(null);
      return;
    }

    setMtfLoading(true);
    // Map timeframe to API format
    const ltfMap: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m',
      '1h': '1H', '1H': '1H', '4h': '4H', '4H': '4H',
      '1D': '1D', '1W': '1W', '1M': '1M',
    };
    const ltf = ltfMap[timeframe] || '1D';

    fetchMTFAnalyze(symbol, market, ltf, '', 20, true)
      .then((mtf) => {
        setMtfData(mtf);
        setMtfLoading(false);
      })
      .catch((err) => {
        logger.fetch.error('MTF Fetch Error:', err.message);
        setMtfData(null);
        setMtfLoading(false);
      });
  }, [showMTF, data, symbol, market, timeframe]);

  // Store OB base position (without user adjustment) - calculated from chart coordinates
  const obBaseRightRef = useRef<number>(0);

  // Calculate box positions for OB and FVGs
  const updateBoxPositions = useCallback(() => {
    if (!chartRef.current || !candlestickSeriesRef.current || !chartContainerRef.current || !data) {
      setObBoxPosition(prev => ({ ...prev, visible: false }));
      setFvgBoxPositions([]);
      return;
    }

    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;
    const container = chartContainerRef.current;
    const timeScale = chart.timeScale();
    const chartRightEdge = container.clientWidth - 60;

    // Handle OB
    if (analyzeData?.current_valid_ob) {
      const ob = analyzeData.current_valid_ob;
      const obStartTime = data.bars[ob.index]?.time;

      if (obStartTime) {
        const leftX = timeScale.timeToCoordinate(obStartTime as Time);
        const topY = series.priceToCoordinate(ob.zone_top);
        const bottomY = series.priceToCoordinate(ob.zone_bottom);

        // Validate coordinates are reasonable (not NaN, not extreme values)
        const chartHeight = container.clientHeight || 500;
        if (leftX !== null && topY !== null && bottomY !== null &&
            !isNaN(topY) && !isNaN(bottomY) &&
            topY >= -100 && bottomY >= -100 &&
            topY <= chartHeight + 100 && bottomY <= chartHeight + 100) {
          obBaseRightRef.current = chartRightEdge;
          const adjustedRight = Math.max(leftX + 30, chartRightEdge + obRightOffset);

          setObBoxPosition({
            left: leftX,
            right: Math.min(adjustedRight, chartRightEdge + 100),
            top: Math.min(topY, bottomY),
            bottom: Math.max(topY, bottomY),
            visible: true,
          });
        } else {
          setObBoxPosition(prev => ({ ...prev, visible: false }));
        }
      } else {
        setObBoxPosition(prev => ({ ...prev, visible: false }));
      }
    } else {
      setObBoxPosition(prev => ({ ...prev, visible: false }));
    }

    // Handle ALL FVGs - show multiple FVGs within reasonable price range
    if (analyzeData?.fvgs && analyzeData.fvgs.length > 0 && analyzeData.current_price > 0) {
      const currentPrice = analyzeData.current_price;
      const chartHeight = container.clientHeight || 500;

      // Filter FVGs to only those within 50% of current price (expanded from 30%)
      const validFvgs = analyzeData.fvgs.filter(fvg => {
        const gapMid = (fvg.gap_high + fvg.gap_low) / 2;
        const distancePercent = Math.abs(gapMid - currentPrice) / currentPrice * 100;
        return distancePercent <= 50;
      });

      // Calculate positions for ALL valid FVGs (up to 5 most recent)
      const fvgPositions: (BoxPosition & { direction: string })[] = [];
      const recentFvgs = validFvgs.slice(-5); // Show up to 5 most recent FVGs

      for (const fvg of recentFvgs) {
        const fvgStartIdx = Math.max(0, fvg.index - 1);
        const fvgStartTime = data.bars[fvgStartIdx]?.time;

        if (fvgStartTime) {
          const fvgLeftX = timeScale.timeToCoordinate(fvgStartTime as Time);
          const fvgTopY = series.priceToCoordinate(fvg.gap_high);
          const fvgBottomY = series.priceToCoordinate(fvg.gap_low);

          if (fvgLeftX !== null && fvgTopY !== null && fvgBottomY !== null &&
              !isNaN(fvgTopY) && !isNaN(fvgBottomY) &&
              fvgTopY >= -100 && fvgBottomY >= -100 &&
              fvgTopY <= chartHeight + 100 && fvgBottomY <= chartHeight + 100) {
            fvgPositions.push({
              left: fvgLeftX,
              right: chartRightEdge,
              top: Math.min(fvgTopY, fvgBottomY),
              bottom: Math.max(fvgTopY, fvgBottomY),
              visible: true,
              direction: fvg.direction,
            });
          }
        }
      }

      setFvgBoxPositions(fvgPositions);
    } else {
      setFvgBoxPositions([]);
    }
  }, [data, analyzeData]); // NOTE: offsets are NOT dependencies - we handle them separately

  // OB right edge resize handlers (only right side can be adjusted)
  const handleObResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingOB(true);
    resizeStartRef.current = {
      x: e.clientX,
      value: obRightOffset,
    };
  }, [obRightOffset]);

  const handleObResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingOB || !chartContainerRef.current) return;

    const deltaX = e.clientX - resizeStartRef.current.x;
    const newOffset = resizeStartRef.current.value + deltaX;

    // Constrain: minimum is -(chartRightEdge - left - 30) to ensure minimum width
    // maximum is +100 to allow extending beyond chart edge
    const chartRightEdge = chartContainerRef.current.clientWidth - 60;
    const minOffset = -(chartRightEdge - obBoxPosition.left - 30);
    const maxOffset = 100;

    setObRightOffset(Math.max(minOffset, Math.min(maxOffset, newOffset)));
  }, [isResizingOB, obBoxPosition.left]);

  const handleObResizeEnd = useCallback(() => {
    setIsResizingOB(false);
  }, []);

  // Attach global mouse events for OB resize
  useEffect(() => {
    if (isResizingOB) {
      window.addEventListener('mousemove', handleObResizeMove);
      window.addEventListener('mouseup', handleObResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleObResizeMove);
        window.removeEventListener('mouseup', handleObResizeEnd);
      };
    }
  }, [isResizingOB, handleObResizeMove, handleObResizeEnd]);

  // Update OB box right edge when obRightOffset changes (smooth resize without chart recreation)
  useEffect(() => {
    if (!chartContainerRef.current || !obBoxPosition.visible) return;

    const chartRightEdge = chartContainerRef.current.clientWidth - 60;
    const adjustedRight = Math.max(obBoxPosition.left + 30, chartRightEdge + obRightOffset);

    setObBoxPosition(prev => ({
      ...prev,
      right: Math.min(adjustedRight, chartRightEdge + 100),
    }));
  }, [obRightOffset]); // Only depends on obRightOffset

  // Reset OB adjustment when symbol/timeframe changes
  useEffect(() => {
    setObRightOffset(0);
  }, [symbol, market, timeframe]);

  // Ref to prevent double chart creation
  const chartCreatedRef = useRef(false);

  // Unique instance ID to track this specific chart instance
  const instanceIdRef = useRef<string>(`chart-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  // Track component mount/unmount
  useEffect(() => {
    const id = instanceIdRef.current;
    console.log('[Chart]', id, '🔄 Component MOUNTED');
    return () => {
      console.log('[Chart]', id, '💀 Component UNMOUNTING');
      chartCreatedRef.current = false;
    };
  }, []);

  // Initialize chart - ONLY ONCE on mount
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const id = instanceIdRef.current;
    console.log('[Chart]', id, '🆕 Initializing chart...');

    // Reset the created flag (allows recreation on timeframe change)
    chartCreatedRef.current = false;

    console.log('[Chart]', id, '🔄 Creating/recreating chart for timeframe:', timeframe);

    // Tag container with instance ID for debugging
    chartContainerRef.current.setAttribute('data-chart-id', id);

    // CRITICAL: Remove ALL existing canvases in container (fixes stacked chart bug)
    const existingCanvases = chartContainerRef.current.querySelectorAll('canvas');
    console.log('[Chart]', id, 'Found', existingCanvases.length, 'existing canvases in container - removing all');
    existingCanvases.forEach(canvas => canvas.remove());

    // Remove old chart instance if exists
    if (chartRef.current) {
      console.log('[Chart]', id, 'Removing old chart instance');
      try {
        chartRef.current.remove();
      } catch (e) {
        console.warn('[Chart]', id, 'Error removing old chart:', e);
      }
      chartRef.current = null;
    }

    // Clear container completely
    chartContainerRef.current.innerHTML = '';

    // Verify container is empty
    const remainingCanvases = chartContainerRef.current.querySelectorAll('canvas');
    if (remainingCanvases.length > 0) {
      console.error('[Chart]', id, '❌ Still', remainingCanvases.length, 'canvases after cleanup!');
    }

    // IntradayChart handles intraday timeframes - always true
    const isIntradayTf = true;
    const locale = market === 'KR' ? 'ko-KR' : 'en-US';

    // Weekday names for display
    const weekdays = market === 'KR'
      ? ['일', '월', '화', '수', '목', '금', '토']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
      },
      localization: {
        locale: locale,
        // NOTE: Data timestamps are already timezone-shifted (local market time)
        // NO additional offset needed - just format directly
        timeFormatter: (time: number | string) => {
          if (typeof time === 'number') {
            // Unix timestamp already shifted to local market time
            const date = new Date(time * 1000);

            if (isIntradayTf) {
              const hours = date.getUTCHours().toString().padStart(2, '0');
              const minutes = date.getUTCMinutes().toString().padStart(2, '0');
              return `${hours}:${minutes}`;
            }
            // Daily from Unix timestamp
            const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
            const day = date.getUTCDate().toString().padStart(2, '0');
            const weekday = weekdays[date.getUTCDay()];
            return `${month}/${day} (${weekday})`;
          }
          if (typeof time === 'string') {
            // YYYY-MM-DD (daily)
            const date = new Date(time + 'T12:00:00');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const weekday = weekdays[date.getDay()];
            return `${month}/${day} (${weekday})`;
          }
          return String(time);
        },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2a2e39',
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2a2e39',
        },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        scaleMargins: {
          top: 0.1,    // 10% padding at top
          bottom: 0.1, // 10% padding at bottom
        },
        autoScale: true,
        minimumWidth: 60,  // Fixed width for alignment with subcharts
      },
      timeScale: {
        borderColor: '#2a2e39',
        visible: showTimeScale,  // Hide when subcharts show timeline at bottom
        timeVisible: isIntradayTf,  // Show time for intraday
        secondsVisible: false,
        rightOffset: 20,  // Increased padding for price label visibility
        // Custom tick formatter for intraday: show HH:MM
        tickMarkFormatter: isIntradayTf ? (time: number) => {
          // Time is already shifted by timeToTz, use UTC methods to display correctly
          const date = new Date(time * 1000);
          const hours = date.getUTCHours().toString().padStart(2, '0');
          const minutes = date.getUTCMinutes().toString().padStart(2, '0');
          return `${hours}:${minutes}`;
        } : undefined,
      },
      handleScale: {
        // Make default wheel zoom more gradual
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
      kineticScroll: {
        mouse: true,
        touch: true,
      },
    });

    chartRef.current = chart;
    console.log('[Chart]', id, '✅ Chart instance created');

    // Notify parent that chart is ready
    if (onChartReady) {
      onChartReady(chartRef);
    }

    // Create candlestick series (v5 API)
    console.log('[Chart]', id, '📊 Adding candlestick series...');
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      // Korean standard: Red=Up, Green=Down
      upColor: '#ef5350',
      downColor: '#26a69a',
      borderUpColor: '#ef5350',
      borderDownColor: '#26a69a',
      wickUpColor: '#ef5350',
      wickDownColor: '#26a69a',
      // Show current price on right axis
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: 2, // Dashed line
    });
    candlestickSeriesRef.current = candlestickSeries;

    // Verify canvas count after chart creation (7 is normal for lightweight-charts)
    const finalCanvases = chartContainerRef.current?.querySelectorAll('canvas') || [];
    console.log('[Chart]', id, '✅ Chart created. Canvas count:', finalCanvases.length);

    // Create EMA20 line series - Bright Pink
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#f472b6',
      lineWidth: 2,
      title: 'EMA20',
    });
    ema20SeriesRef.current = ema20Series;

    // Create EMA200 line series - Sky Blue, thicker for visibility
    const ema200Series = chart.addSeries(LineSeries, {
      color: '#00BFFF',  // Sky blue / cyan
      lineWidth: 3,      // Thicker for better visibility
      title: 'EMA200',
    });
    ema200SeriesRef.current = ema200Series;

    // ALL indicator series are created ON-DEMAND when toggled ON
    // This reduces initial series from 22 to just 3 (candlestick, EMA20, EMA200)
    // Dramatically reduces canvas count from 7 to 1-2
    sma20SeriesRef.current = null;
    sma200SeriesRef.current = null;
    bb1UpperRef.current = null;
    bb1MiddleRef.current = null;
    bb1LowerRef.current = null;
    bb2UpperRef.current = null;
    bb2LowerRef.current = null;
    vwapRef.current = null;
    kcUpperRef.current = null;
    kcMiddleRef.current = null;
    kcLowerRef.current = null;
    aiPredTechnicalRef.current = null;
    aiPredLSTMRef.current = null;
    aiPredLHRef.current = null;
    aiPredConsensusRef.current = null;
    aiBacktestTechnicalRef.current = null;
    aiBacktestLSTMRef.current = null;
    aiBacktestLHRef.current = null;
    aiBacktestConsensusRef.current = null;

    // DEBUG: Check canvas count (lightweight-charts uses ~7 canvases internally, this is normal)
    const canvasCountAfterSeries = chartContainerRef.current?.querySelectorAll('canvas').length || 0;
    console.log('[Chart]', id, '📊 Canvas count:', canvasCountAfterSeries, '(7 is normal for lightweight-charts)');
    if (canvasCountAfterSeries > 12) {
      console.warn('[Chart]', id, '⚠️ Unusual canvas count:', canvasCountAfterSeries);
    }

    // Performance: Cleanup manager for this effect
    const cleanup = new CleanupManager();

    // Performance: Debounced resize handler (wait 200ms after resize stops)
    const handleResizeCore = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
      updateBoxPositions();
    };
    const handleResize = debounce(handleResizeCore, 200);
    cleanup.add(() => handleResize.cancel());

    // Performance: Throttled visible range change handler (max 60fps)
    const handleVisibleRangeChangeCore = (range: { from: number; to: number } | null) => {
      updateBoxPositions();
      // Notify parent to sync all subcharts with main chart's visible range
      if (onVisibleRangeChangeRef.current && range) {
        onVisibleRangeChangeRef.current({ from: range.from, to: range.to });
      }
    };
    const handleVisibleRangeChange = throttle(handleVisibleRangeChangeCore, 16); // ~60fps
    cleanup.add(() => handleVisibleRangeChange.cancel());

    // Subscribe to visible range changes to update box positions and sync subcharts
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      handleVisibleRangeChange(range);
    });

    // Wheel zoom handlers:
    // - Normal wheel: Gentle horizontal zoom (centered)
    // - Ctrl + wheel: Horizontal zoom (X-axis) - right edge fixed
    const handleWheel = (e: WheelEvent) => {
      // Ctrl + wheel: Horizontal zoom with right edge fixed
      if (e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        const timeScale = chart.timeScale();
        const currentRange = timeScale.getVisibleLogicalRange();
        if (!currentRange) return;

        const now = Date.now();

        // Lock the anchor point at the start of zoom gesture
        if (!zoomAnchorRef.current.locked || (now - zoomAnchorRef.current.lastWheelTime > 300)) {
          zoomAnchorRef.current.locked = true;
          zoomAnchorRef.current.anchorLogical = currentRange.to;
        }
        zoomAnchorRef.current.lastWheelTime = now;

        if (zoomResetTimerRef.current) {
          clearTimeout(zoomResetTimerRef.current);
        }

        zoomResetTimerRef.current = setTimeout(() => {
          zoomAnchorRef.current.locked = false;
        }, 200);

        // Zoom direction: scroll up = zoom in, scroll down = zoom out
        // Use gentler zoom factors for smoother experience
        const zoomFactor = e.deltaY < 0 ? 0.95 : 1.05;
        const currentWidth = currentRange.to - currentRange.from;
        const newWidth = currentWidth * zoomFactor;
        const clampedWidth = Math.max(5, Math.min(500, newWidth));

        const rightAnchor = zoomAnchorRef.current.anchorLogical;
        const newFrom = rightAnchor - clampedWidth;
        const newTo = rightAnchor;

        timeScale.setVisibleLogicalRange({ from: newFrom, to: newTo });
        return;
      }

      // No modifier - apply gentler horizontal zoom (override default behavior)
      e.preventDefault();
      e.stopPropagation();

      const timeScale = chart.timeScale();
      const currentRange = timeScale.getVisibleLogicalRange();
      if (!currentRange) return;

      // Gentler zoom for normal wheel (no modifier)
      const zoomFactor = e.deltaY < 0 ? 0.97 : 1.03;
      const currentWidth = currentRange.to - currentRange.from;
      const newWidth = currentWidth * zoomFactor;
      const clampedWidth = Math.max(10, Math.min(500, newWidth));

      // Zoom centered on visible range
      const center = (currentRange.from + currentRange.to) / 2;
      const newFrom = center - clampedWidth / 2;
      const newTo = center + clampedWidth / 2;

      timeScale.setVisibleLogicalRange({ from: newFrom, to: newTo });

      zoomAnchorRef.current.locked = false;
    };

    // Reset anchor lock when Ctrl key is released
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        zoomAnchorRef.current.locked = false;
      }
    };

    // Add wheel listener to chart container
    const container = chartContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      cleanup.add(() => container.removeEventListener('wheel', handleWheel));
    }

    // Add keyup listener to reset anchor lock when Ctrl is released
    cleanup.addEventListener(window, 'keyup', handleKeyUp as EventListener);
    cleanup.addEventListener(window, 'resize', handleResize as EventListener);

    // Initial resize (immediate, not debounced)
    handleResizeCore();

    return () => {
      console.log('[Chart]', id, '🧹 Cleanup: removing chart and clearing DOM');

      // Performance: Clean up all registered resources
      cleanup.cleanup();

      if (zoomResetTimerRef.current) {
        clearTimeout(zoomResetTimerRef.current);
      }

      // Remove chart instance
      try {
        chart.remove();
        console.log('[Chart]', id, '✅ Chart removed successfully');
      } catch (e) {
        console.warn('[Chart]', id, '⚠️ Error removing chart (may already be removed)');
      }

      // CRITICAL: Clear ALL refs to prevent stale references
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema200SeriesRef.current = null;
      sma20SeriesRef.current = null;
      sma200SeriesRef.current = null;
      // BB series
      bb1UpperRef.current = null;
      bb1MiddleRef.current = null;
      bb1LowerRef.current = null;
      bb2UpperRef.current = null;
      bb2LowerRef.current = null;
      // VWAP and KC
      vwapRef.current = null;
      kcUpperRef.current = null;
      kcMiddleRef.current = null;
      kcLowerRef.current = null;
      // AI prediction series
      aiPredTechnicalRef.current = null;
      aiPredLSTMRef.current = null;
      aiPredLHRef.current = null;
      aiPredConsensusRef.current = null;
      aiBacktestTechnicalRef.current = null;
      aiBacktestLSTMRef.current = null;
      aiBacktestLHRef.current = null;
      aiBacktestConsensusRef.current = null;
      // Reset flags
      chartCreatedRef.current = false;
      lastDataIdRef.current = null;

      // Clear container DOM completely
      if (chartContainerRef.current) {
        chartContainerRef.current.innerHTML = '';
        console.log('[Chart]', id, '✅ Container cleared');
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, symbol, market]); // Recreate chart when timeframe/symbol/market changes (fixes orphan canvas leak)

  // Update chart data - now uses memoized data conversions
  useEffect(() => {
    if (!data || !candlestickSeriesRef.current || !ema20SeriesRef.current || !ema200SeriesRef.current) {
      return;
    }

    // Generate unique ID for this data set to prevent duplicate processing
    const dataId = `${symbol}-${market}-${timeframe}-${data.bars.length}-${data.bars[0]?.time}-${data.bars[data.bars.length - 1]?.time}`;

    // Skip if we've already processed this exact data
    if (lastDataIdRef.current === dataId) {
      console.log('[Chart] Skip duplicate setData call for:', dataId);
      return;
    }
    lastDataIdRef.current = dataId;

    const id = instanceIdRef.current;
    console.log('[Chart]', id, 'setData:', candlestickData.length, 'candles for', symbol);

    // DEBUG: Check for multiple canvases in container (indicates stacked charts)
    if (chartContainerRef.current) {
      const canvases = chartContainerRef.current.querySelectorAll('canvas');
      console.log('[Chart]', id, 'Canvas count in container:', canvases.length);
    }

    // Use safeSetData to handle dedup and sorting
    console.log('[Chart] Setting', candlestickData.length, 'bars via safeSetData');
    safeSetData(candlestickSeriesRef.current, candlestickData);

    // Expose to browser console for inspection
    (window as any).__CHART_DEBUG__ = {
      symbol,
      market,
      timeframe,
      instanceId: id,
      barCount: candlestickData.length,
      firstBar: candlestickData[0],
      lastBar: candlestickData[candlestickData.length - 1],
      globalCanvasCount: allCanvases.length,
      chartContainers: chartContainers.length,
    };

    safeSetData(ema20SeriesRef.current, maData.ema20);
    safeSetData(ema200SeriesRef.current, maData.ema200);

    // SMA data - created on-demand, may be null
    if (sma20SeriesRef.current) safeSetData(sma20SeriesRef.current, maData.sma20);
    if (sma200SeriesRef.current) safeSetData(sma200SeriesRef.current, maData.sma200);

    // Bollinger Bands data - created on-demand
    if (bb1UpperRef.current) safeSetData(bb1UpperRef.current, bbData.bb1Upper);
    if (bb1MiddleRef.current) safeSetData(bb1MiddleRef.current, bbData.bb1Middle);
    if (bb1LowerRef.current) safeSetData(bb1LowerRef.current, bbData.bb1Lower);
    if (bb2UpperRef.current) safeSetData(bb2UpperRef.current, bbData.bb2Upper);
    if (bb2LowerRef.current) safeSetData(bb2LowerRef.current, bbData.bb2Lower);

    // VWAP data - created on-demand
    if (vwapRef.current) safeSetData(vwapRef.current, otherIndicatorData.vwap);

    // Keltner Channel data - created on-demand
    if (kcUpperRef.current) safeSetData(kcUpperRef.current, otherIndicatorData.kcUpper);
    if (kcMiddleRef.current) safeSetData(kcMiddleRef.current, otherIndicatorData.kcMiddle);
    if (kcLowerRef.current) safeSetData(kcLowerRef.current, otherIndicatorData.kcLower);

    // Update box positions after data loads
    setTimeout(updateBoxPositions, 100);

    // CRITICAL: Send initial visible range to sync subcharts
    setTimeout(() => {
      if (chartRef.current && onVisibleRangeChangeRef.current) {
        const range = chartRef.current.timeScale().getVisibleLogicalRange();
        if (range) {
          onVisibleRangeChangeRef.current({ from: range.from, to: range.to });
        }
      }
    }, 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, market, timeframe, candlestickData, maData, bbData, otherIndicatorData]);
  // NOTE: Removed 'data' (candlestickData derives from it), updateBoxPositions, getDefaultVisibleBars (stable refs)
  // NOTE: rangePreset removed - handled in separate effect below

  // Track last applied range preset to prevent duplicate execution
  const lastAppliedRangeRef = useRef<{ preset: string; barCount: number } | null>(null);

  // SEPARATE effect for range preset changes (fixes buttons not working)
  useEffect(() => {
    if (!data || !chartRef.current) return;

    const totalBars = data.bars.length;

    // Guard: prevent duplicate execution for same preset + same data
    const currentKey = { preset: rangePreset, barCount: totalBars };
    if (lastAppliedRangeRef.current?.preset === currentKey.preset &&
        lastAppliedRangeRef.current?.barCount === currentKey.barCount) {
      return; // Skip duplicate
    }
    lastAppliedRangeRef.current = currentKey;

    console.log('[Chart] Range preset changed to:', rangePreset);

    const visibleBars = getDefaultVisibleBars(timeframe, rangePreset);
    const endIndex = totalBars - 1;
    const startIndex = rangePreset === 'ALL' ? 0 : Math.max(0, endIndex - visibleBars);

    console.log('[Chart] Setting visible range:', startIndex, 'to', endIndex + 10, '(preset:', rangePreset, ')');

    // Apply the visible range
    chartRef.current.timeScale().setVisibleLogicalRange({
      from: startIndex,
      to: endIndex + 10,
    });

    // Force price scale to recalculate
    chartRef.current.priceScale('right').applyOptions({
      autoScale: true,
    });

    // Update box positions
    setTimeout(updateBoxPositions, 100);
  }, [rangePreset, data, timeframe, getDefaultVisibleBars, updateBoxPositions]);

  // Update box positions when analyze data changes
  useEffect(() => {
    updateBoxPositions();
  }, [analyzeData, updateBoxPositions]);

  // Toggle EMA20 visibility
  useEffect(() => {
    ema20SeriesRef.current?.applyOptions({ visible: showEMA20 });
  }, [showEMA20]);

  // Toggle SMA20 visibility - CREATE ON-DEMAND
  useEffect(() => {
    if (!chartRef.current || !data) return;
    if (showSMA20) {
      if (!sma20SeriesRef.current) {
        sma20SeriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: '#B22222', lineWidth: 2, title: 'SMA20', visible: true,
        });
      }
      const lineData = data.bars.map((bar, i) => ({
        time: shiftBarTime(bar.time),
        value: data.sma20?.[i] ?? null,
      })).filter((d): d is LineData<Time> => d.value != null && d.value > 0);
      safeSetData(sma20SeriesRef.current, lineData);
      sma20SeriesRef.current.applyOptions({ visible: true });
    } else if (sma20SeriesRef.current) {
      try { chartRef.current.removeSeries(sma20SeriesRef.current); } catch {}
      sma20SeriesRef.current = null;
    }
  }, [showSMA20, data, shiftBarTime]);

  // Toggle EMA200 visibility
  useEffect(() => {
    ema200SeriesRef.current?.applyOptions({ visible: showEMA200 });
  }, [showEMA200]);

  // Toggle SMA200 visibility - CREATE ON-DEMAND
  useEffect(() => {
    if (!chartRef.current || !data) return;
    if (showSMA200) {
      if (!sma200SeriesRef.current) {
        sma200SeriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: '#0066FF', lineWidth: 3, title: 'SMA200', visible: true,
        });
      }
      const lineData = data.bars.map((bar, i) => ({
        time: shiftBarTime(bar.time),
        value: data.sma200?.[i] ?? null,
      })).filter((d): d is LineData<Time> => d.value != null && d.value > 0);
      safeSetData(sma200SeriesRef.current, lineData);
      sma200SeriesRef.current.applyOptions({ visible: true });
    } else if (sma200SeriesRef.current) {
      try { chartRef.current.removeSeries(sma200SeriesRef.current); } catch {}
      sma200SeriesRef.current = null;
    }
  }, [showSMA200, data, shiftBarTime]);

  // Real-time update from realtimePrice prop (WebSocket)
  useEffect(() => {
    if (!realtimePrice || !data || !candlestickSeriesRef.current) return;

    // Get the last bar's time
    const lastBar = data.bars[data.bars.length - 1];
    if (!lastBar) return;

    // Update only the last candle with real-time data
    const isUp = realtimePrice.price >= lastBar.open;
    // Korean standard: Red=Up, Green=Down
    const candleColor = isUp ? '#ef5350' : '#26a69a';

    const updatedCandle: CandlestickData<Time> = {
      time: shiftBarTime(lastBar.time),
      open: lastBar.open,
      high: Math.max(lastBar.high, realtimePrice.high),
      low: Math.min(lastBar.low, realtimePrice.low),
      close: realtimePrice.price,
      color: candleColor,
      wickColor: candleColor,
      borderColor: candleColor,
    };

    candlestickSeriesRef.current.update(updatedCandle);
  }, [realtimePrice, data, shiftBarTime]);

  // Toggle time scale visibility (hide when subcharts show timeline at bottom)
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ visible: showTimeScale });
  }, [showTimeScale]);

  // Update timeScale options when timeframe changes (for tickMarkFormatter)
  useEffect(() => {
    if (!chartRef.current) return;

    const isIntraday = isIntradayTimeframe(timeframe);
    console.log('[Chart] Updating timeScale for timeframe:', timeframe, 'isIntraday:', isIntraday);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chartRef.current.timeScale().applyOptions as any)({
      timeVisible: isIntraday,
      secondsVisible: false,
      // Custom tick formatter for intraday: show HH:MM
      // Note: tickMarkFormatter exists at runtime but may not be in type defs
      ...(isIntraday ? {
        tickMarkFormatter: (time: number) => {
          const date = new Date(time * 1000);
          const hours = date.getUTCHours().toString().padStart(2, '0');
          const minutes = date.getUTCMinutes().toString().padStart(2, '0');
          return `${hours}:${minutes}`;
        },
      } : {}),
    });

    // For intraday, fit all content to show all bars initially
    if (isIntraday && data?.bars?.length) {
      chartRef.current.timeScale().fitContent();
    }
  }, [timeframe, data]);

  // Toggle BB1 visibility - CREATE ON-DEMAND
  useEffect(() => {
    if (!chartRef.current || !data) return;
    if (showBB1) {
      // Create series on-demand
      if (!bb1UpperRef.current) {
        bb1UpperRef.current = chartRef.current.addSeries(LineSeries, { color: '#22c55e', lineWidth: 1, title: 'BB1 Upper' });
        bb1MiddleRef.current = chartRef.current.addSeries(LineSeries, { color: '#22c55e', lineWidth: 1, title: 'BB1 Middle' });
        bb1LowerRef.current = chartRef.current.addSeries(LineSeries, { color: '#22c55e', lineWidth: 1, title: 'BB1 Lower' });
      }
      const toLineData = (arr: (number | null | undefined)[] | undefined) =>
        data.bars.map((bar, i) => ({ time: shiftBarTime(bar.time), value: arr?.[i] ?? null }))
          .filter((d): d is LineData<Time> => d.value != null && d.value > 0);
      safeSetData(bb1UpperRef.current, toLineData(data.bb1_upper));
      safeSetData(bb1MiddleRef.current, toLineData(data.bb1_middle));
      safeSetData(bb1LowerRef.current, toLineData(data.bb1_lower));
    } else {
      // Remove series when disabled
      if (bb1UpperRef.current) { try { chartRef.current.removeSeries(bb1UpperRef.current); } catch {} bb1UpperRef.current = null; }
      if (bb1MiddleRef.current) { try { chartRef.current.removeSeries(bb1MiddleRef.current); } catch {} bb1MiddleRef.current = null; }
      if (bb1LowerRef.current) { try { chartRef.current.removeSeries(bb1LowerRef.current); } catch {} bb1LowerRef.current = null; }
    }
  }, [showBB1, data, shiftBarTime]);

  // Toggle BB2 visibility - CREATE ON-DEMAND
  useEffect(() => {
    if (!chartRef.current || !data) return;
    if (showBB2) {
      if (!bb2UpperRef.current) {
        bb2UpperRef.current = chartRef.current.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, title: 'BB2 Upper' });
        bb2LowerRef.current = chartRef.current.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, title: 'BB2 Lower' });
      }
      const toLineData = (arr: (number | null | undefined)[] | undefined) =>
        data.bars.map((bar, i) => ({ time: shiftBarTime(bar.time), value: arr?.[i] ?? null }))
          .filter((d): d is LineData<Time> => d.value != null && d.value > 0);
      safeSetData(bb2UpperRef.current, toLineData(data.bb2_upper));
      safeSetData(bb2LowerRef.current, toLineData(data.bb2_lower));
    } else {
      if (bb2UpperRef.current) { try { chartRef.current.removeSeries(bb2UpperRef.current); } catch {} bb2UpperRef.current = null; }
      if (bb2LowerRef.current) { try { chartRef.current.removeSeries(bb2LowerRef.current); } catch {} bb2LowerRef.current = null; }
    }
  }, [showBB2, data, shiftBarTime]);

  // Toggle VWAP visibility - CREATE ON-DEMAND
  useEffect(() => {
    if (!chartRef.current || !data) return;
    if (showVWAP) {
      if (!vwapRef.current) {
        vwapRef.current = chartRef.current.addSeries(LineSeries, { color: '#eab308', lineWidth: 2, title: 'VWAP' });
      }
      const lineData = data.bars.map((bar, i) => ({ time: shiftBarTime(bar.time), value: data.vwap?.[i] ?? null }))
        .filter((d): d is LineData<Time> => d.value != null && d.value > 0);
      safeSetData(vwapRef.current, lineData);
    } else if (vwapRef.current) {
      try { chartRef.current.removeSeries(vwapRef.current); } catch {}
      vwapRef.current = null;
    }
  }, [showVWAP, data, shiftBarTime]);

  // Toggle Keltner Channel visibility - CREATE ON-DEMAND
  useEffect(() => {
    if (!chartRef.current || !data) return;
    if (showKC) {
      if (!kcUpperRef.current) {
        kcUpperRef.current = chartRef.current.addSeries(LineSeries, { color: '#06b6d4', lineWidth: 1, title: 'KC Upper' });
        kcMiddleRef.current = chartRef.current.addSeries(LineSeries, { color: '#ffffff', lineWidth: 1, title: 'KC Middle' });
        kcLowerRef.current = chartRef.current.addSeries(LineSeries, { color: '#06b6d4', lineWidth: 1, title: 'KC Lower' });
      }
      const toLineData = (arr: (number | null | undefined)[] | undefined) =>
        data.bars.map((bar, i) => ({ time: shiftBarTime(bar.time), value: arr?.[i] ?? null }))
          .filter((d): d is LineData<Time> => d.value != null && d.value > 0);
      safeSetData(kcUpperRef.current, toLineData(data.kc_upper));
      safeSetData(kcMiddleRef.current, toLineData(data.kc_middle));
      safeSetData(kcLowerRef.current, toLineData(data.kc_lower));
    } else {
      if (kcUpperRef.current) { try { chartRef.current.removeSeries(kcUpperRef.current); } catch {} kcUpperRef.current = null; }
      if (kcMiddleRef.current) { try { chartRef.current.removeSeries(kcMiddleRef.current); } catch {} kcMiddleRef.current = null; }
      if (kcLowerRef.current) { try { chartRef.current.removeSeries(kcLowerRef.current); } catch {} kcLowerRef.current = null; }
    }
  }, [showKC, data, shiftBarTime]);

  // Trading level price lines (Entry, Stop, Targets)
  useEffect(() => {
    if (!candlestickSeriesRef.current || compact) return;

    // Remove existing trading level lines
    tradingLevelLinesRef.current.forEach(({ line }) => {
      try {
        candlestickSeriesRef.current?.removePriceLine(line);
      } catch {
        // Line may already be removed
      }
    });
    tradingLevelLinesRef.current = [];

    // Add new lines if trading levels are provided and visible
    if (tradingLevels && showTradingLevels) {
      const { entry, stop, targets, currentPrice } = tradingLevels;
      const risk = Math.abs(entry - stop);

      // Entry line - Green dashed
      const entryPct = ((entry - currentPrice) / currentPrice * 100).toFixed(1);
      const entryLine = candlestickSeriesRef.current.createPriceLine({
        price: entry,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `Entry ${entryPct}%`,
      });
      tradingLevelLinesRef.current.push({ id: 'entry', line: entryLine });

      // Stop Loss line - Red dashed
      const stopPct = ((stop - currentPrice) / currentPrice * 100).toFixed(1);
      const stopLine = candlestickSeriesRef.current.createPriceLine({
        price: stop,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `Stop ${stopPct}%`,
      });
      tradingLevelLinesRef.current.push({ id: 'stop', line: stopLine });

      // Target lines - Blue dashed
      targets.forEach((target, i) => {
        const targetPct = ((target - currentPrice) / currentPrice * 100).toFixed(1);
        const reward = Math.abs(target - entry);
        const rr = risk > 0 ? (reward / risk).toFixed(1) : '0';
        const targetLine = candlestickSeriesRef.current!.createPriceLine({
          price: target,
          color: '#3b82f6',
          lineWidth: 2,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `T${i + 1} +${targetPct}% (R:R ${rr})`,
        });
        tradingLevelLinesRef.current.push({ id: `target${i}`, line: targetLine });
      });
    }
  }, [tradingLevels, showTradingLevels, compact]);

  // AI Prediction line series update (both backtest and future)
  useEffect(() => {
    if (!data || !candlestickSeriesRef.current) return;

    const lastBar = data.bars[data.bars.length - 1];
    if (!lastBar) return;

    // Use official lightweight-charts timezone approach
    const tz = getMarketTimezone(market);

    // Helper to convert FUTURE prediction data to line data
    // Access aiPredLines directly instead of through getter function
    const futurePredictionsToLineData = (aiType: AIType): LineData<Time>[] => {
      const predictions = aiPredLines[aiType].futurePredictions;
      if (!predictions || predictions.length === 0) return [];

      // Determine time format from lastBar (string for daily, number for intraday)
      const isIntradayBar = typeof lastBar.time === 'number';

      // Start from current price at last bar time (shifted)
      const lineData: LineData<Time>[] = [
        { time: shiftBarTime(lastBar.time), value: currentPrice ?? lastBar.close },
      ];

      // Add future prediction points - MUST match time format of chart data
      predictions.forEach((pred) => {
        const predDate = new Date(pred.timestamp);
        // Use same time format as chart: number (Unix seconds) for intraday, string for daily
        // Apply timezone shift to intraday timestamps
        const time = isIntradayBar
          ? timeToTz(Math.floor(predDate.getTime() / 1000), tz) as Time
          : predDate.toISOString().split('T')[0] as Time;   // YYYY-MM-DD
        lineData.push({
          time,
          value: pred.predictedPrice,
        });
      });

      return lineData;
    };

    // Helper to convert BACKTEST prediction data to line data
    // Access aiPredLines directly instead of through getter function
    const backtestPredictionsToLineData = (aiType: AIType): LineData<Time>[] => {
      const predictions = aiPredLines[aiType].backtestPredictions;
      if (!predictions || predictions.length === 0) return [];

      // Determine time format from lastBar (string for daily, number for intraday)
      const isIntradayBar = typeof lastBar.time === 'number';

      const lineData: LineData<Time>[] = [];

      // Add backtest prediction points - MUST match time format of chart data
      // Apply timezone shift to intraday timestamps
      predictions.forEach((pred) => {
        const predDate = new Date(pred.timestamp);
        if (isNaN(predDate.getTime())) return;
        // Use same time format as chart: number (Unix seconds) for intraday, string for daily
        const time = isIntradayBar
          ? timeToTz(Math.floor(predDate.getTime() / 1000), tz) as Time
          : predDate.toISOString().split('T')[0] as Time;   // YYYY-MM-DD

        lineData.push({
          time,
          value: pred.predictedPrice,
        });
      });

      return lineData;
    };

    // Update FUTURE prediction series (bold) - CREATES ON-DEMAND
    const updateFutureSeries = (
      ref: React.MutableRefObject<ISeriesApi<'Line'> | null>,
      aiType: AIType,
      enabled: boolean,
      color: string,
      title: string
    ) => {
      if (!chartRef.current) return;

      if (enabled) {
        // Create series on-demand if it doesn't exist
        if (!ref.current) {
          ref.current = chartRef.current.addSeries(LineSeries, {
            color,
            lineWidth: 3,
            title,
            visible: true,
            lineStyle: 0,
            lastValueVisible: true,
            priceLineVisible: false,
            priceScaleId: 'right',
          });
        }
        const lineData = futurePredictionsToLineData(aiType);
        if (lineData.length > 1) {
          safeSetData(ref.current, lineData);
        } else {
          ref.current.setData([]);
        }
        ref.current.applyOptions({ visible: true });
      } else if (ref.current) {
        // Remove series when disabled to save memory
        try {
          chartRef.current.removeSeries(ref.current);
        } catch { /* ignore */ }
        ref.current = null;
      }
    };

    // Update BACKTEST prediction series (faded) - CREATES ON-DEMAND
    const updateBacktestSeries = (
      ref: React.MutableRefObject<ISeriesApi<'Line'> | null>,
      aiType: AIType,
      enabled: boolean,
      color: string,
      title: string
    ) => {
      if (!chartRef.current) return;

      if (enabled) {
        // Create series on-demand if it doesn't exist
        if (!ref.current) {
          ref.current = chartRef.current.addSeries(LineSeries, {
            color: color + '99',
            lineWidth: 2,
            title,
            visible: true,
            lineStyle: 0,
            lastValueVisible: false,
            priceLineVisible: false,
            priceScaleId: 'right',
          });
        }
        const lineData = backtestPredictionsToLineData(aiType);
        if (lineData.length > 0) {
          try {
            safeSetData(ref.current, lineData);
            ref.current.applyOptions({ visible: true });
          } catch { /* ignore */ }
        } else {
          ref.current.setData([]);
          ref.current.applyOptions({ visible: false });
        }
      } else if (ref.current) {
        // Remove series when disabled to save memory
        try {
          chartRef.current.removeSeries(ref.current);
        } catch { /* ignore */ }
        ref.current = null;
      }
    };

    // Update FUTURE prediction lines (bold, full opacity) - creates on-demand
    updateFutureSeries(aiPredTechnicalRef, 'technical', aiPredLines.technical.enabled, '#9333ea', 'Technical ML');
    updateFutureSeries(aiPredLSTMRef, 'lstm', aiPredLines.lstm.enabled, '#f97316', 'LSTM');
    updateFutureSeries(aiPredLHRef, 'lh', aiPredLines.lh.enabled, '#dc2626', 'LH AI');
    updateFutureSeries(aiPredConsensusRef, 'consensus', aiPredLines.consensus.enabled, '#eab308', 'Consensus');

    // Update BACKTEST prediction lines (faded, 60% opacity) - creates on-demand
    updateBacktestSeries(aiBacktestTechnicalRef, 'technical', aiPredLines.technical.enabled, '#9333ea', 'Tech BT');
    updateBacktestSeries(aiBacktestLSTMRef, 'lstm', aiPredLines.lstm.enabled, '#f97316', 'LSTM BT');
    updateBacktestSeries(aiBacktestLHRef, 'lh', aiPredLines.lh.enabled, '#dc2626', 'LH BT');
    updateBacktestSeries(aiBacktestConsensusRef, 'consensus', aiPredLines.consensus.enabled, '#eab308', 'Cons BT');
  }, [data, aiPredLines, currentPrice]);

  // REAL-TIME UPDATES DISABLED FOR STABILITY
  // TODO: Re-enable after proper subscription management is implemented
  // The real-time candle update logic has been removed to prevent
  // flickering issues when switching between tickers.

  // Get current price info
  const lastBar = data?.bars[data.bars.length - 1];
  const prevBar = data?.bars[data.bars.length - 2];
  const priceChange = lastBar && prevBar ? lastBar.close - prevBar.close : 0;
  const priceChangePercent = prevBar ? (priceChange / prevBar.close) * 100 : 0;

  const ob = analyzeData?.current_valid_ob;
  const isBuyOB = ob?.direction === 'buy';

  return (
    <div
      className={`flex flex-col h-full bg-[var(--bg-primary)] ${isSelected ? 'ring-2 ring-[var(--accent-blue)]' : ''}`}
      onDoubleClick={onDoubleClick}
    >
      {/* Toast message */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] px-4 py-2 rounded-lg shadow-lg text-sm">
          {toastMessage}
        </div>
      )}

      {/* Chart header - full mode */}
      {showHeader && !compact && (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-color)]">
          {/* Editable symbol input */}
          {isEditing ? (
            <div
              ref={editContainerRef}
              className="relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 bg-[var(--bg-secondary)] rounded-lg p-1.5">
                {/* Market selector */}
                <select
                  value={editMarket}
                  onChange={(e) => {
                    e.stopPropagation();
                    const newMarket = e.target.value as 'KR' | 'US';
                    setEditMarket(newMarket);
                    setShowSuggestions(true);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`text-sm font-bold px-2 py-1.5 rounded border-2 cursor-pointer outline-none ${
                    editMarket === 'KR'
                      ? 'bg-[#ef5350] bg-opacity-20 border-[#ef5350] text-[#ef5350]'
                      : 'bg-[#26a69a] bg-opacity-20 border-[#26a69a] text-[#26a69a]'
                  }`}
                  style={{ WebkitAppearance: 'menulist', appearance: 'menulist' }}
                >
                  <option value="KR" className="bg-[var(--bg-secondary)] text-[var(--text-primary)]">KR</option>
                  <option value="US" className="bg-[var(--bg-secondary)] text-[var(--text-primary)]">US</option>
                </select>
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => {
                    setEditValue(e.target.value.toUpperCase());
                    setShowSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editValue.trim()) {
                      onSymbolChange?.(editValue.trim(), editMarket);
                      setIsEditing(false);
                      setShowSuggestions(false);
                    } else if (e.key === 'Escape') {
                      setIsEditing(false);
                      setShowSuggestions(false);
                    }
                  }}
                  placeholder={editMarket === 'KR' ? '종목코드' : 'Symbol'}
                  className="w-32 bg-[var(--bg-tertiary)] text-lg font-semibold px-3 py-1.5 rounded border border-[var(--accent-blue)] outline-none"
                  autoFocus
                />
                {/* Submit button */}
                <button
                  onClick={() => {
                    if (editValue.trim()) {
                      onSymbolChange?.(editValue.trim(), editMarket);
                      setIsEditing(false);
                      setShowSuggestions(false);
                    }
                  }}
                  className="px-3 py-1.5 text-sm font-bold bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
                >
                  확인
                </button>
                {/* Cancel button */}
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setShowSuggestions(false);
                  }}
                  className="px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  취소
                </button>
              </div>
              {/* Autocomplete suggestions */}
              {showSuggestions && editValue.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 max-h-48 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-lg z-50">
                  {watchlistSymbols
                    .filter(item =>
                      item.market === editMarket && (
                        item.symbol.includes(editValue) ||
                        item.symbol.startsWith(editValue)
                      )
                    )
                    .slice(0, 8)
                    .map((item) => (
                      <div
                        key={`${item.market}-${item.symbol}`}
                        onClick={() => {
                          onSymbolChange?.(item.symbol, item.market);
                          setIsEditing(false);
                          setShowSuggestions(false);
                        }}
                        className="px-3 py-2 hover:bg-[var(--bg-tertiary)] cursor-pointer flex justify-between items-center"
                      >
                        <span className="font-medium">{item.symbol}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${item.market === 'KR' ? 'bg-[#ef5350] bg-opacity-20 text-[#ef5350]' : 'bg-[#26a69a] bg-opacity-20 text-[#26a69a]'}`}>
                          {item.market}
                        </span>
                      </div>
                    ))}
                  {watchlistSymbols.filter(item =>
                    item.market === editMarket && (
                      item.symbol.includes(editValue) ||
                      item.symbol.startsWith(editValue)
                    )
                  ).length === 0 && (
                    <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                      {editMarket} 관심목록에 없음 - Enter로 직접 입력
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <span
                onClick={() => {
                  if (onSymbolChange) {
                    setEditValue(symbol);
                    setEditMarket(market as 'KR' | 'US');
                    setIsEditing(true);
                  }
                }}
                className={`text-lg font-semibold ${onSymbolChange ? 'cursor-text hover:bg-[var(--bg-tertiary)] px-2 py-1 rounded transition-colors' : ''}`}
                title={onSymbolChange ? '클릭하여 종목 변경' : undefined}
              >
                {symbol}
              </span>
              <span className={`text-sm font-medium px-1.5 py-0.5 rounded ${market === 'KR' ? 'bg-[#ef5350] bg-opacity-20 text-[#ef5350]' : 'bg-[#26a69a] bg-opacity-20 text-[#26a69a]'}`}>
                {market}
              </span>
            </>
          )}
          {/* Watchlist star button - always visible */}
          <button
            onClick={handleWatchlistToggle}
            disabled={isWatchlistLoading}
            className={`text-xl px-2 py-1 rounded transition-all hover:scale-110 disabled:opacity-50 ${
              effectiveInWatchlist
                ? 'text-yellow-400 hover:text-yellow-300'
                : 'text-gray-400 hover:text-yellow-400'
            }`}
            title={effectiveInWatchlist ? '관심목록에서 제거' : '관심목록에 추가'}
          >
            {isWatchlistLoading ? '...' : effectiveInWatchlist ? '★' : '☆'}
          </button>
          {lastBar && (
            <>
              <span className={priceChange >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                {lastBar.close.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className={`text-sm ${priceChange >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                {priceChange >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
              </span>
            </>
          )}

          {/* Timeframe selector */}
          <div className="flex items-center gap-1 ml-4 bg-[var(--bg-tertiary)] rounded p-0.5">
            {TIMEFRAMES.map((tf) => {
              const isIntraday = ['1m', '5m', '15m', '1h'].includes(tf);
              const isDisabled = isIntraday && !intradayAvailable;

              return (
                <button
                  key={tf}
                  onClick={() => {
                    console.log('[TF Button]', tf, 'clicked. isDisabled:', isDisabled, 'intradayAvailable:', intradayAvailable);
                    if (!isDisabled) {
                      setTimeframe(tf);
                    }
                  }}
                  disabled={isDisabled}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-[var(--accent-blue)] text-white'
                      : isDisabled
                      ? 'text-gray-500 cursor-not-allowed opacity-50'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                  title={isDisabled ? '이 종목은 분/시간 데이터가 제공되지 않습니다 (일봉만 가능)' : undefined}
                >
                  {tf}
                </button>
              );
            })}
          </div>
          {/* Intraday not available message */}
          {intradayMessage && (
            <span className="ml-2 text-xs text-yellow-500 animate-pulse">
              ⚠️ {intradayMessage}
            </span>
          )}

          {/* OB Toggle */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => setShowOB(!showOB)}
              className={`px-3 py-1 text-xs font-medium rounded-l transition-colors ${
                showOB
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              OB
            </button>
            {showOB && (
              <button
                onClick={() => setHideWeakOB(!hideWeakOB)}
                className={`px-2 py-1 text-xs font-medium transition-colors border-l border-[var(--border-color)] ${
                  hideWeakOB
                    ? 'bg-orange-500 text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title={hideWeakOB ? '약한 OB 표시하기' : '약한 OB 숨기기'}
              >
                {hideWeakOB ? '강함만' : '전체'}
              </button>
            )}
            {showOB && obRightOffset !== 0 && (
              <button
                onClick={() => setObRightOffset(0)}
                className="px-2 py-1 text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-r border-l border-[var(--border-color)]"
                title="OB 영역 초기화"
              >
                ↺
              </button>
            )}
          </div>

          {/* FVG Toggle */}
          <button
            onClick={() => setShowFVG(!showFVG)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showFVG
                ? 'bg-[#14b8a6] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="Fair Value Gaps"
          >
            FVG
          </button>

          {/* VP Toggle */}
          <button
            onClick={() => setShowVP(!showVP)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showVP
                ? 'bg-[var(--accent-purple)] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="Volume Profile"
          >
            {vpLoading ? '...' : 'VP'}
          </button>

          {/* Moving Averages Toggles */}
          <div className="flex items-center gap-1 border-l border-[var(--border-primary)] pl-2 ml-1">
            <span className="text-xs text-[var(--text-secondary)] mr-1">MA:</span>
            {/* EMA20 Toggle - Pink */}
            <button
              onClick={() => setShowEMA20(!showEMA20)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                showEMA20
                  ? 'bg-[#f472b6] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="EMA 20 (Exponential)"
            >
              E20
            </button>
            {/* SMA20 Toggle - Dark Red */}
            <button
              onClick={() => setShowSMA20(!showSMA20)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                showSMA20
                  ? 'bg-[#B22222] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="SMA 20 (Simple)"
            >
              S20
            </button>
            {/* EMA200 Toggle - Sky Blue */}
            <button
              onClick={() => setShowEMA200(!showEMA200)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                showEMA200
                  ? 'bg-[#00BFFF] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="EMA 200 (Exponential)"
            >
              E200
            </button>
            {/* SMA200 Toggle - Blue */}
            <button
              onClick={() => setShowSMA200(!showSMA200)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                showSMA200
                  ? 'bg-[#0066FF] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="SMA 200 (Simple)"
            >
              S200
            </button>
          </div>

          {/* Range Presets - Intraday (days) */}
          <div className="flex items-center gap-1 border-l border-[var(--border-primary)] pl-2 ml-1">
            <span className="text-xs text-[var(--text-secondary)] mr-1">범위:</span>
            {(['1D', '2D', '5D', '10D', 'ALL'] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  console.log('[Range Button]', preset, 'clicked. Current:', rangePreset);
                  setRangePreset(preset);
                }}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  rangePreset === preset
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title={`Show last ${preset === 'ALL' ? 'all data' : preset}`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* MTF Toggle */}
          <button
            onClick={() => setShowMTF(!showMTF)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showMTF
                ? 'bg-[#f97316] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title={`Multi-Timeframe Zones${mtfData ? ` (${mtfData.htf_timeframe})` : ''}`}
          >
            {mtfLoading ? '...' : 'MTF'}
          </button>

          {/* BB1 Toggle - Tight (0.5) Green */}
          <button
            onClick={() => setShowBB1(!showBB1)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showBB1
                ? 'bg-[#22c55e] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="Bollinger Band (20, 0.5) - Tight"
          >
            BB1
          </button>

          {/* BB2 Toggle - Wide (3.0) Red */}
          <button
            onClick={() => setShowBB2(!showBB2)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showBB2
                ? 'bg-[#ef4444] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="Bollinger Band (20, 3.0) - Wide"
          >
            BB2
          </button>

          {/* VWAP Toggle - Orange (works on all timeframes now) */}
          <button
            onClick={() => setShowVWAP(!showVWAP)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showVWAP
                ? 'bg-[#eab308] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title={['1D', '1W', '1M'].includes(timeframe)
              ? 'VWAP - Cumulative Volume Weighted Average Price (daily+)'
              : 'VWAP - Volume Weighted Average Price (resets daily for intraday)'}
          >
            VWAP
          </button>

          {/* Keltner Channel Toggle - Cyan */}
          <button
            onClick={() => setShowKC(!showKC)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showKC
                ? 'bg-[#06b6d4] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="Keltner Channel (EMA20, ATR10×1.5)"
          >
            KC
          </button>

          {/* TTM Squeeze Toggle */}
          <button
            onClick={() => setShowSqueeze(!showSqueeze)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showSqueeze
                ? 'bg-[#8b5cf6] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="TTM Squeeze (BB inside KC = consolidation)"
          >
            Squeeze
          </button>

          {/* Trading Levels Toggle - Show when trading levels are available */}
          {tradingLevels && (
            <button
              onClick={() => setShowTradingLevels(!showTradingLevels)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                showTradingLevels
                  ? 'bg-[#10b981] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="Show Entry/Stop/Target levels from AI analysis"
            >
              📍 Levels
            </button>
          )}

          {/* AI Prediction Line Toggles - Separator */}
          <span className="text-[var(--text-secondary)] opacity-40">|</span>

          {/* Technical ML Prediction Toggle */}
          <button
            onClick={() => {
              if (!aiPredLines.technical.futurePredictions.length) {
                generatePredictions('technical');
              } else {
                toggleAIPredLine('technical');
              }
            }}
            disabled={aiPredLoading.technical}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              aiPredLines.technical.enabled
                ? 'bg-[#9333ea] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            } ${aiPredLoading.technical ? 'opacity-50 cursor-wait' : ''}`}
            title={`Technical ML 예측${aiPredLines.technical.backtestAccuracy ? ` (백테스트 ${aiPredLines.technical.backtestAccuracy.accuracy}% 정확도, ${aiPredLines.technical.backtestAccuracy.samples}일)` : ' - 클릭하여 생성'}`}
          >
            {aiPredLoading.technical ? '...' : 'Tech'}
          </button>

          {/* LSTM Prediction Toggle */}
          <button
            onClick={() => {
              if (!aiPredLines.lstm.futurePredictions.length) {
                generatePredictions('lstm');
              } else {
                toggleAIPredLine('lstm');
              }
            }}
            disabled={aiPredLoading.lstm}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              aiPredLines.lstm.enabled
                ? 'bg-[#f97316] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            } ${aiPredLoading.lstm ? 'opacity-50 cursor-wait' : ''}`}
            title={`LSTM 예측${aiPredLines.lstm.backtestAccuracy ? ` (백테스트 ${aiPredLines.lstm.backtestAccuracy.accuracy}% 정확도, ${aiPredLines.lstm.backtestAccuracy.samples}일)` : ' - 클릭하여 생성'}`}
          >
            {aiPredLoading.lstm ? '...' : 'LSTM'}
          </button>

          {/* LH AI Prediction Toggle */}
          <button
            onClick={() => {
              if (!aiPredLines.lh.futurePredictions.length) {
                generatePredictions('lh');
              } else {
                toggleAIPredLine('lh');
              }
            }}
            disabled={aiPredLoading.lh}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              aiPredLines.lh.enabled
                ? 'bg-[#dc2626] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            } ${aiPredLoading.lh ? 'opacity-50 cursor-wait' : ''}`}
            title={`LH AI 예측${aiPredLines.lh.backtestAccuracy ? ` (백테스트 ${aiPredLines.lh.backtestAccuracy.accuracy}% 정확도, ${aiPredLines.lh.backtestAccuracy.samples}일)` : ' - 클릭하여 생성'}`}
          >
            {aiPredLoading.lh ? '...' : 'LH'}
          </button>

          {/* Consensus Prediction Toggle */}
          <button
            onClick={() => {
              if (!aiPredLines.consensus.futurePredictions.length) {
                generatePredictions('consensus');
              } else {
                toggleAIPredLine('consensus');
              }
            }}
            disabled={aiPredLoading.consensus}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              aiPredLines.consensus.enabled
                ? 'bg-[#eab308] text-black'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            } ${aiPredLoading.consensus ? 'opacity-50 cursor-wait' : ''}`}
            title={`합의 예측 (3개 AI 평균)${aiPredLines.consensus.backtestAccuracy ? ` (백테스트 ${aiPredLines.consensus.backtestAccuracy.accuracy}% 정확도)` : ' - Tech, LSTM, LH 먼저 생성'}`}
          >
            {aiPredLoading.consensus ? '...' : '★'}
          </button>

          {/* Drawing Tools Toggle */}
          <button
            onClick={() => setShowDrawingTools(!showDrawingTools)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showDrawingTools
                ? 'bg-[#ec4899] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="Drawing Tools"
          >
            ✏️ Draw
          </button>

          <div className="ml-auto flex items-center gap-4 text-xs text-[var(--text-secondary)]">
            {ob && showOB && (
              // Korean standard: Buy=Red, Sell=Green
              <span className={`flex items-center gap-1 ${isBuyOB ? 'text-[#ef5350]' : 'text-[#26a69a]'}`}>
                <span className={`w-3 h-3 rounded ${isBuyOB ? 'bg-[#ef5350]' : 'bg-[#26a69a]'} opacity-40`}></span>
                {isBuyOB ? 'Buy' : 'Sell'} OB
                {ob.has_fvg && ' + FVG'}
                {/* Volume strength badge */}
                <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  ob.volume_strength === 'strong'
                    ? 'bg-green-500 text-white'
                    : ob.volume_strength === 'weak'
                    ? 'bg-gray-400 text-white'
                    : 'bg-gray-600 text-white'
                }`} title={`볼륨: ${ob.volume_ratio?.toFixed(1) || '1.0'}x 평균`}>
                  {ob.volume_ratio?.toFixed(1) || '1.0'}x
                </span>
                {analyzeData?.confluence && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    analyzeData.confluence.score >= 80
                      ? 'bg-yellow-400 text-black'
                      : 'bg-gray-600 text-white'
                  }`}>
                    {analyzeData.confluence.score >= 80 && '★ '}
                    {analyzeData.confluence.score}점
                  </span>
                )}
              </span>
            )}
            {/* Show filtered count if any */}
            {analyzeData && analyzeData.filtered_weak_obs > 0 && hideWeakOB && (
              <span className="text-gray-400 text-[10px]">
                ({analyzeData.filtered_weak_obs}개 약한 OB 숨김)
              </span>
            )}
            {/* Moving Average legends - only show if enabled */}
            {showEMA20 && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#f472b6]"></span> EMA20
              </span>
            )}
            {showSMA20 && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#B22222]"></span> SMA20
              </span>
            )}
            {showEMA200 && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#00BFFF]"></span> EMA200
              </span>
            )}
            {showSMA200 && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#0066FF]"></span> SMA200
              </span>
            )}
            {/* VWAP legend */}
            {showVWAP && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#eab308]"></span> VWAP
              </span>
            )}
            {/* Keltner Channel legend */}
            {showKC && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#06b6d4]"></span> KC
              </span>
            )}
            {/* TTM Squeeze Status */}
            {showSqueeze && data && data.squeeze && (
              <span className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    data.squeeze[data.squeeze.length - 1]
                      ? 'bg-[#ef4444]'  // Red = Squeeze ON (consolidation)
                      : 'bg-[#22c55e]'  // Green = Squeeze OFF (breakout)
                  }`}
                ></span>
                <span className={
                  data.squeeze[data.squeeze.length - 1]
                    ? 'text-[#ef4444]'
                    : 'text-[#22c55e]'
                }>
                  {data.squeeze[data.squeeze.length - 1] ? 'Squeeze' : 'Fired'}
                </span>
              </span>
            )}
            {/* AI Prediction legends with backtest accuracy */}
            {hasEnabledPredictions && (
              <>
                <span className="text-[var(--text-secondary)] opacity-40 ml-2">|</span>
                {aiPredLines.technical.enabled && (
                  <span className="flex items-center gap-1 text-[#9333ea]" title={
                    aiPredLines.technical.backtestAccuracy
                      ? `백테스트: ${aiPredLines.technical.backtestAccuracy.samples}일 데이터, 방향예측 ${aiPredLines.technical.backtestAccuracy.direction.percentage}%`
                      : '백테스트 데이터 없음'
                  }>
                    <span className="w-3 h-0.5 bg-[#9333ea]"></span>
                    Tech
                    {aiPredLines.technical.backtestAccuracy && (
                      <span className={`text-[10px] px-1 rounded ${
                        aiPredLines.technical.backtestAccuracy.accuracy > 95 ? 'bg-green-500/30 text-green-400' :
                        aiPredLines.technical.backtestAccuracy.accuracy > 90 ? 'bg-yellow-500/30 text-yellow-400' :
                        'bg-red-500/30 text-red-400'
                      }`}>
                        {aiPredLines.technical.backtestAccuracy.accuracy}%
                      </span>
                    )}
                  </span>
                )}
                {aiPredLines.lstm.enabled && (
                  <span className="flex items-center gap-1 text-[#f97316]" title={
                    aiPredLines.lstm.backtestAccuracy
                      ? `백테스트: ${aiPredLines.lstm.backtestAccuracy.samples}일 데이터, 방향예측 ${aiPredLines.lstm.backtestAccuracy.direction.percentage}%`
                      : '백테스트 데이터 없음'
                  }>
                    <span className="w-3 h-0.5 bg-[#f97316]"></span>
                    LSTM
                    {aiPredLines.lstm.backtestAccuracy && (
                      <span className={`text-[10px] px-1 rounded ${
                        aiPredLines.lstm.backtestAccuracy.accuracy > 95 ? 'bg-green-500/30 text-green-400' :
                        aiPredLines.lstm.backtestAccuracy.accuracy > 90 ? 'bg-yellow-500/30 text-yellow-400' :
                        'bg-red-500/30 text-red-400'
                      }`}>
                        {aiPredLines.lstm.backtestAccuracy.accuracy}%
                      </span>
                    )}
                  </span>
                )}
                {aiPredLines.lh.enabled && (
                  <span className="flex items-center gap-1 text-[#dc2626]" title={
                    aiPredLines.lh.backtestAccuracy
                      ? `백테스트: ${aiPredLines.lh.backtestAccuracy.samples}일 데이터, 방향예측 ${aiPredLines.lh.backtestAccuracy.direction.percentage}%`
                      : '백테스트 데이터 없음'
                  }>
                    <span className="w-3 h-0.5 bg-[#dc2626]"></span>
                    LH
                    {aiPredLines.lh.backtestAccuracy && (
                      <span className={`text-[10px] px-1 rounded ${
                        aiPredLines.lh.backtestAccuracy.accuracy > 95 ? 'bg-green-500/30 text-green-400' :
                        aiPredLines.lh.backtestAccuracy.accuracy > 90 ? 'bg-yellow-500/30 text-yellow-400' :
                        'bg-red-500/30 text-red-400'
                      }`}>
                        {aiPredLines.lh.backtestAccuracy.accuracy}%
                      </span>
                    )}
                  </span>
                )}
                {aiPredLines.consensus.enabled && (
                  <span className="flex items-center gap-1 text-[#eab308]" title={
                    aiPredLines.consensus.backtestAccuracy
                      ? `백테스트: ${aiPredLines.consensus.backtestAccuracy.samples}일 데이터, 방향예측 ${aiPredLines.consensus.backtestAccuracy.direction.percentage}%`
                      : '백테스트 데이터 없음'
                  }>
                    <span className="w-3 h-0.5 bg-[#eab308]"></span>
                    Cons
                    {aiPredLines.consensus.backtestAccuracy && (
                      <span className={`text-[10px] px-1 rounded ${
                        aiPredLines.consensus.backtestAccuracy.accuracy > 95 ? 'bg-green-500/30 text-green-400' :
                        aiPredLines.consensus.backtestAccuracy.accuracy > 90 ? 'bg-yellow-500/30 text-yellow-400' :
                        'bg-red-500/30 text-red-400'
                      }`}>
                        {aiPredLines.consensus.backtestAccuracy.accuracy}%
                      </span>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 relative">
        {/* Compact mode symbol overlay - editable */}
        {compact && (
          <div className="absolute top-2 left-2 z-20 flex items-center gap-2">
            {isEditing ? (
              <div
                ref={editContainerRef}
                className="relative"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1 bg-[var(--bg-secondary)] rounded p-1">
                  {/* Market selector first - more prominent */}
                  <select
                    value={editMarket}
                    onChange={(e) => {
                      e.stopPropagation();
                      const newMarket = e.target.value as 'KR' | 'US';
                      setEditMarket(newMarket);
                      setShowSuggestions(true);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`text-xs font-bold px-1.5 py-1 rounded border-2 cursor-pointer outline-none ${
                      editMarket === 'KR'
                        ? 'bg-[#ef5350] bg-opacity-20 border-[#ef5350] text-[#ef5350]'
                        : 'bg-[#26a69a] bg-opacity-20 border-[#26a69a] text-[#26a69a]'
                    }`}
                    style={{ WebkitAppearance: 'menulist', appearance: 'menulist' }}
                  >
                    <option value="KR" className="bg-[var(--bg-secondary)] text-[var(--text-primary)]">KR</option>
                    <option value="US" className="bg-[var(--bg-secondary)] text-[var(--text-primary)]">US</option>
                  </select>
                  <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => {
                      setEditValue(e.target.value.toUpperCase());
                      setShowSuggestions(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && editValue.trim()) {
                        onSymbolChange?.(editValue.trim(), editMarket);
                        setIsEditing(false);
                        setShowSuggestions(false);
                      } else if (e.key === 'Escape') {
                        setIsEditing(false);
                        setShowSuggestions(false);
                      }
                    }}
                    placeholder={editMarket === 'KR' ? '종목코드' : 'Symbol'}
                    className="w-24 bg-[var(--bg-tertiary)] text-sm font-bold px-2 py-1 rounded border border-[var(--accent-blue)] outline-none"
                    autoFocus
                  />
                  {/* Submit button for clarity */}
                  <button
                    onClick={() => {
                      if (editValue.trim()) {
                        onSymbolChange?.(editValue.trim(), editMarket);
                        setIsEditing(false);
                        setShowSuggestions(false);
                      }
                    }}
                    className="px-2 py-1 text-xs font-bold bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
                  >
                    확인
                  </button>
                </div>
                {/* Autocomplete suggestions - filtered by selected market */}
                {showSuggestions && editValue.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-48 max-h-32 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-lg">
                    {watchlistSymbols
                      .filter(item =>
                        item.market === editMarket && (
                          item.symbol.includes(editValue) ||
                          item.symbol.startsWith(editValue)
                        )
                      )
                      .slice(0, 5)
                      .map((item) => (
                        <div
                          key={`${item.market}-${item.symbol}`}
                          onClick={() => {
                            onSymbolChange?.(item.symbol, item.market);
                            setIsEditing(false);
                            setShowSuggestions(false);
                          }}
                          className="px-2 py-1 text-sm hover:bg-[var(--bg-tertiary)] cursor-pointer flex justify-between"
                        >
                          <span className="font-medium">{item.symbol}</span>
                          <span className={`text-xs font-medium ${item.market === 'KR' ? 'text-[#ef5350]' : 'text-[#26a69a]'}`}>
                            {item.market}
                          </span>
                        </div>
                      ))}
                    {watchlistSymbols.filter(item =>
                      item.market === editMarket && (
                        item.symbol.includes(editValue) ||
                        item.symbol.startsWith(editValue)
                      )
                    ).length === 0 && (
                      <div className="px-2 py-1 text-xs text-[var(--text-secondary)]">
                        {editMarket} 관심목록에 없음 - Enter로 직접 입력
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <span
                  onClick={(e) => {
                    if (onSymbolChange) {
                      e.stopPropagation();
                      setEditValue(symbol);
                      setEditMarket(market as 'KR' | 'US');
                      setIsEditing(true);
                    }
                  }}
                  className={`text-sm font-bold bg-[var(--bg-secondary)] bg-opacity-90 px-2 py-1 rounded ${onSymbolChange ? 'cursor-text hover:ring-1 hover:ring-[var(--accent-blue)]' : ''}`}
                  title={onSymbolChange ? '클릭하여 종목 변경' : undefined}
                >
                  {symbol}
                </span>
                <span className={`text-xs font-medium bg-[var(--bg-secondary)] bg-opacity-90 px-1.5 py-0.5 rounded ${market === 'KR' ? 'text-[#ef5350]' : 'text-[#26a69a]'}`}>
                  {market}
                </span>
                {/* Watchlist star button in compact mode - always visible */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWatchlistToggle();
                  }}
                  disabled={isWatchlistLoading}
                  className={`text-base bg-[var(--bg-secondary)] bg-opacity-90 px-1.5 py-0.5 rounded transition-all hover:scale-110 disabled:opacity-50 ${
                    effectiveInWatchlist
                      ? 'text-yellow-400'
                      : 'text-gray-400 hover:text-yellow-400'
                  }`}
                  title={effectiveInWatchlist ? '관심목록에서 제거' : '관심목록에 추가'}
                >
                  {isWatchlistLoading ? '...' : effectiveInWatchlist ? '★' : '☆'}
                </button>
                {lastBar && (
                  <span className={`text-xs font-medium bg-[var(--bg-secondary)] bg-opacity-90 px-1.5 py-0.5 rounded ${priceChange >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {priceChange >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)] z-10">
            <div className="text-[var(--text-secondary)]">{compact ? '...' : 'Loading chart data...'}</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)] z-10">
            <div className="text-[var(--accent-red)] text-sm">{compact ? 'Error' : `Error: ${error}`}</div>
          </div>
        )}
        {noData && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)] z-10">
            <div className="text-center">
              <div className="text-[var(--text-secondary)] text-sm mb-2">
                {compact ? '데이터 없음' : `${symbol} (${market}) 데이터 없음`}
              </div>
              {!compact && !effectiveInWatchlist && (
                <button
                  onClick={handleAddToWatchlist}
                  disabled={isWatchlistLoading}
                  className="px-3 py-1.5 text-sm bg-[var(--accent-blue)] text-white rounded hover:opacity-90 disabled:opacity-50"
                >
                  {isWatchlistLoading ? '다운로드 중...' : '데이터 다운로드'}
                </button>
              )}
              {effectiveInWatchlist && (
                <div className="text-xs text-[var(--text-secondary)]">
                  해당 타임프레임 데이터가 없습니다
                </div>
              )}
            </div>
          </div>
        )}

        {/* Order Block overlay - only in non-compact mode */}
        {!compact && showOB && obBoxPosition.visible && ob && (() => {
          const confluenceScore = analyzeData?.confluence?.score ?? 0;
          const isHighConfluence = confluenceScore >= 80;

          // Volume-based styling
          const volStrength = ob.volume_strength || 'normal';
          const volRatio = ob.volume_ratio || 1.0;
          const isStrong = volStrength === 'strong';
          const isWeak = volStrength === 'weak';

          // Volumatic strategy fields
          const ageStatus = ob.age_status || 'fresh';
          const ageCandles = ob.age_candles || 0;
          const volumaticScore = ob.volumatic_score || 0;
          const isAged = ageStatus === 'aged';
          const isVolumatic = volumaticScore >= 80; // High volumatic score

          // Retest signal detection
          const retestSignal = ob.retest_signal;
          const isRetestActive = retestSignal?.retest_active ?? false;
          const retestDirection = retestSignal?.direction ?? '';
          const retestVolConfirm = retestSignal?.volume_confirm ?? 0;

          // Aged OBs get grayed out regardless of volume strength
          // Strong volumatic OBs get gold border
          // Retest active: extra thick border + animation
          // INCREASED VISIBILITY: thicker borders and higher opacity
          const borderWidth = isRetestActive ? '4px' : isAged ? '2px' : isVolumatic ? '4px' : isStrong ? '3px' : isWeak ? '2px' : '3px';
          const bgOpacity = isAged ? 0.2 : isWeak ? 0.25 : 0.4;
          const borderOpacity = isAged ? 0.5 : isWeak ? 0.6 : 1.0;
          const glowIntensity = isRetestActive ? '20px' : isVolumatic ? '15px' : isHighConfluence ? '12px' : isStrong ? '10px' : '6px';

          // Gold border for high volumatic score, gray for aged, special for retest
          let borderColor: string;
          let bgColor: string;
          if (isAged) {
            borderColor = 'rgba(128, 128, 128, 0.5)';
            bgColor = 'rgba(128, 128, 128, 0.15)';
          } else if (isRetestActive) {
            // Cyan/magenta border for active retest
            borderColor = retestDirection === 'bull' ? 'rgba(0, 255, 200, 0.95)' : 'rgba(255, 50, 150, 0.95)';
            // Korean standard: Buy=Red, Sell=Green
            bgColor = isBuyOB
              ? `rgba(239, 83, 80, ${bgOpacity + 0.1})`
              : `rgba(38, 166, 154, ${bgOpacity + 0.1})`;
          } else if (isVolumatic) {
            // Gold border for high volumatic score
            borderColor = 'rgba(255, 215, 0, 0.9)';
            // Korean standard: Buy=Red, Sell=Green
            bgColor = isBuyOB
              ? `rgba(239, 83, 80, ${bgOpacity})`
              : `rgba(38, 166, 154, ${bgOpacity})`;
          } else {
            // Korean standard: Buy=Red, Sell=Green
            bgColor = isBuyOB
              ? `rgba(239, 83, 80, ${bgOpacity})`
              : `rgba(38, 166, 154, ${bgOpacity})`;
            borderColor = isBuyOB
              ? `rgba(239, 83, 80, ${borderOpacity})`
              : `rgba(38, 166, 154, ${borderOpacity})`;
          }

          // Skip rendering if dimensions are invalid
          const boxWidth = obBoxPosition.right - obBoxPosition.left;
          const boxHeight = obBoxPosition.bottom - obBoxPosition.top;
          if (boxWidth <= 0 || boxHeight <= 0 || boxHeight > 2000) {
            return null;
          }

          return (
            <div
              className={`absolute z-[5] ${isRetestActive ? 'animate-pulse' : ''}`}
              style={{
                left: obBoxPosition.left,
                top: obBoxPosition.top,
                width: boxWidth,
                height: Math.max(4, boxHeight), // Minimum 4px height for visibility
                backgroundColor: bgColor,
                border: `${borderWidth} solid ${borderColor}`,
                borderRadius: '3px',
                boxShadow: isRetestActive
                  ? `0 0 ${glowIntensity} ${retestDirection === 'bull' ? 'rgba(0, 255, 200, 0.8)' : 'rgba(255, 50, 150, 0.8)'}, 0 0 30px ${retestDirection === 'bull' ? 'rgba(0, 255, 200, 0.4)' : 'rgba(255, 50, 150, 0.4)'}`
                  : isVolumatic
                  ? `0 0 ${glowIntensity} rgba(255, 215, 0, 0.6), 0 0 25px rgba(255, 215, 0, 0.3)`
                  : isHighConfluence
                  // Korean standard: Buy=Red, Sell=Green
                  ? `0 0 ${glowIntensity} ${isBuyOB ? 'rgba(239, 83, 80, 0.7)' : 'rgba(38, 166, 154, 0.7)'}, 0 0 20px rgba(255, 215, 0, 0.4)`
                  : isAged
                  ? 'none'
                  // Korean standard: Buy=Red, Sell=Green
                  : `0 0 ${glowIntensity} ${isBuyOB ? `rgba(239, 83, 80, ${isWeak ? 0.2 : 0.5})` : `rgba(38, 166, 154, ${isWeak ? 0.2 : 0.5})`}`,
                pointerEvents: 'none',
                opacity: isAged ? 0.5 : isWeak ? 0.6 : 1,
                animation: isRetestActive ? 'pulse 1.5s ease-in-out infinite' : undefined,
              }}
              title={`볼륨: ${volRatio.toFixed(1)}x 평균 (${volStrength === 'strong' ? '강함' : volStrength === 'weak' ? '약함' : '보통'}) | 나이: ${ageCandles}캔들 (${ageStatus === 'fresh' ? '신선' : ageStatus === 'mature' ? '성숙' : '노후'})${isRetestActive ? ` | 리테스트 활성: ${retestDirection === 'bull' ? '매수' : '매도'} 볼륨 ${retestVolConfirm.toFixed(1)}x` : ''}`}
            >
              {/* Simple OB label - clean and minimal */}
              <div className="absolute top-1 left-1 flex items-center gap-1">
                <div
                  className="px-2 py-0.5 text-xs font-bold rounded"
                  style={{
                    // Korean standard: Buy=Red, Sell=Green
                    backgroundColor: isAged ? 'rgba(128, 128, 128, 0.9)' : isBuyOB ? 'rgba(220, 50, 50, 0.95)' : 'rgba(0, 200, 100, 0.95)',
                    color: 'white',
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  }}
                >
                  {isBuyOB ? '▲ OB' : '▼ OB'}
                </div>
                {/* Only show retest badge when active */}
                {isRetestActive && (
                  <div
                    className="px-1.5 py-0.5 text-xs font-black rounded animate-pulse"
                    style={{
                      backgroundColor: retestDirection === 'bull' ? 'rgba(0, 255, 200, 0.95)' : 'rgba(255, 50, 150, 0.95)',
                      color: retestDirection === 'bull' ? '#003d33' : '#4d0026',
                    }}
                  >
                    RET
                  </div>
                )}
              </div>
              {/* Right resize handle ONLY - drag to extend/shorten forward in time */}
              <div
                className="absolute -right-2 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center"
                style={{
                  pointerEvents: 'auto',
                  // Korean standard: Buy=Red, Sell=Green
                  backgroundColor: isResizingOB ? (isBuyOB ? 'rgba(239, 83, 80, 0.4)' : 'rgba(38, 166, 154, 0.4)') : 'transparent',
                }}
                onMouseDown={handleObResizeStart}
                title="좌우로 드래그하여 확장/축소"
              >
                <div
                  className="w-1 h-8 rounded"
                  style={{
                    // Korean standard: Buy=Red, Sell=Green
                    backgroundColor: isBuyOB ? 'rgba(239, 83, 80, 0.9)' : 'rgba(38, 166, 154, 0.9)',
                  }}
                />
              </div>
            </div>
          );
        })()}

        {/* FVG overlays - independent from OB, multiple FVGs supported */}
        {!compact && showFVG && fvgBoxPositions.map((fvgPos, idx) => {
          const isBuyFVG = fvgPos.direction === 'buy';
          const fvgWidth = fvgPos.right - fvgPos.left;
          const fvgHeight = fvgPos.bottom - fvgPos.top;
          // Skip invalid dimensions
          if (fvgWidth <= 0 || fvgHeight <= 0 || fvgHeight > 2000) {
            return null;
          }
          return (
            <div
              key={`fvg-${idx}`}
              className="absolute z-[4]"
              style={{
                left: fvgPos.left,
                top: fvgPos.top,
                width: fvgWidth,
                height: Math.max(2, fvgHeight), // Minimum 2px height
                // Korean standard: Buy=Red, Sell=Green
                backgroundColor: isBuyFVG ? 'rgba(239, 83, 80, 0.15)' : 'rgba(38, 166, 154, 0.15)',
                border: `1px dashed ${isBuyFVG ? 'rgba(239, 83, 80, 0.6)' : 'rgba(38, 166, 154, 0.6)'}`,
                borderRadius: '2px',
                pointerEvents: 'none',
              }}
            >
              {/* FVG label */}
              <div
                className="absolute top-0 left-1 px-1 py-0.5 text-[9px] font-bold rounded"
                style={{
                  // Korean standard: Buy=Red, Sell=Green
                  backgroundColor: isBuyFVG ? 'rgba(239, 83, 80, 0.8)' : 'rgba(38, 166, 154, 0.8)',
                  color: 'white',
                }}
              >
                FVG
              </div>
            </div>
          );
        })}

        {/* MTF (Multi-Timeframe) HTF Zones - only in non-compact mode */}
        {!compact && showMTF && mtfData && chartRef.current && candlestickSeriesRef.current && (
          <MTFZonesOverlay
            mtfData={mtfData}
            data={data}
            chart={chartRef.current}
            series={candlestickSeriesRef.current}
          />
        )}

        {/* Volume Profile overlay - only in non-compact mode */}
        {!compact && showVP && volumeProfile && chartRef.current && candlestickSeriesRef.current && (
          <VolumeProfileOverlay
            volumeProfile={volumeProfile}
            chart={chartRef.current}
            series={candlestickSeriesRef.current}
          />
        )}

        {/* Drawing Tools - only in non-compact mode */}
        {!compact && showDrawingTools && (
          <>
            <DrawingToolbar
              activeTool={activeTool}
              onToolSelect={setActiveTool}
              onClearAll={clearAllDrawings}
              drawingCount={drawings.length}
            />
            {chartRef.current && candlestickSeriesRef.current && data && (
              <DrawingCanvas
                chart={chartRef.current}
                series={candlestickSeriesRef.current}
                drawings={drawings}
                manager={drawingManager}
                activeTool={activeTool}
                selectedDrawingId={selectedDrawingId}
                onDrawingSelect={setSelectedDrawingId}
                onDrawingComplete={() => setActiveTool(null)}
                containerRef={chartContainerRef as React.RefObject<HTMLDivElement>}
                data={data}
                isActiveChart={isActiveForDrawing}
                onChartActivate={onMainChartActivate}
              />
            )}
          </>
        )}

        {/* Drawing Property Editor Modal */}
        {editingDrawing && (
          <DrawingPropertyEditor
            drawing={editingDrawing}
            onUpdate={(updates) => {
              if (editingDrawing) {
                updateDrawing(editingDrawing.id, updates);
              }
            }}
            onClose={() => setEditingDrawing(null)}
          />
        )}

        <div className="relative w-full h-full">
          <div
            ref={chartContainerRef}
            className="w-full h-full"
            style={{ marginLeft: !compact && showDrawingTools ? 48 : 0 }}
          />

          {/* Current Price Label Overlay - aligned with Y-axis */}
          {/* Uses real-time price when available, falls back to last bar close */}
          {!compact && data && data.bars.length > 0 && chartRef.current && candlestickSeriesRef.current && lastBar && (
            <CurrentPriceLabel
              price={realtimePrice?.price ?? lastBar.close}
              prevClose={realtimePrice?.prevClose ?? prevBar?.close ?? lastBar.open}
              market={market}
              chart={chartRef.current}
              series={candlestickSeriesRef.current}
            />
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Performance: Custom comparison to prevent re-renders when non-critical props change
  // Only re-render when these critical props change
  return (
    prevProps.symbol === nextProps.symbol &&
    prevProps.market === nextProps.market &&
    prevProps.timeframe === nextProps.timeframe &&
    prevProps.compact === nextProps.compact &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.showHeader === nextProps.showHeader &&
    prevProps.showTimeScale === nextProps.showTimeScale &&
    prevProps.isActiveForDrawing === nextProps.isActiveForDrawing &&
    // Compare realtime price by value (not reference) - only significant changes
    (prevProps.realtimePrice?.price === nextProps.realtimePrice?.price) &&
    // Compare trading levels by reference (null check)
    (prevProps.tradingLevels === nextProps.tradingLevels)
  );
});

/**
 * Current price label component for chart overlay - aligned with Y-axis
 */
function CurrentPriceLabel({
  price,
  prevClose,
  market,
  chart,
  series,
}: {
  price: number;
  prevClose: number;
  market: string;
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
}) {
  const [yPosition, setYPosition] = useState<number | null>(null);

  // Update Y position when price changes
  useEffect(() => {
    if (price <= 0) {
      setYPosition(null);
      return;
    }

    const updatePosition = () => {
      const y = series.priceToCoordinate(price);
      if (y !== null && y > 0) {
        setYPosition(y);
      }
    };

    updatePosition();

    // Subscribe to chart crosshair move to update on scroll/zoom
    const handler = () => updatePosition();
    chart.subscribeCrosshairMove(handler);

    return () => {
      chart.unsubscribeCrosshairMove(handler);
    };
  }, [price, prevClose, chart, series]);

  if (price <= 0 || yPosition === null) return null;

  const change = price - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const isUp = change >= 0;

  // Format price
  const formatPrice = (value: number) => {
    if (market === 'KR') {
      return value.toLocaleString('ko-KR');
    }
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Format change percentage
  const formatChangePct = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  return (
    <div
      className="absolute right-0 z-20"
      style={{
        pointerEvents: 'none',
        top: yPosition - 14, // Center the label vertically on the price line
        transform: 'translateX(-60px)', // Position to left of Y-axis
      }}
    >
      <div
        className={`px-2 py-1 rounded shadow-lg border ${
          isUp
            ? 'bg-green-600 border-green-500'
            : 'bg-red-600 border-red-500'
        }`}
      >
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-sm font-bold font-mono text-white`}
          >
            {market === 'KR' ? '₩' : '$'}{formatPrice(price)}
          </span>
          <span
            className={`text-sm font-semibold ${
              isUp ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {formatChangePct(changePct)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Volume Profile overlay component
 */
function VolumeProfileOverlay({
  volumeProfile,
  chart,
  series,
}: {
  volumeProfile: VolumeProfileResponse;
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
}) {
  const [positions, setPositions] = useState<{
    bins: { y: number; height: number; width: number; inValueArea: boolean }[];
    pocY: number;
    vahY: number;
    valY: number;
    chartHeight: number;
  } | null>(null);

  // Calculate positions based on price coordinates
  useEffect(() => {
    const updatePositions = () => {
      if (!volumeProfile || volumeProfile.histogram.length === 0) {
        setPositions(null);
        return;
      }

      const chartHeight = chart.timeScale().height() || 400;
      const maxWidth = 100; // Max bar width in pixels

      // Calculate bin positions
      const bins: { y: number; height: number; width: number; inValueArea: boolean }[] = [];

      // Sort histogram by price for proper rendering
      const sortedHistogram = [...volumeProfile.histogram].sort((a, b) => b.price - a.price);

      for (let i = 0; i < sortedHistogram.length; i++) {
        const bin = sortedHistogram[i];
        const nextBin = sortedHistogram[i + 1];

        const y = series.priceToCoordinate(bin.price);
        if (y === null) continue;

        // Calculate height based on price difference to next bin
        let height = 4; // Minimum height
        if (nextBin) {
          const nextY = series.priceToCoordinate(nextBin.price);
          if (nextY !== null) {
            height = Math.max(2, Math.abs(nextY - y));
          }
        }

        const width = (bin.percent / 100) * maxWidth;

        bins.push({
          y: y - height / 2,
          height,
          width,
          inValueArea: bin.in_value_area,
        });
      }

      // POC, VAH, VAL lines
      const pocY = series.priceToCoordinate(volumeProfile.poc_price);
      const vahY = series.priceToCoordinate(volumeProfile.vah_price);
      const valY = series.priceToCoordinate(volumeProfile.val_price);

      setPositions({
        bins,
        pocY: pocY ?? 0,
        vahY: vahY ?? 0,
        valY: valY ?? 0,
        chartHeight,
      });
    };

    updatePositions();

    // Subscribe to chart updates
    chart.timeScale().subscribeVisibleLogicalRangeChange(updatePositions);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updatePositions);
    };
  }, [volumeProfile, chart, series]);

  if (!positions || positions.bins.length === 0) return null;

  return (
    <div className="absolute right-[60px] top-0 bottom-[22px] z-[3] pointer-events-none">
      {/* Volume histogram bars */}
      <div className="relative h-full">
        {positions.bins.map((bin, i) => (
          <div
            key={i}
            className="absolute right-0"
            style={{
              top: bin.y,
              height: Math.max(1, bin.height),
              width: bin.width,
              backgroundColor: bin.inValueArea
                ? 'rgba(139, 92, 246, 0.5)'  // Purple for value area
                : 'rgba(139, 92, 246, 0.25)', // Lighter for outside
              borderLeft: bin.inValueArea ? '1px solid rgba(139, 92, 246, 0.8)' : 'none',
            }}
          />
        ))}
      </div>

      {/* POC line */}
      {positions.pocY > 0 && (
        <div
          className="absolute right-0 left-0 flex items-center"
          style={{ top: positions.pocY }}
        >
          <div className="flex-1 h-[2px] bg-[#f59e0b]" />
          <span className="text-[9px] font-bold text-[#f59e0b] bg-[var(--bg-primary)] px-1 rounded">
            POC
          </span>
        </div>
      )}

      {/* VAH line */}
      {positions.vahY > 0 && (
        <div
          className="absolute right-0 left-0 flex items-center"
          style={{ top: positions.vahY }}
        >
          <div className="flex-1 h-[1px] bg-[#8b5cf6] opacity-70" style={{ backgroundImage: 'repeating-linear-gradient(to right, #8b5cf6 0, #8b5cf6 4px, transparent 4px, transparent 8px)' }} />
          <span className="text-[8px] font-medium text-[#8b5cf6] bg-[var(--bg-primary)] px-0.5 rounded opacity-80">
            VAH
          </span>
        </div>
      )}

      {/* VAL line */}
      {positions.valY > 0 && (
        <div
          className="absolute right-0 left-0 flex items-center"
          style={{ top: positions.valY }}
        >
          <div className="flex-1 h-[1px] bg-[#8b5cf6] opacity-70" style={{ backgroundImage: 'repeating-linear-gradient(to right, #8b5cf6 0, #8b5cf6 4px, transparent 4px, transparent 8px)' }} />
          <span className="text-[8px] font-medium text-[#8b5cf6] bg-[var(--bg-primary)] px-0.5 rounded opacity-80">
            VAL
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * MTF Zones overlay component - displays HTF OBs and FVGs on LTF chart
 */
function MTFZonesOverlay({
  mtfData,
  data,
  chart,
  series,
}: {
  mtfData: MTFAnalyzeResponse;
  data: OHLCVResponse | null;
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
}) {
  const [positions, setPositions] = useState<{
    htfObs: { left: number; right: number; top: number; bottom: number; direction: string; htfTf: string; volStrength: number; priceInZone: boolean }[];
    htfFvgs: { left: number; right: number; top: number; bottom: number; direction: string; htfTf: string; isFresh: boolean; priceInGap: boolean }[];
  } | null>(null);

  useEffect(() => {
    const updatePositions = () => {
      if (!mtfData || !data || data.bars.length === 0) {
        setPositions(null);
        return;
      }

      const timeScale = chart.timeScale();
      const chartRightEdge = chart.timeScale().width() - 60;

      // Calculate positions for HTF OBs
      // Get chart height from the chart API options
      const chartHeight = (chart.options() as { height?: number }).height || 500;
      const htfObs = mtfData.htf_obs.map((ob) => {
        // Validate OB price data first
        if (!ob.zone_top || !ob.zone_bottom ||
            isNaN(ob.zone_top) || isNaN(ob.zone_bottom) ||
            ob.zone_top <= 0 || ob.zone_bottom <= 0) {
          return null;
        }

        // Get LTF time for the start of the zone
        const startIdx = Math.max(0, Math.min(ob.ltf_start, data.bars.length - 1));
        const startTime = data.bars[startIdx]?.time;

        if (!startTime) {
          return null;
        }

        const leftX = timeScale.timeToCoordinate(startTime as Time);
        const topY = series.priceToCoordinate(ob.zone_top);
        const bottomY = series.priceToCoordinate(ob.zone_bottom);

        // Validate coordinates - must be non-null, not NaN, and within reasonable bounds
        if (leftX === null || topY === null || bottomY === null ||
            isNaN(topY) || isNaN(bottomY) ||
            topY < -50 || bottomY < -50 ||
            topY > chartHeight + 50 || bottomY > chartHeight + 50) {
          return null;
        }

        // Check for reasonable height (HTF zones can be large, so allow up to 2x chart height)
        const height = Math.abs(bottomY - topY);
        if (height < 1 || height > chartHeight * 2) {
          return null;
        }

        return {
          left: leftX,
          right: chartRightEdge,
          top: Math.min(topY, bottomY),
          bottom: Math.max(topY, bottomY),
          direction: ob.direction,
          htfTf: ob.htf_timeframe,
          volStrength: ob.volume_strength,
          priceInZone: ob.price_in_zone,
        };
      }).filter(Boolean) as typeof positions extends { htfObs: infer T } ? T : never;

      // Calculate positions for HTF FVGs (reuse chartHeight from above)
      const htfFvgs = mtfData.htf_fvgs.map((fvg) => {
        // Validate FVG price data first
        if (!fvg.gap_high || !fvg.gap_low ||
            isNaN(fvg.gap_high) || isNaN(fvg.gap_low) ||
            fvg.gap_high <= 0 || fvg.gap_low <= 0 ||
            fvg.gap_high <= fvg.gap_low) {
          return null;
        }

        const startIdx = Math.max(0, Math.min(fvg.ltf_start, data.bars.length - 1));
        const startTime = data.bars[startIdx]?.time;

        if (!startTime) {
          return null;
        }

        const leftX = timeScale.timeToCoordinate(startTime as Time);
        const topY = series.priceToCoordinate(fvg.gap_high);
        const bottomY = series.priceToCoordinate(fvg.gap_low);

        // Validate coordinates - must be non-null, not NaN, and within reasonable bounds
        if (leftX === null || topY === null || bottomY === null ||
            isNaN(topY) || isNaN(bottomY) ||
            topY < -50 || bottomY < -50 ||
            topY > chartHeight + 50 || bottomY > chartHeight + 50) {
          return null;
        }

        // Check for reasonable height (HTF FVGs can be large, allow up to 2x chart height)
        const height = Math.abs(bottomY - topY);
        if (height < 1 || height > chartHeight * 2) {
          return null;
        }

        return {
          left: leftX,
          right: chartRightEdge,
          top: Math.min(topY, bottomY),
          bottom: Math.max(topY, bottomY),
          direction: fvg.direction,
          htfTf: fvg.htf_timeframe,
          isFresh: fvg.is_fresh,
          priceInGap: fvg.price_in_gap,
        };
      }).filter(Boolean) as typeof positions extends { htfFvgs: infer T } ? T : never;

      setPositions({ htfObs, htfFvgs });
    };

    updatePositions();

    // Subscribe to chart updates
    chart.timeScale().subscribeVisibleLogicalRangeChange(updatePositions);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updatePositions);
    };
  }, [mtfData, data, chart, series]);

  if (!positions) return null;

  return (
    <>
      {/* HTF Order Blocks - Orange/Amber theme */}
      {positions.htfObs.map((ob, i) => {
        // Skip if dimensions are invalid
        const obWidth = ob.right - ob.left;
        const obHeight = ob.bottom - ob.top;
        if (obWidth <= 0 || obHeight <= 0 || obHeight > 1000 ||
            ob.top < 0 || ob.bottom < 0 || isNaN(ob.top) || isNaN(ob.bottom)) {
          return null;
        }

        const isBullOB = ob.direction === 'buy';
        const baseColor = isBullOB ? '251, 146, 60' : '249, 115, 22'; // amber-400 : orange-500

        return (
          <div
            key={`htf-ob-${i}`}
            className={`absolute z-[3] ${ob.priceInZone ? 'animate-pulse' : ''}`}
            style={{
              left: ob.left,
              top: ob.top,
              width: obWidth,
              height: Math.max(2, obHeight),
              backgroundColor: `rgba(${baseColor}, ${ob.priceInZone ? 0.35 : 0.2})`,
              border: `2px solid rgba(${baseColor}, 0.8)`,
              borderRadius: '2px',
              boxShadow: ob.priceInZone ? `0 0 12px rgba(${baseColor}, 0.5)` : 'none',
              pointerEvents: 'none',
            }}
            title={`HTF ${ob.htfTf} ${isBullOB ? 'Bull' : 'Bear'} OB | Vol: ${ob.volStrength}`}
          >
            {/* HTF OB label */}
            <div
              className="absolute -top-4 left-1 px-1.5 py-0.5 text-[9px] font-bold rounded flex items-center gap-1"
              style={{
                backgroundColor: `rgba(${baseColor}, 0.95)`,
                color: 'white',
              }}
            >
              <span>{ob.htfTf}</span>
              <span>{isBullOB ? '▲' : '▼'}</span>
              {ob.priceInZone && <span className="animate-pulse">●</span>}
            </div>
          </div>
        );
      })}

      {/* HTF FVGs - Cyan/Teal theme */}
      {positions.htfFvgs.map((fvg, i) => {
        // Skip if dimensions are invalid (prevents vertical line rendering bug)
        const fvgWidth = fvg.right - fvg.left;
        const fvgHeight = fvg.bottom - fvg.top;
        if (fvgWidth <= 0 || fvgHeight <= 0 || fvgHeight > 1000 ||
            fvg.top < 0 || fvg.bottom < 0 || isNaN(fvg.top) || isNaN(fvg.bottom)) {
          return null;
        }

        const isBullFVG = fvg.direction === 'buy';
        const baseColor = isBullFVG ? '20, 184, 166' : '6, 182, 212'; // teal-500 : cyan-500

        return (
          <div
            key={`htf-fvg-${i}`}
            className={`absolute z-[2] ${fvg.priceInGap ? 'animate-pulse' : ''}`}
            style={{
              left: fvg.left,
              top: fvg.top,
              width: fvgWidth,
              height: Math.max(2, fvgHeight),
              backgroundColor: `rgba(${baseColor}, ${fvg.priceInGap ? 0.3 : 0.15})`,
              border: `1px dashed rgba(${baseColor}, 0.7)`,
              borderRadius: '2px',
              boxShadow: fvg.priceInGap ? `0 0 10px rgba(${baseColor}, 0.4)` : 'none',
              pointerEvents: 'none',
            }}
            title={`HTF ${fvg.htfTf} ${isBullFVG ? 'Bull' : 'Bear'} FVG | ${fvg.isFresh ? 'Fresh' : 'Partially filled'}`}
          >
            {/* HTF FVG label */}
            <div
              className="absolute -top-4 left-1 px-1 py-0.5 text-[8px] font-bold rounded flex items-center gap-0.5"
              style={{
                backgroundColor: `rgba(${baseColor}, 0.9)`,
                color: 'white',
              }}
            >
              <span>{fvg.htfTf}</span>
              <span>FVG</span>
              {fvg.isFresh && <span>✦</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}

// Default export for ChartContainer import
export default IntradayChart;
