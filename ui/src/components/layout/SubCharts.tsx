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

interface SubChartsProps {
  symbol?: string;
  market?: string;
  timeframe?: string;
}

type ExpandedChart = 'rsi' | 'macd' | 'volume' | null;

/**
 * Sub-charts area for indicators (RSI, MACD, Volume)
 * Click on any chart header to expand it, click again or "축소" to collapse
 */
export function SubCharts({ symbol = '005930', market = 'KR', timeframe = '1D' }: SubChartsProps) {
  const [expanded, setExpanded] = useState<ExpandedChart>(null);

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
  const getChartOptions = useCallback((showTimeScale: boolean = false) => ({
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
      visible: showTimeScale,
      timeVisible: true,
      secondsVisible: false,
    },
    crosshair: {
      mode: 1,
      vertLine: { color: '#758696', width: 1 as const, style: 3, labelVisible: showTimeScale },
      horzLine: { color: '#758696', width: 1 as const, style: 3, labelBackgroundColor: '#2a2e39' },
    },
  }), []);

  // Handle expand/collapse toggle
  const handleToggle = useCallback((chartType: ExpandedChart) => {
    setExpanded(prev => prev === chartType ? null : chartType);
  }, []);

  // Resize charts when expanded state changes
  useEffect(() => {
    const resizeCharts = () => {
      [
        { chart: rsiChartRef.current, container: rsiContainerRef.current },
        { chart: macdChartRef.current, container: macdContainerRef.current },
        { chart: volumeChartRef.current, container: volumeContainerRef.current },
      ].forEach(({ chart, container }) => {
        if (chart && container) {
          chart.applyOptions({
            width: container.clientWidth,
            height: container.clientHeight,
          });
          chart.timeScale().fitContent();
        }
      });
    };

    // Delay to allow CSS transitions
    const timer = setTimeout(resizeCharts, 50);
    return () => clearTimeout(timer);
  }, [expanded]);

  // Initialize RSI chart
  useEffect(() => {
    if (!rsiContainerRef.current) return;

    const chart = createChart(rsiContainerRef.current, getChartOptions(expanded === 'rsi'));
    rsiChartRef.current = chart;

    // RSI line
    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#26a69a',
      lineWidth: 1,
      priceLineVisible: false,
    });
    rsiSeriesRef.current = rsiSeries;

    // Add overbought/oversold lines
    rsiSeries.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
    rsiSeries.createPriceLine({ price: 30, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
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
  }, [getChartOptions, expanded]);

  // Initialize MACD chart
  useEffect(() => {
    if (!macdContainerRef.current) return;

    const chart = createChart(macdContainerRef.current, getChartOptions(expanded === 'macd'));
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

    // Zero line
    macdLineSeries.createPriceLine({ price: 0, color: '#758696', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });

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
  }, [getChartOptions, expanded]);

  // Initialize Volume chart
  useEffect(() => {
    if (!volumeContainerRef.current) return;

    const chart = createChart(volumeContainerRef.current, getChartOptions(true));
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
  }, [getChartOptions, expanded]);

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

  // Get current indicator values for display
  const currentRsi = data && data.rsi.length > 0 ? data.rsi[data.rsi.length - 1] : null;
  const currentMacd = data && data.macd_line.length > 0 ? data.macd_line[data.macd_line.length - 1] : null;

  // Render chart header with expand/collapse
  const renderHeader = (
    chartType: ExpandedChart,
    title: string,
    children?: React.ReactNode
  ) => {
    const isExpanded = expanded === chartType;
    return (
      <div
        onClick={() => handleToggle(chartType)}
        className={`px-2 py-1 text-xs bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors ${
          isExpanded ? 'bg-[var(--bg-tertiary)]' : ''
        }`}
      >
        <span className={`font-medium ${isExpanded ? 'text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}`}>
          {title}
        </span>
        {children}
        <span className="ml-auto text-[10px] text-[var(--text-secondary)]">
          {isExpanded ? '클릭하여 축소' : '클릭하여 확대'}
        </span>
        {isExpanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(null);
            }}
            className="px-1.5 py-0.5 text-[10px] bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
          >
            축소
          </button>
        )}
      </div>
    );
  };

  // Calculate heights based on expanded state
  const getChartClass = (chartType: ExpandedChart) => {
    if (expanded === null) {
      return 'flex-1'; // Equal height when nothing expanded
    }
    if (expanded === chartType) {
      return 'flex-[4]'; // Expanded chart takes 4x space
    }
    return 'flex-[0.5]'; // Collapsed charts take minimal space
  };

  return (
    <div className={`flex h-full border-t border-[var(--border-color)] ${expanded ? 'flex-col' : ''}`}>
      {/* RSI */}
      <div className={`${expanded ? getChartClass('rsi') : 'flex-1'} ${!expanded ? 'border-r border-[var(--border-color)]' : ''} flex flex-col min-h-0 transition-all duration-200`}>
        {renderHeader(
          'rsi',
          'RSI (14)',
          <>
            {currentRsi !== null && currentRsi > 0 && (
              <span className={currentRsi >= 70 ? 'text-[#ef5350]' : currentRsi <= 30 ? 'text-[#26a69a]' : 'text-[var(--text-primary)]'}>
                {currentRsi.toFixed(1)}
              </span>
            )}
            <span className="text-[#ef5350]">70</span>
            <span className="text-[#758696]">50</span>
            <span className="text-[#26a69a]">30</span>
          </>
        )}
        <div
          ref={rsiContainerRef}
          className={`flex-1 min-h-0 ${expanded !== null && expanded !== 'rsi' ? 'hidden' : ''}`}
        />
      </div>

      {/* MACD */}
      <div className={`${expanded ? getChartClass('macd') : 'flex-1'} ${!expanded ? 'border-r border-[var(--border-color)]' : ''} flex flex-col min-h-0 transition-all duration-200`}>
        {renderHeader(
          'macd',
          'MACD (12, 26, 9)',
          <>
            {currentMacd !== null && currentMacd !== 0 && (
              <span className={currentMacd >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                {currentMacd.toFixed(2)}
              </span>
            )}
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#2962ff]"></span>MACD</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#ff6d00]"></span>Signal</span>
          </>
        )}
        <div
          ref={macdContainerRef}
          className={`flex-1 min-h-0 ${expanded !== null && expanded !== 'macd' ? 'hidden' : ''}`}
        />
      </div>

      {/* Volume */}
      <div className={`${expanded ? getChartClass('volume') : 'flex-1'} flex flex-col min-h-0 transition-all duration-200`}>
        {renderHeader(
          'volume',
          'Volume',
          data && data.bars.length > 0 && (
            <span className="text-[var(--text-primary)]">
              {(data.bars[data.bars.length - 1].volume / 1000000).toFixed(2)}M
            </span>
          )
        )}
        <div
          ref={volumeContainerRef}
          className={`flex-1 min-h-0 ${expanded !== null && expanded !== 'volume' ? 'hidden' : ''}`}
        />
      </div>
    </div>
  );
}
