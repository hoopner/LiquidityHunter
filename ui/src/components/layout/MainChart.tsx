import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  Time,
} from 'lightweight-charts';
import { fetchOHLCV, fetchAnalyze, fetchVolumeProfile, fetchMTFAnalyze, addToWatchlist, removeFromWatchlist } from '../../api/client';
import type { OHLCVResponse, AnalyzeResponse, WatchlistItem, VolumeProfileResponse, MTFAnalyzeResponse } from '../../api/types';
import { useDrawings } from '../../hooks/useDrawings';
import { DrawingToolbar } from '../chart/DrawingToolbar';
import { DrawingCanvas } from '../chart/DrawingCanvas';
import { DrawingPropertyEditor } from '../chart/DrawingPropertyEditor';
import type { DrawingToolType } from '../../types/drawings';

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1D', '1W', '1M'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

interface MainChartProps {
  symbol?: string;
  market?: string;
  compact?: boolean;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  isSelected?: boolean;
  onDoubleClick?: () => void;
  showHeader?: boolean;
  onSymbolChange?: (symbol: string, market: string) => void;
  watchlistSymbols?: WatchlistItem[];
  onWatchlistChange?: () => void;
  onChartReady?: (chartRef: React.RefObject<IChartApi | null>) => void;
  onVisibleRangeChange?: (range: { from: number; to: number } | null) => void;
  // Drawing tool coordination with subcharts
  onDrawingToolChange?: (tool: DrawingToolType | null, showTools: boolean) => void;
  onMainChartActivate?: () => void;
  isActiveForDrawing?: boolean;
}

interface BoxPosition {
  left: number;
  right: number;
  top: number;
  bottom: number;
  visible: boolean;
}

/**
 * Main chart area with TradingView lightweight-charts
 */
