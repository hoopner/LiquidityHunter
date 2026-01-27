import { useEffect, useRef, useState } from 'react';
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
import type { ExpandedIndicator } from './SubCharts';

interface ExpandedIndicatorChartProps {
  symbol: string;
  market: string;
  timeframe: string;
  indicator: ExpandedIndicator;
  onCollapse: () => void;
}

/**
 * Expanded indicator chart panel - shows larger view of RSI/MACD/Volume
 */
export function ExpandedIndicatorChart({
  symbol,
  market,
  timeframe,
  indicator,
  onCollapse,
}: ExpandedIndicatorChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [data, setData] = useState<OHLCVResponse | null>(null);

  // Fetch data
  useEffect(() => {
    fetchOHLCV(symbol, market, timeframe)
      .then(setData)
      .catch(() => setData(null));
  }, [symbol, market, timeframe]);

  // Initialize and update chart
  useEffect(() => {
    if (!containerRef.current || !indicator) return;

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
      },
      timeScale: {
        borderColor: '#2a2e39',
        visible: true,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#758696', width: 1, style: 3, labelVisible: true },
        horzLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2a2e39' },
      },
    });
    chartRef.current = chart;

    // Add series based on indicator type
    let series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | null = null;
    let macdLineSeries: ISeriesApi<'Line'> | null = null;
    let macdSignalSeries: ISeriesApi<'Line'> | null = null;
    let histogramSeries: ISeriesApi<'Histogram'> | null = null;

    if (indicator === 'rsi') {
      series = chart.addSeries(LineSeries, {
        color: '#26a69a',
        lineWidth: 2,
        priceLineVisible: false,
      });
      // Add reference lines
      series.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매수' });
      series.createPriceLine({ price: 30, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매도' });
      series.createPriceLine({ price: 50, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    } else if (indicator === 'macd') {
      // Histogram first (behind)
      histogramSeries = chart.addSeries(HistogramSeries, {
        priceLineVisible: false,
      });
      // MACD line
      macdLineSeries = chart.addSeries(LineSeries, {
        color: '#2962ff',
        lineWidth: 2,
        priceLineVisible: false,
        title: 'MACD',
      });
      // Signal line
      macdSignalSeries = chart.addSeries(LineSeries, {
        color: '#ff6d00',
        lineWidth: 2,
        priceLineVisible: false,
        title: 'Signal',
      });
      // Zero line
      macdLineSeries.createPriceLine({ price: 0, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    } else if (indicator === 'volume') {
      series = chart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        priceFormat: { type: 'volume' },
      });
    }

    // Update with data
    if (data) {
      if (indicator === 'rsi' && series) {
        const rsiData: LineData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.rsi[i],
            color: data.rsi[i] >= 50 ? '#26a69a' : '#ef5350',
          }))
          .filter((d) => d.value > 0);
        (series as ISeriesApi<'Line'>).setData(rsiData);
      } else if (indicator === 'macd' && macdLineSeries && macdSignalSeries && histogramSeries) {
        const macdLineData: LineData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.macd_line[i],
          }))
          .filter((d) => d.value !== 0);

        const signalData: LineData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.macd_signal[i],
          }))
          .filter((d) => d.value !== 0);

        const histData: HistogramData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.macd_histogram[i],
            color: data.macd_histogram[i] >= 0 ? '#26a69a' : '#ef5350',
          }))
          .filter((d) => d.value !== 0);

        macdLineSeries.setData(macdLineData);
        macdSignalSeries.setData(signalData);
        histogramSeries.setData(histData);
      } else if (indicator === 'volume' && series) {
        const volumeData: HistogramData<Time>[] = data.bars.map((bar) => ({
          time: bar.time as Time,
          value: bar.volume,
          color: bar.close >= bar.open ? '#26a69a80' : '#ef535080',
        }));
        (series as ISeriesApi<'Histogram'>).setData(volumeData);
      }
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [indicator, data]);

  if (!indicator) return null;

  const indicatorLabels = {
    rsi: 'RSI (14)',
    macd: 'MACD (12, 26, 9)',
    volume: 'Volume',
  };

  return (
    <div className="flex flex-col border-t border-[var(--border-color)] bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
        <span className="text-sm font-medium text-[var(--accent-blue)]">
          {indicatorLabels[indicator]}
        </span>
        {indicator === 'rsi' && (
          <>
            <span className="text-xs text-[#ef5350]">70 과매수</span>
            <span className="text-xs text-[#26a69a]">30 과매도</span>
          </>
        )}
        {indicator === 'macd' && (
          <>
            <span className="text-xs flex items-center gap-1"><span className="w-3 h-0.5 bg-[#2962ff]"></span>MACD</span>
            <span className="text-xs flex items-center gap-1"><span className="w-3 h-0.5 bg-[#ff6d00]"></span>Signal</span>
            <span className="text-xs flex items-center gap-1"><span className="w-3 h-2 bg-[#26a69a] opacity-50"></span>Histogram</span>
          </>
        )}
        <button
          onClick={onCollapse}
          className="ml-auto px-2 py-0.5 text-xs bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
        >
          축소
        </button>
      </div>
      {/* Chart */}
      <div ref={containerRef} className="h-48" />
    </div>
  );
}
