import { useEffect, useRef, useState } from 'react';
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
import { fetchOHLCV } from '../../api/client';
import type { OHLCVResponse } from '../../api/types';

interface MainChartProps {
  symbol?: string;
  market?: string;
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

  // Fetch data
  useEffect(() => {
    setLoading(true);
    setError(null);

    fetchOHLCV(symbol, market)
      .then((response) => {
        setData(response);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [symbol, market]);

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
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

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
  }, [data]);

  // Get current price info
  const lastBar = data?.bars[data.bars.length - 1];
  const prevBar = data?.bars[data.bars.length - 2];
  const priceChange = lastBar && prevBar ? lastBar.close - prevBar.close : 0;
  const priceChangePercent = prevBar ? (priceChange / prevBar.close) * 100 : 0;

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
        <div className="ml-auto flex items-center gap-4 text-xs text-[var(--text-secondary)]">
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
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