export function MainChart({
  symbol = '005930',
  market = 'KR',
  compact = false,
  timeframe: externalTimeframe,
  onTimeframeChange,
  isSelected = false,
  onDoubleClick,
  showHeader = true,
  onSymbolChange,
  watchlistSymbols = [],
  onWatchlistChange,
  onChartReady,
  onVisibleRangeChange,
  onDrawingToolChange,
  onMainChartActivate,
  isActiveForDrawing = true,
}: MainChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
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

  // Ref to store the latest onVisibleRangeChange callback (avoids stale closure)
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  onVisibleRangeChangeRef.current = onVisibleRangeChange;

  const [data, setData] = useState<OHLCVResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalTimeframe, setInternalTimeframe] = useState<Timeframe>('1D');
  const [noData, setNoData] = useState(false);

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
    if (onTimeframeChange) {
      onTimeframeChange(tf);
    } else {
      setInternalTimeframe(tf);
    }
  };

  // Order Block state
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  const [showOB, setShowOB] = useState(true);

  // Bollinger Band toggle states
  const [showBB1, setShowBB1] = useState(false);  // BB1 (20, 0.5) - Green
  const [showBB2, setShowBB2] = useState(false);  // BB2 (20, 3.0) - Red
  // VWAP toggle state
  const [showVWAP, setShowVWAP] = useState(false);
  // Keltner Channel toggle state
  const [showKC, setShowKC] = useState(false);
  // TTM Squeeze toggle state
  const [showSqueeze, setShowSqueeze] = useState(false);
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
        fetchOHLCV(symbol, market, timeframe)
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

  // Fetch OHLCV data
  useEffect(() => {
    setLoading(true);
    setError(null);
    setNoData(false);
    setAnalyzeData(null);

    fetchOHLCV(symbol, market, timeframe)
      .then((response) => {
        if (response.bars.length === 0) {
          setNoData(true);
          setData(null);
        } else {
          // Remove trailing bars with invalid (zero) OHLC values to prevent chart distortion
          // This can happen when yfinance returns incomplete data for the current day
          let validEndIdx = response.bars.length;
          while (validEndIdx > 0) {
            const bar = response.bars[validEndIdx - 1];
            if (bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0) {
              break;
            }
            validEndIdx--;
          }

          if (validEndIdx === 0) {
            setNoData(true);
            setData(null);
          } else if (validEndIdx < response.bars.length) {
            // Trim invalid trailing bars and corresponding indicator values
            setData({
              ...response,
              bars: response.bars.slice(0, validEndIdx),
              ema20: response.ema20.slice(0, validEndIdx),
              ema200: response.ema200.slice(0, validEndIdx),
              rsi: response.rsi.slice(0, validEndIdx),
              rsi_signal: response.rsi_signal.slice(0, validEndIdx),
              macd_line: response.macd_line.slice(0, validEndIdx),
              macd_signal: response.macd_signal.slice(0, validEndIdx),
              macd_histogram: response.macd_histogram.slice(0, validEndIdx),
              stoch_slow_k: response.stoch_slow_k.slice(0, validEndIdx),
              stoch_slow_d: response.stoch_slow_d.slice(0, validEndIdx),
              stoch_med_k: response.stoch_med_k.slice(0, validEndIdx),
              stoch_med_d: response.stoch_med_d.slice(0, validEndIdx),
              stoch_fast_k: response.stoch_fast_k.slice(0, validEndIdx),
              stoch_fast_d: response.stoch_fast_d.slice(0, validEndIdx),
            });
          } else {
            setData(response);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err.message.includes('not found') || err.message.includes('404')) {
          setNoData(true);
          setData(null);
        } else {
          setError(err.message);
        }
        setLoading(false);
      });
  }, [symbol, market, timeframe]);

  // Fetch Order Block analysis after data loads
  useEffect(() => {
    if (!data || data.bars.length === 0) return;

    const barIndex = data.bars.length - 1;
    fetchAnalyze(symbol, market, timeframe, barIndex, hideWeakOB)
      .then(setAnalyzeData)
      .catch(() => setAnalyzeData(null));
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
      .catch(() => {
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

    // Handle independent FVGs - only show FVGs close to current price
    if (analyzeData?.fvgs && analyzeData.fvgs.length > 0 && analyzeData.current_price > 0) {
      const currentPrice = analyzeData.current_price;

      // Filter FVGs to only those within 30% of current price (to avoid Y-axis distortion)
      const validFvgs = analyzeData.fvgs.filter(fvg => {
        const gapMid = (fvg.gap_high + fvg.gap_low) / 2;
        const distancePercent = Math.abs(gapMid - currentPrice) / currentPrice * 100;
        return distancePercent <= 30; // Only show FVGs within 30% of current price
      });

      // Get the most recent valid FVG
      const mostRecentFvg = validFvgs.length > 0 ? validFvgs[validFvgs.length - 1] : null;

      if (mostRecentFvg) {
        // FVG starts at the middle candle (i-1) where the gap becomes apparent
        const fvgStartIdx = Math.max(0, mostRecentFvg.index - 1);
        const fvgStartTime = data.bars[fvgStartIdx]?.time;

        if (fvgStartTime) {
          const fvgLeftX = timeScale.timeToCoordinate(fvgStartTime as Time);
          const fvgTopY = series.priceToCoordinate(mostRecentFvg.gap_high);
          const fvgBottomY = series.priceToCoordinate(mostRecentFvg.gap_low);

          // Validate coordinates are reasonable (not NaN, not extreme values)
          const chartHeight = container.clientHeight || 500;
          if (fvgLeftX !== null && fvgTopY !== null && fvgBottomY !== null &&
              !isNaN(fvgTopY) && !isNaN(fvgBottomY) &&
              fvgTopY >= -100 && fvgBottomY >= -100 &&
              fvgTopY <= chartHeight + 100 && fvgBottomY <= chartHeight + 100) {
            setFvgBoxPositions([{
              left: fvgLeftX,
              right: chartRightEdge,
              top: Math.min(fvgTopY, fvgBottomY),
              bottom: Math.max(fvgTopY, fvgBottomY),
              visible: true,
              direction: mostRecentFvg.direction,
            }]);
          } else {
            setFvgBoxPositions([]);
          }
        } else {
          setFvgBoxPositions([]);
        }
      } else {
        setFvgBoxPositions([]);
      }
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

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
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
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
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

    // Notify parent that chart is ready
    if (onChartReady) {
      onChartReady(chartRef);
    }

    // Create candlestick series (v5 API)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candlestickSeriesRef.current = candlestickSeries;

    // Create EMA20 line series - Bright Pink
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#f472b6',
      lineWidth: 2,
      title: 'EMA20',
    });
    ema20SeriesRef.current = ema20Series;

    // Create EMA200 line series - Green
    const ema200Series = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 2,
      title: 'EMA200',
    });
    ema200SeriesRef.current = ema200Series;

    // Create BB1 (Tight 0.5) line series - Green
    const bb1Upper = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 1,
      title: 'BB1 Upper',
      visible: false,
    });
    bb1UpperRef.current = bb1Upper;

    const bb1Middle = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 1,
      // Solid line (no lineStyle)
      title: 'BB1 Middle',
      visible: false,
    });
    bb1MiddleRef.current = bb1Middle;

    const bb1Lower = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 1,
      title: 'BB1 Lower',
      visible: false,
    });
    bb1LowerRef.current = bb1Lower;

    // Create BB2 (Wide 3.0) line series - Red
    const bb2Upper = chart.addSeries(LineSeries, {
      color: '#ef4444',
      lineWidth: 1,
      title: 'BB2 Upper',
      visible: false,
    });
    bb2UpperRef.current = bb2Upper;

    // BB2 has no middle line (only upper and lower)

    const bb2Lower = chart.addSeries(LineSeries, {
      color: '#ef4444',
      lineWidth: 1,
      title: 'BB2 Lower',
      visible: false,
    });
    bb2LowerRef.current = bb2Lower;

    // Create VWAP line series - Yellow
    const vwapLine = chart.addSeries(LineSeries, {
      color: '#eab308',  // Yellow
      lineWidth: 2,
      title: 'VWAP',
      visible: false,
    });
    vwapRef.current = vwapLine;

    // Create Keltner Channel line series - Cyan
    const kcUpper = chart.addSeries(LineSeries, {
      color: '#06b6d4',  // Cyan
      lineWidth: 1,
      title: 'KC Upper',
      visible: false,
    });
    kcUpperRef.current = kcUpper;

    const kcMiddle = chart.addSeries(LineSeries, {
      color: '#ffffff',  // White
      lineWidth: 1,
      title: 'KC Middle',
      visible: false,
    });
    kcMiddleRef.current = kcMiddle;

    const kcLower = chart.addSeries(LineSeries, {
      color: '#06b6d4',  // Cyan
      lineWidth: 1,
      title: 'KC Lower',
      visible: false,
    });
    kcLowerRef.current = kcLower;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
      updateBoxPositions();
    };

    // Subscribe to visible range changes to update box positions and sync subcharts
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      updateBoxPositions();
      // Notify parent to sync all subcharts with main chart's visible range
      if (onVisibleRangeChangeRef.current && range) {
        onVisibleRangeChangeRef.current({ from: range.from, to: range.to });
      }
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
    }

    // Add keyup listener to reset anchor lock when Ctrl is released
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      if (zoomResetTimerRef.current) {
        clearTimeout(zoomResetTimerRef.current);
      }
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
      chart.remove();
    };
  }, [updateBoxPositions]);

  // Update chart data
  useEffect(() => {
    if (!data || !candlestickSeriesRef.current || !ema20SeriesRef.current || !ema200SeriesRef.current) {
      return;
    }

    // Convert bars to candlestick data with explicit colors
    // close > open = UP (green), close < open = DOWN (red)
    const candlestickData: CandlestickData<Time>[] = data.bars.map((bar) => {
      const isUp = bar.close > bar.open;
      return {
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        color: isUp ? '#26a69a' : '#ef5350',
        borderColor: isUp ? '#26a69a' : '#ef5350',
        wickColor: isUp ? '#26a69a' : '#ef5350',
      };
    });

    // Convert EMA data to line data (skip null/zero values at the beginning)
    const ema20Data: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.ema20[i],
      }))
      .filter((d): d is LineData<Time> => d.value != null && d.value > 0);

    const ema200Data: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.ema200[i],
      }))
      .filter((d): d is LineData<Time> => d.value != null && d.value > 0);

    candlestickSeriesRef.current.setData(candlestickData);
    ema20SeriesRef.current.setData(ema20Data);
    ema200SeriesRef.current.setData(ema200Data);

    // Set BB1 data (skip zero values at beginning)
    const bb1UpperData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.bb1_upper?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    const bb1MiddleData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.bb1_middle?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    const bb1LowerData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.bb1_lower?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    bb1UpperRef.current?.setData(bb1UpperData);
    bb1MiddleRef.current?.setData(bb1MiddleData);
    bb1LowerRef.current?.setData(bb1LowerData);

    // Set BB2 data (skip zero values at beginning)
    const bb2UpperData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.bb2_upper?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    // BB2 has no middle line

    const bb2LowerData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.bb2_lower?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    bb2UpperRef.current?.setData(bb2UpperData);
    bb2LowerRef.current?.setData(bb2LowerData);

    // Set VWAP data (skip zero values - VWAP is intraday only)
    const vwapData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.vwap?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);
    vwapRef.current?.setData(vwapData);

    // Set Keltner Channel data (skip zero values at beginning)
    const kcUpperData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.kc_upper?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    const kcMiddleData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.kc_middle?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    const kcLowerData: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.kc_lower?.[i] || 0,
      }))
      .filter((d): d is LineData<Time> => d.value > 0);

    kcUpperRef.current?.setData(kcUpperData);
    kcMiddleRef.current?.setData(kcMiddleData);
    kcLowerRef.current?.setData(kcLowerData);

    // Fit content
    chartRef.current?.timeScale().fitContent();

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
  }, [data, updateBoxPositions]);

  // Update box positions when analyze data changes
  useEffect(() => {
    updateBoxPositions();
  }, [analyzeData, updateBoxPositions]);

  // Toggle BB1 visibility
  useEffect(() => {
    bb1UpperRef.current?.applyOptions({ visible: showBB1 });
    bb1MiddleRef.current?.applyOptions({ visible: showBB1 });
    bb1LowerRef.current?.applyOptions({ visible: showBB1 });
  }, [showBB1]);

  // Toggle BB2 visibility
  useEffect(() => {
    bb2UpperRef.current?.applyOptions({ visible: showBB2 });
    bb2LowerRef.current?.applyOptions({ visible: showBB2 });
  }, [showBB2]);

  // Toggle VWAP visibility
  useEffect(() => {
    vwapRef.current?.applyOptions({ visible: showVWAP });
  }, [showVWAP]);

  // Toggle Keltner Channel visibility
  useEffect(() => {
    kcUpperRef.current?.applyOptions({ visible: showKC });
    kcMiddleRef.current?.applyOptions({ visible: showKC });
    kcLowerRef.current?.applyOptions({ visible: showKC });
  }, [showKC]);

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
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

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

          {/* VWAP Toggle - Orange (intraday only) */}
          <button
            onClick={() => setShowVWAP(!showVWAP)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showVWAP
                ? ['1D', '1W', '1M'].includes(timeframe)
                  ? 'bg-[#6b7280] text-white'  // Gray when daily+ (VWAP not meaningful)
                  : 'bg-[#eab308] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title={['1D', '1W', '1M'].includes(timeframe)
              ? 'VWAP - Not available for daily+ timeframes (use 1h, 5m, etc.)'
              : 'VWAP - Volume Weighted Average Price (intraday)'}
          >
            VWAP{showVWAP && ['1D', '1W', '1M'].includes(timeframe) ? ' (N/A)' : ''}
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
              <span className={`flex items-center gap-1 ${isBuyOB ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                <span className={`w-3 h-3 rounded ${isBuyOB ? 'bg-[#26a69a]' : 'bg-[#ef5350]'} opacity-40`}></span>
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
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-[#f472b6]"></span> EMA20
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-[#22c55e]"></span> EMA200
            </span>
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
          const fvgFresh = ob.fvg_fresh || false;
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
          const borderWidth = isRetestActive ? '4px' : isAged ? '1px' : isVolumatic ? '4px' : isStrong ? '3px' : isWeak ? '1px' : '2px';
          const bgOpacity = isAged ? 0.1 : isWeak ? 0.15 : 0.35;
          const borderOpacity = isAged ? 0.3 : isWeak ? 0.4 : 0.9;
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
            bgColor = isBuyOB
              ? `rgba(38, 166, 154, ${bgOpacity + 0.1})`
              : `rgba(239, 83, 80, ${bgOpacity + 0.1})`;
          } else if (isVolumatic) {
            // Gold border for high volumatic score
            borderColor = 'rgba(255, 215, 0, 0.9)';
            bgColor = isBuyOB
              ? `rgba(38, 166, 154, ${bgOpacity})`
              : `rgba(239, 83, 80, ${bgOpacity})`;
          } else {
            bgColor = isBuyOB
              ? `rgba(38, 166, 154, ${bgOpacity})`
              : `rgba(239, 83, 80, ${bgOpacity})`;
            borderColor = isBuyOB
              ? `rgba(38, 166, 154, ${borderOpacity})`
              : `rgba(239, 83, 80, ${borderOpacity})`;
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
                  ? `0 0 ${glowIntensity} ${isBuyOB ? 'rgba(38, 166, 154, 0.7)' : 'rgba(239, 83, 80, 0.7)'}, 0 0 20px rgba(255, 215, 0, 0.4)`
                  : isAged
                  ? 'none'
                  : `0 0 ${glowIntensity} ${isBuyOB ? `rgba(38, 166, 154, ${isWeak ? 0.2 : 0.5})` : `rgba(239, 83, 80, ${isWeak ? 0.2 : 0.5})`}`,
                pointerEvents: 'none',
                opacity: isAged ? 0.5 : isWeak ? 0.6 : 1,
                animation: isRetestActive ? 'pulse 1.5s ease-in-out infinite' : undefined,
              }}
              title={`볼륨: ${volRatio.toFixed(1)}x 평균 (${volStrength === 'strong' ? '강함' : volStrength === 'weak' ? '약함' : '보통'}) | 나이: ${ageCandles}캔들 (${ageStatus === 'fresh' ? '신선' : ageStatus === 'mature' ? '성숙' : '노후'})${isRetestActive ? ` | 리테스트 활성: ${retestDirection === 'bull' ? '매수' : '매도'} 볼륨 ${retestVolConfirm.toFixed(1)}x` : ''}`}
            >
              {/* OB label with optional gold star for high confluence or volumatic */}
              <div className="absolute top-1 left-1 flex items-center gap-1">
                <div
                  className="px-1.5 py-0.5 text-xs font-black rounded"
                  style={{
                    backgroundColor: isAged ? 'rgba(128, 128, 128, 0.8)' : isBuyOB ? 'rgba(38, 166, 154, 1)' : 'rgba(239, 83, 80, 1)',
                    color: 'white',
                    textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                    opacity: isAged ? 0.7 : isWeak ? 0.6 : 1,
                  }}
                >
                  OB
                </div>
                {/* Volume strength badge */}
                <div
                  className="px-1 py-0.5 text-[9px] font-bold rounded"
                  style={{
                    backgroundColor: isAged ? 'rgba(128, 128, 128, 0.6)' : isStrong ? 'rgba(34, 197, 94, 0.9)' : isWeak ? 'rgba(156, 163, 175, 0.7)' : 'rgba(100, 100, 100, 0.7)',
                    color: 'white',
                  }}
                  title={`볼륨: ${volRatio.toFixed(1)}x 평균`}
                >
                  {volRatio.toFixed(1)}x
                </div>
                {/* Age status badge */}
                {ageStatus !== 'fresh' && (
                  <div
                    className="px-1 py-0.5 text-[9px] font-bold rounded"
                    style={{
                      backgroundColor: isAged ? 'rgba(239, 68, 68, 0.8)' : 'rgba(251, 191, 36, 0.8)',
                      color: 'white',
                    }}
                    title={`${ageCandles}캔들 경과`}
                  >
                    {isAged ? '노후' : '성숙'}
                  </div>
                )}
                {/* Volumatic score badge - gold for high score */}
                {volumaticScore > 0 && (
                  <div
                    className="px-1.5 py-0.5 text-xs font-bold rounded flex items-center gap-0.5"
                    style={{
                      backgroundColor: isVolumatic ? 'rgba(255, 215, 0, 0.95)' : 'rgba(100, 100, 100, 0.8)',
                      color: isVolumatic ? '#1a1a1a' : 'white',
                      textShadow: isVolumatic ? '0 1px 1px rgba(255,255,255,0.3)' : 'none',
                    }}
                    title={`Volumatic Score: ${volumaticScore}점${fvgFresh ? ' (Fresh FVG)' : ''}`}
                  >
                    {isVolumatic && <span>★</span>}
                    <span>V{volumaticScore}</span>
                  </div>
                )}
                {/* Gold star for high confluence (only if not already showing volumatic) */}
                {isHighConfluence && !isVolumatic && (
                  <div
                    className="px-1.5 py-0.5 text-xs font-bold rounded flex items-center gap-0.5"
                    style={{
                      backgroundColor: 'rgba(255, 215, 0, 0.9)',
                      color: '#1a1a1a',
                      textShadow: '0 1px 1px rgba(255,255,255,0.3)',
                    }}
                    title={`High Confluence: ${confluenceScore}점`}
                  >
                    <span>★</span>
                    <span>{confluenceScore}</span>
                  </div>
                )}
                {/* Normal score badge (50-79) - only if no volumatic or high confluence */}
                {!isHighConfluence && !isVolumatic && confluenceScore >= 50 && (
                  <div
                    className="px-1 py-0.5 text-[10px] font-medium rounded"
                    style={{
                      backgroundColor: 'rgba(100, 100, 100, 0.8)',
                      color: 'white',
                    }}
                    title={`Confluence Score: ${confluenceScore}점`}
                  >
                    {confluenceScore}
                  </div>
                )}
                {/* Retest signal badge - blinking with direction arrow */}
                {isRetestActive && (
                  <div
                    className="px-1.5 py-0.5 text-xs font-black rounded flex items-center gap-0.5 animate-pulse"
                    style={{
                      backgroundColor: retestDirection === 'bull' ? 'rgba(0, 255, 200, 0.95)' : 'rgba(255, 50, 150, 0.95)',
                      color: retestDirection === 'bull' ? '#003d33' : '#4d0026',
                      textShadow: '0 1px 2px rgba(255,255,255,0.3)',
                    }}
                    title={`리테스트 활성! ${retestDirection === 'bull' ? '매수' : '매도'} 신호 - 볼륨 ${retestVolConfirm.toFixed(1)}x 확인`}
                  >
                    <span className="text-sm">{retestDirection === 'bull' ? '▲' : '▼'}</span>
                    <span>RET</span>
                  </div>
                )}
                {/* Williams %R OB confluence bonus */}
                {analyzeData?.williams_r && analyzeData.williams_r.ob_bonus > 0 && (
                  <div
                    className="px-1 py-0.5 text-[9px] font-bold rounded flex items-center gap-0.5"
                    style={{
                      backgroundColor: analyzeData.williams_r.ob_bonus >= 15
                        ? 'rgba(236, 72, 153, 0.95)' // Pink for strong confluence
                        : 'rgba(168, 85, 247, 0.8)', // Purple for moderate
                      color: 'white',
                    }}
                    title={`Williams %R: ${analyzeData.williams_r.value.toFixed(1)} (${analyzeData.williams_r.zone}) | ${analyzeData.williams_r.summary}`}
                  >
                    <span>%R</span>
                    <span>+{analyzeData.williams_r.ob_bonus}</span>
                  </div>
                )}
              </div>
              {/* Price label */}
              <div
                className="absolute top-1 right-8 text-[10px] font-medium px-1 rounded"
                style={{
                  backgroundColor: isBuyOB ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)',
                  color: 'white',
                  opacity: isWeak ? 0.6 : 1,
                }}
              >
                {ob.zone_top.toLocaleString(undefined, { maximumFractionDigits: 0 })} - {ob.zone_bottom.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              {/* Right resize handle ONLY - drag to extend/shorten forward in time */}
              <div
                className="absolute -right-2 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center"
                style={{
                  pointerEvents: 'auto',
                  backgroundColor: isResizingOB ? (isBuyOB ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)') : 'transparent',
                }}
                onMouseDown={handleObResizeStart}
                title="좌우로 드래그하여 확장/축소"
              >
                <div
                  className="w-1 h-8 rounded"
                  style={{
                    backgroundColor: isBuyOB ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)',
                  }}
                />
              </div>
            </div>
          );
        })()}

        {/* FVG overlays - independent from OB, multiple FVGs supported */}
        {!compact && showOB && fvgBoxPositions.map((fvgPos, idx) => {
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
                backgroundColor: isBuyFVG ? 'rgba(38, 166, 154, 0.15)' : 'rgba(239, 83, 80, 0.15)',
                border: `1px dashed ${isBuyFVG ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)'}`,
                borderRadius: '2px',
                pointerEvents: 'none',
              }}
            >
              {/* FVG label */}
              <div
                className="absolute top-0 left-1 px-1 py-0.5 text-[9px] font-bold rounded"
                style={{
                  backgroundColor: isBuyFVG ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)',
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

        <div
          ref={chartContainerRef}
          className="w-full h-full"
          style={{ marginLeft: !compact && showDrawingTools ? 48 : 0 }}
        />
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

        // Check for reasonable height
        const height = Math.abs(bottomY - topY);
        if (height < 1 || height > chartHeight) {
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

        // Check for reasonable height (not a vertical line)
        const height = Math.abs(bottomY - topY);
        if (height < 1 || height > chartHeight) {
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

