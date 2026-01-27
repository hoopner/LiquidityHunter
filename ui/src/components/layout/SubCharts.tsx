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

interface SubChartsProps {
  symbol?: string;
  market?: string;
  timeframe?: string;
}

/**
 * Sub-charts area for indicators (RSI, MACD, Volume)
 */
export function SubCharts({ symbol = '005930', market = 'KR', timeframe = '1D' }: SubChartsProps) {
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);

  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);

  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistogramSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [data, setData] = useState<OHLCVResponse | null>(null);

  // Fetch data
  useEffect(() => {
    fetchOHLCV(symbol, market, timeframe)
      .then(setData)
      .catch(() => setData(null));
  }, [symbol, market, timeframe]);

  // Chart options shared across all sub-charts
  const getChartOptions = () => ({
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
      visible: false,
    },
    crosshair: {
      mode: 1,
      vertLine: { color: '#758696', width: 1 as const, style: 3, labelVisible: false },
      horzLine: { color: '#758696', width: 1 as const, style: 3, labelBackgroundColor: '#2a2e39' },
    },
  });

  // Initialize RSI chart
  useEffect(() => {
    if (!rsiContainerRef.current) return;

    const chart = createChart(rsiContainerRef.current, getChartOptions());
    rsiChartRef.current = chart;

    // RSI line
    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#26a69a',
      lineWidth: 1,
      priceLineVisible: false,
    });
    rsiSeriesRef.current = rsiSeries;

    // Add overbought/oversold lines
    rsiSeries.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    rsiSeries.createPriceLine({ price: 30, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    rsiSeries.createPriceLine({ price: 50, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });

    const handleResize = () => {
      if (rsiContainerRef.current) {
        chart.applyOptions({
          width: rsiContainerRef.current.clientWidth,
          height: rsiContainerRef.current.clientHeight,
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

  // Initialize MACD chart
  useEffect(() => {
    if (!macdContainerRef.current) return;

    const chart = createChart(macdContainerRef.current, getChartOptions());
    macdChartRef.current = chart;

    // MACD histogram (must be added first to appear behind)
    const histogramSeries = chart.addSeries(HistogramSeries, {
      priceLineVisible: false,
    });
    macdHistogramSeriesRef.current = histogramSeries;

    // MACD line
    const macdLineSeries = chart.addSeries(LineSeries, {
      color: '#2962ff',
      lineWidth: 1,
      priceLineVisible: false,
    });
    macdLineSeriesRef.current = macdLineSeries;

    // Signal line
    const signalSeries = chart.addSeries(LineSeries, {
      color: '#ff6d00',
      lineWidth: 1,
      priceLineVisible: false,
    });
    macdSignalSeriesRef.current = signalSeries;

    const handleResize = () => {
      if (macdContainerRef.current) {
        chart.applyOptions({
          width: macdContainerRef.current.clientWidth,
          height: macdContainerRef.current.clientHeight,
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

  // Initialize Volume chart
  useEffect(() => {
    if (!volumeContainerRef.current) return;

    const chart = createChart(volumeContainerRef.current, {
      ...getChartOptions(),
      timeScale: {
        borderColor: '#2a2e39',
        visible: true,
        timeVisible: true,
        secondsVisible: false,
      },
    });
    volumeChartRef.current = chart;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceLineVisible: false,
      priceFormat: { type: 'volume' },
    });
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (volumeContainerRef.current) {
        chart.applyOptions({
          width: volumeContainerRef.current.clientWidth,
          height: volumeContainerRef.current.clientHeight,
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
    if (!data) return;

    // Update RSI
    if (rsiSeriesRef.current) {
      const rsiData: LineData<Time>[] = data.bars
        .map((bar, i) => ({
          time: bar.time as Time,
          value: data.rsi[i],
          color: data.rsi[i] >= 50 ? '#26a69a' : '#ef5350',
        }))
        .filter((d) => d.value > 0);
      rsiSeriesRef.current.setData(rsiData);
      rsiChartRef.current?.timeScale().fitContent();
    }

    // Update MACD
    if (macdLineSeriesRef.current && macdSignalSeriesRef.current && macdHistogramSeriesRef.current) {
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

      const histogramData: HistogramData<Time>[] = data.bars
        .map((bar, i) => ({
          time: bar.time as Time,
          value: data.macd_histogram[i],
          color: data.macd_histogram[i] >= 0 ? '#26a69a' : '#ef5350',
        }))
        .filter((d) => d.value !== 0);

      macdLineSeriesRef.current.setData(macdLineData);
      macdSignalSeriesRef.current.setData(signalData);
      macdHistogramSeriesRef.current.setData(histogramData);
      macdChartRef.current?.timeScale().fitContent();
    }

    // Update Volume
    if (volumeSeriesRef.current) {
      const volumeData: HistogramData<Time>[] = data.bars.map((bar) => ({
        time: bar.time as Time,
        value: bar.volume,
        color: bar.close >= bar.open ? '#26a69a80' : '#ef535080',
      }));
      volumeSeriesRef.current.setData(volumeData);
      volumeChartRef.current?.timeScale().fitContent();
    }

    // Sync time scales
    const charts = [rsiChartRef.current, macdChartRef.current, volumeChartRef.current].filter(Boolean) as IChartApi[];
    if (charts.length > 1) {
      const syncHandler = (sourceChart: IChartApi) => {
        const logicalRange = sourceChart.timeScale().getVisibleLogicalRange();
        if (logicalRange) {
          charts.forEach((chart) => {
            if (chart !== sourceChart) {
              chart.timeScale().setVisibleLogicalRange(logicalRange);
            }
          });
        }
      };

      charts.forEach((chart) => {
        chart.timeScale().subscribeVisibleLogicalRangeChange(() => syncHandler(chart));
      });
    }
  }, [data]);

  return (
    <div className="flex h-full border-t border-[var(--border-color)]">
      {/* RSI */}
      <div className="flex-1 border-r border-[var(--border-color)] flex flex-col">
        <div className="px-2 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-2">
          <span>RSI (14)</span>
          <span className="text-[#ef5350]">70</span>
          <span className="text-[#758696]">50</span>
          <span className="text-[#26a69a]">30</span>
        </div>
        <div ref={rsiContainerRef} className="flex-1" />
      </div>

      {/* MACD */}
      <div className="flex-1 border-r border-[var(--border-color)] flex flex-col">
        <div className="px-2 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-2">
          <span>MACD (12, 26, 9)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#2962ff]"></span>MACD</span>
          <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#ff6d00]"></span>Signal</span>
        </div>
        <div ref={macdContainerRef} className="flex-1" />
      </div>

      {/* Volume */}
      <div className="flex-1 flex flex-col">
        <div className="px-2 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
          Volume
        </div>
        <div ref={volumeContainerRef} className="flex-1" />
      </div>
    </div>
  );
}
