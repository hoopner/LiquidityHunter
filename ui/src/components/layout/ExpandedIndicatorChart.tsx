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
import type { IndicatorType } from './SubCharts';

interface ExpandedIndicatorChartProps {
  symbol: string;
  market: string;
  timeframe: string;
  indicator: IndicatorType | null;
  onCollapse: () => void;
}

/**
 * Expanded indicator chart panel - shows larger view of indicators
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
    let signalSeries: ISeriesApi<'Line'> | null = null;
    let macdLineSeries: ISeriesApi<'Line'> | null = null;
    let macdSignalSeries: ISeriesApi<'Line'> | null = null;
    let histogramSeries: ISeriesApi<'Histogram'> | null = null;

    // Stochastic indicators - Slow, Medium, Fast
    if (indicator === 'stoch_slow') {
      // %D line first (behind) - orange
      signalSeries = chart.addSeries(LineSeries, {
        color: '#f97316',
        lineWidth: 1,
        priceLineVisible: false,
      });
      // %K line - blue
      series = chart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        priceLineVisible: false,
      });
      // Reference lines
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 80, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매수' });
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 50, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 20, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매도' });
    } else if (indicator === 'stoch_med') {
      // %D line first (behind) - orange
      signalSeries = chart.addSeries(LineSeries, {
        color: '#f97316',
        lineWidth: 1,
        priceLineVisible: false,
      });
      // %K line - green
      series = chart.addSeries(LineSeries, {
        color: '#22c55e',
        lineWidth: 2,
        priceLineVisible: false,
      });
      // Reference lines
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 80, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매수' });
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 50, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 20, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매도' });
    } else if (indicator === 'stoch_fast') {
      // %D line first (behind) - orange
      signalSeries = chart.addSeries(LineSeries, {
        color: '#f97316',
        lineWidth: 1,
        priceLineVisible: false,
      });
      // %K line - cyan
      series = chart.addSeries(LineSeries, {
        color: '#06b6d4',
        lineWidth: 2,
        priceLineVisible: false,
      });
      // Reference lines
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 80, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매수' });
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 50, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      (series as ISeriesApi<'Line'>).createPriceLine({ price: 20, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '과매도' });
    } else if (indicator === 'rsi') {
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
      if (indicator === 'stoch_slow' && series) {
        const stochKData: LineData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.stoch_slow_k?.[i] ?? 50,
          }))
          .filter((d) => d.value !== 50 || data.stoch_slow_k.length > 20);
        (series as ISeriesApi<'Line'>).setData(stochKData);

        // %D line
        if (signalSeries && data.stoch_slow_d) {
          const stochDData: LineData<Time>[] = data.bars
            .map((bar, i) => ({
              time: bar.time as Time,
              value: data.stoch_slow_d[i] ?? 50,
            }))
            .filter((d) => d.value !== 50 || data.stoch_slow_d.length > 20);
          signalSeries.setData(stochDData);
        }
      } else if (indicator === 'stoch_med' && series) {
        const stochKData: LineData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.stoch_med_k?.[i] ?? 50,
          }))
          .filter((d) => d.value !== 50 || data.stoch_med_k.length > 20);
        (series as ISeriesApi<'Line'>).setData(stochKData);

        // %D line
        if (signalSeries && data.stoch_med_d) {
          const stochDData: LineData<Time>[] = data.bars
            .map((bar, i) => ({
              time: bar.time as Time,
              value: data.stoch_med_d[i] ?? 50,
            }))
            .filter((d) => d.value !== 50 || data.stoch_med_d.length > 20);
          signalSeries.setData(stochDData);
        }
      } else if (indicator === 'stoch_fast' && series) {
        const stochKData: LineData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.stoch_fast_k?.[i] ?? 50,
          }))
          .filter((d) => d.value !== 50 || data.stoch_fast_k.length > 20);
        (series as ISeriesApi<'Line'>).setData(stochKData);

        // %D line
        if (signalSeries && data.stoch_fast_d) {
          const stochDData: LineData<Time>[] = data.bars
            .map((bar, i) => ({
              time: bar.time as Time,
              value: data.stoch_fast_d[i] ?? 50,
            }))
            .filter((d) => d.value !== 50 || data.stoch_fast_d.length > 20);
          signalSeries.setData(stochDData);
        }
      } else if (indicator === 'rsi' && series) {
        const rsiData: LineData<Time>[] = data.bars
          .map((bar, i) => ({
            time: bar.time as Time,
            value: data.rsi[i],
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

  const indicatorLabels: Record<IndicatorType, string> = {
    stoch_slow: 'Stoch Slow (20,12,12)',
    stoch_med: 'Stoch Med (10,6,6)',
    stoch_fast: 'Stoch Fast (5,3,3)',
    rsi: 'RSI (14)',
    macd: 'MACD (12, 26, 9)',
    volume: 'Volume',
  };

  const indicatorColors: Record<IndicatorType, string> = {
    stoch_slow: '#3b82f6',
    stoch_med: '#22c55e',
    stoch_fast: '#06b6d4',
    rsi: '#26a69a',
    macd: '#2962ff',
    volume: '#a855f7',
  };

  return (
    <div className="flex flex-col border-t border-[var(--border-color)] bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
        <span className="text-sm font-medium" style={{ color: indicatorColors[indicator] }}>
          {indicatorLabels[indicator]}
        </span>
        {(indicator === 'stoch_slow' || indicator === 'stoch_med' || indicator === 'stoch_fast') && (
          <>
            <span className="text-xs flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: indicatorColors[indicator] }}></span>%K
            </span>
            <span className="text-xs flex items-center gap-1"><span className="w-3 h-0.5 bg-[#f97316]"></span>%D</span>
            <span className="text-xs text-[#ef5350]">80 과매수</span>
            <span className="text-xs text-[#26a69a]">20 과매도</span>
          </>
        )}
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
