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
import { fetchOHLCV, fetchAnalyze } from '../../api/client';
import type { OHLCVResponse, AnalyzeResponse } from '../../api/types';

interface MainChartProps {
  symbol?: string;
  market?: string;
}

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1D', '1W', '1M'] as const;
type Timeframe = typeof TIMEFRAMES[number];

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
export function MainChart({ symbol = '005930', market = 'KR' }: MainChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const [data, setData] = useState<OHLCVResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [noData, setNoData] = useState(false);

  // Order Block state
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  const [showOB, setShowOB] = useState(true);
  const [obBoxPosition, setObBoxPosition] = useState<BoxPosition>({ left: 0, right: 0, top: 0, bottom: 0, visible: false });
  const [fvgBoxPosition, setFvgBoxPosition] = useState<BoxPosition>({ left: 0, right: 0, top: 0, bottom: 0, visible: false });

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

  // Calculate box positions for OB and FVG
  const updateBoxPositions = useCallback(() => {
    if (!chartRef.current || !candlestickSeriesRef.current || !data || !analyzeData?.current_valid_ob) {
      setObBoxPosition(prev => ({ ...prev, visible: false }));
      setFvgBoxPosition(prev => ({ ...prev, visible: false }));
      return;
    }

    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;
    const ob = analyzeData.current_valid_ob;

    // Get time values for OB
    const obStartTime = data.bars[ob.index]?.time;
    const obEndTime = data.bars[data.bars.length - 1]?.time;

    if (!obStartTime || !obEndTime) {
      setObBoxPosition(prev => ({ ...prev, visible: false }));
      return;
    }

    // Convert coordinates
    const timeScale = chart.timeScale();
    const leftX = timeScale.timeToCoordinate(obStartTime as Time);
    const rightX = timeScale.timeToCoordinate(obEndTime as Time);
    const topY = series.priceToCoordinate(ob.zone_top);
    const bottomY = series.priceToCoordinate(ob.zone_bottom);

    if (leftX !== null && rightX !== null && topY !== null && bottomY !== null) {
      setObBoxPosition({
        left: Math.min(leftX, rightX),
        right: Math.max(leftX, rightX) + 20, // Extend a bit past last bar
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
  }, [data, analyzeData]);

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

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
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
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Chart header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-color)]">
        <span className="text-lg font-semibold">{symbol}</span>
        <span className="text-[var(--text-secondary)]">{market}</span>
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
        <button
          onClick={() => setShowOB(!showOB)}
          className={`ml-2 px-3 py-1 text-xs font-medium rounded transition-colors ${
            showOB
              ? 'bg-[var(--accent-blue)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          OB
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

      {/* Chart area */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)] z-10">
            <div className="text-[var(--text-secondary)]">Loading chart data...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)] z-10">
            <div className="text-[var(--accent-red)]">Error: {error}</div>
          </div>
        )}
        {noData && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)] z-10">
            <div className="text-center">
              <div className="text-[var(--text-secondary)] text-lg mb-2">
                해당 타임프레임 데이터 없음
              </div>
              <div className="text-[var(--text-secondary)] text-sm opacity-60">
                No data available for {timeframe} timeframe
              </div>
            </div>
          </div>
        )}

        {/* Order Block overlay */}
        {showOB && obBoxPosition.visible && ob && (
          <div
            className="absolute pointer-events-none z-[5]"
            style={{
              left: obBoxPosition.left,
              top: obBoxPosition.top,
              width: obBoxPosition.right - obBoxPosition.left,
              height: obBoxPosition.bottom - obBoxPosition.top,
              backgroundColor: isBullish ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)',
              border: `2px solid ${isBullish ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)'}`,
              borderRadius: '3px',
              boxShadow: `0 0 8px ${isBullish ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'}`,
            }}
          >
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
          </div>
        )}

        {/* FVG overlay */}
        {showOB && fvgBoxPosition.visible && ob?.has_fvg && (
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

        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
