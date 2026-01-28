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
import { fetchOHLCV, fetchAnalyze, fetchVolumeProfile, addToWatchlist, removeFromWatchlist } from '../../api/client';
import type { OHLCVResponse, AnalyzeResponse, WatchlistItem, VolumeProfileResponse } from '../../api/types';

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
}: MainChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

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
  const [obBoxPosition, setObBoxPosition] = useState<BoxPosition>({ left: 0, right: 0, top: 0, bottom: 0, visible: false });
  const [fvgBoxPosition, setFvgBoxPosition] = useState<BoxPosition>({ left: 0, right: 0, top: 0, bottom: 0, visible: false });

  // OB adjustment state (user can resize horizontally - RIGHT SIDE ONLY)
  // rightOffset: pixels to extend (positive) or shorten (negative) the right edge
  const [obRightOffset, setObRightOffset] = useState(0);
  const [isResizingOB, setIsResizingOB] = useState(false);
  const resizeStartRef = useRef<{ x: number; value: number }>({ x: 0, value: 0 });

  // Volume Profile state
  const [volumeProfile, setVolumeProfile] = useState<VolumeProfileResponse | null>(null);
  const [showVP, setShowVP] = useState(false);
  const [vpLoading, setVpLoading] = useState(false);

  // Watchlist state
  const [isWatchlistLoading, setIsWatchlistLoading] = useState(false);
  const [watchlistAdded, setWatchlistAdded] = useState(false);
  const [watchlistRemoved, setWatchlistRemoved] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
          setData(response);
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
    fetchAnalyze(symbol, market, timeframe, barIndex)
      .then(setAnalyzeData)
      .catch(() => setAnalyzeData(null));
  }, [data, symbol, market, timeframe]);

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

  // Store OB base position (without user adjustment) - calculated from chart coordinates
  const obBaseRightRef = useRef<number>(0);

  // Calculate box positions for OB and FVG (does NOT depend on obRightOffset)
  const updateBoxPositions = useCallback(() => {
    if (!chartRef.current || !candlestickSeriesRef.current || !chartContainerRef.current || !data || !analyzeData?.current_valid_ob) {
      setObBoxPosition(prev => ({ ...prev, visible: false }));
      setFvgBoxPosition(prev => ({ ...prev, visible: false }));
      return;
    }

    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;
    const container = chartContainerRef.current;
    const ob = analyzeData.current_valid_ob;

    // Get time values for OB
    const obStartTime = data.bars[ob.index]?.time;

    if (!obStartTime) {
      setObBoxPosition(prev => ({ ...prev, visible: false }));
      return;
    }

    // Convert coordinates
    const timeScale = chart.timeScale();
    const leftX = timeScale.timeToCoordinate(obStartTime as Time);
    const topY = series.priceToCoordinate(ob.zone_top);
    const bottomY = series.priceToCoordinate(ob.zone_bottom);

    // Chart right edge (minus the price scale width ~60px)
    const chartRightEdge = container.clientWidth - 60;

    if (leftX !== null && topY !== null && bottomY !== null) {
      // Store base right position (chart right edge by default)
      obBaseRightRef.current = chartRightEdge;

      // Left edge is FIXED at the OB candle position
      const fixedLeft = leftX;
      // Right edge extends to chart edge by default, but can be adjusted
      // Minimum right = fixedLeft + 30px (at least some width)
      const adjustedRight = Math.max(fixedLeft + 30, chartRightEdge + obRightOffset);

      setObBoxPosition({
        left: fixedLeft,
        right: Math.min(adjustedRight, chartRightEdge + 100), // Max extend 100px beyond chart
        top: Math.min(topY, bottomY),
        bottom: Math.max(topY, bottomY),
        visible: true,
      });
    } else {
      setObBoxPosition(prev => ({ ...prev, visible: false }));
    }

    // FVG box
    if (ob.has_fvg && ob.fvg) {
      const fvg = ob.fvg;
      const fvgStartTime = data.bars[fvg.index]?.time;
      const fvgEndTime = data.bars[Math.min(fvg.index + 3, data.bars.length - 1)]?.time;

      if (fvgStartTime && fvgEndTime) {
        const fvgLeftX = timeScale.timeToCoordinate(fvgStartTime as Time);
        const fvgRightX = timeScale.timeToCoordinate(fvgEndTime as Time);
        const fvgTopY = series.priceToCoordinate(fvg.gap_high);
        const fvgBottomY = series.priceToCoordinate(fvg.gap_low);

        if (fvgLeftX !== null && fvgRightX !== null && fvgTopY !== null && fvgBottomY !== null) {
          setFvgBoxPosition({
            left: Math.min(fvgLeftX, fvgRightX),
            right: Math.max(fvgLeftX, fvgRightX),
            top: Math.min(fvgTopY, fvgBottomY),
            bottom: Math.max(fvgTopY, fvgBottomY),
            visible: true,
          });
        } else {
          setFvgBoxPosition(prev => ({ ...prev, visible: false }));
        }
      }
    } else {
      setFvgBoxPosition(prev => ({ ...prev, visible: false }));
    }
  }, [data, analyzeData]); // NOTE: obRightOffset is NOT a dependency - we handle it separately

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

  // Attach global mouse events for resize
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
    });

    chartRef.current = chart;

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

    // Create EMA20 line series
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      title: 'EMA20',
    });
    ema20SeriesRef.current = ema20Series;

    // Create EMA200 line series
    const ema200Series = chart.addSeries(LineSeries, {
      color: '#8b5cf6',
      lineWidth: 1,
      title: 'EMA200',
    });
    ema200SeriesRef.current = ema200Series;

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

    // Subscribe to visible range changes to update box positions
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateBoxPositions);

    // Ctrl + mouse wheel zoom with cursor as RIGHT anchor
    const handleCtrlWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // Only handle when Ctrl is held

      e.preventDefault();
      e.stopPropagation();

      const timeScale = chart.timeScale();
      const currentRange = timeScale.getVisibleLogicalRange();
      if (!currentRange) return;

      // Get cursor position relative to chart
      const rect = chartContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const cursorX = e.clientX - rect.left;

      // Convert cursor X to logical index (this is our right anchor point)
      const cursorLogical = timeScale.coordinateToLogical(cursorX);
      if (cursorLogical === null) return;

      // Calculate zoom direction and amount (flipped for intuitive behavior)
      // Scroll up (deltaY < 0) = zoom in = smaller width (candles spread out)
      // Scroll down (deltaY > 0) = zoom out = larger width (candles compress)
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

      // Current visible width
      const currentWidth = currentRange.to - currentRange.from;
      const newWidth = currentWidth * zoomFactor;

      // Clamp width (min 5 bars, max 500 bars)
      const clampedWidth = Math.max(5, Math.min(500, newWidth));

      // New range: cursor position is the RIGHT edge
      // So new range is from (cursor - width) to cursor
      const newFrom = cursorLogical - clampedWidth;
      const newTo = cursorLogical;

      timeScale.setVisibleLogicalRange({ from: newFrom, to: newTo });
    };

    // Add wheel listener to chart container
    const container = chartContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleCtrlWheel, { passive: false });
    }

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('wheel', handleCtrlWheel);
      }
      chart.remove();
    };
  }, [updateBoxPositions]);

  // Update chart data
  useEffect(() => {
    if (!data || !candlestickSeriesRef.current || !ema20SeriesRef.current || !ema200SeriesRef.current) {
      return;
    }

    // Convert bars to candlestick data
    const candlestickData: CandlestickData<Time>[] = data.bars.map((bar) => ({
      time: bar.time as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    // Convert EMA data to line data (skip zeros/NaN at the beginning)
    const ema20Data: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.ema20[i],
      }))
      .filter((d) => d.value > 0);

    const ema200Data: LineData<Time>[] = data.bars
      .map((bar, i) => ({
        time: bar.time as Time,
        value: data.ema200[i],
      }))
      .filter((d) => d.value > 0);

    candlestickSeriesRef.current.setData(candlestickData);
    ema20SeriesRef.current.setData(ema20Data);
    ema200SeriesRef.current.setData(ema200Data);

    // Fit content
    chartRef.current?.timeScale().fitContent();

    // Update box positions after data loads
    setTimeout(updateBoxPositions, 100);
  }, [data, updateBoxPositions]);

  // Update box positions when analyze data changes
  useEffect(() => {
    updateBoxPositions();
  }, [analyzeData, updateBoxPositions]);

  // Get current price info
  const lastBar = data?.bars[data.bars.length - 1];
  const prevBar = data?.bars[data.bars.length - 2];
  const priceChange = lastBar && prevBar ? lastBar.close - prevBar.close : 0;
  const priceChangePercent = prevBar ? (priceChange / prevBar.close) * 100 : 0;

  const ob = analyzeData?.current_valid_ob;
  const isBullish = ob?.direction === 'bullish';

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

          <div className="ml-auto flex items-center gap-4 text-xs text-[var(--text-secondary)]">
            {ob && showOB && (
              <span className={`flex items-center gap-1 ${isBullish ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                <span className={`w-3 h-3 rounded ${isBullish ? 'bg-[#26a69a]' : 'bg-[#ef5350]'} opacity-40`}></span>
                {isBullish ? 'Bullish' : 'Bearish'} OB
                {ob.has_fvg && ' + FVG'}
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-[#f59e0b]"></span> EMA20
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-[#8b5cf6]"></span> EMA200
            </span>
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
        {!compact && showOB && obBoxPosition.visible && ob && (
          <div
            className="absolute z-[5]"
            style={{
              left: obBoxPosition.left,
              top: obBoxPosition.top,
              width: obBoxPosition.right - obBoxPosition.left,
              height: obBoxPosition.bottom - obBoxPosition.top,
              backgroundColor: isBullish ? 'rgba(38, 166, 154, 0.35)' : 'rgba(239, 83, 80, 0.35)',
              border: `2px solid ${isBullish ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)'}`,
              borderRadius: '3px',
              boxShadow: `0 0 8px ${isBullish ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'}`,
              pointerEvents: 'none',
            }}
          >
            {/* OB label */}
            <div
              className="absolute top-1 left-1 px-1.5 py-0.5 text-xs font-black rounded"
              style={{
                backgroundColor: isBullish ? 'rgba(38, 166, 154, 1)' : 'rgba(239, 83, 80, 1)',
                color: 'white',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              OB
            </div>
            {/* Price label */}
            <div
              className="absolute top-1 right-8 text-[10px] font-medium px-1 rounded"
              style={{
                backgroundColor: isBullish ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)',
                color: 'white',
              }}
            >
              {ob.zone_top.toLocaleString(undefined, { maximumFractionDigits: 0 })} - {ob.zone_bottom.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            {/* Right resize handle ONLY - drag to extend/shorten forward in time */}
            <div
              className="absolute -right-2 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center"
              style={{
                pointerEvents: 'auto',
                backgroundColor: isResizingOB ? (isBullish ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)') : 'transparent',
              }}
              onMouseDown={handleObResizeStart}
              title="좌우로 드래그하여 확장/축소"
            >
              <div
                className="w-1 h-8 rounded"
                style={{
                  backgroundColor: isBullish ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)',
                }}
              />
            </div>
          </div>
        )}

        {/* FVG overlay - only in non-compact mode */}
        {!compact && showOB && fvgBoxPosition.visible && ob?.has_fvg && (
          <div
            className="absolute pointer-events-none z-[4]"
            style={{
              left: fvgBoxPosition.left,
              top: fvgBoxPosition.top,
              width: fvgBoxPosition.right - fvgBoxPosition.left,
              height: fvgBoxPosition.bottom - fvgBoxPosition.top,
              backgroundColor: isBullish ? 'rgba(38, 166, 154, 0.35)' : 'rgba(239, 83, 80, 0.35)',
              border: `2px dashed ${isBullish ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)'}`,
              borderRadius: '3px',
            }}
          >
            <div
              className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[11px] font-bold rounded"
              style={{
                backgroundColor: isBullish ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)',
                color: 'white',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              FVG
            </div>
          </div>
        )}

        {/* Volume Profile overlay - only in non-compact mode */}
        {!compact && showVP && volumeProfile && chartRef.current && candlestickSeriesRef.current && (
          <VolumeProfileOverlay
            volumeProfile={volumeProfile}
            chart={chartRef.current}
            series={candlestickSeriesRef.current}
          />
        )}

        <div ref={chartContainerRef} className="w-full h-full" />
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
