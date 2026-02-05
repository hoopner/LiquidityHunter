/**
 * ChartContainer - Thin wrapper that decides which chart to render based on timeframe
 *
 * Daily timeframes (1D, 1W, 1M) → DailyChart (full featured, stable)
 * Intraday timeframes (1m, 5m, 15m, 1h) → IntradayChart (clean implementation)
 */
import React from 'react';
import { DailyChart } from './DailyChart';
import IntradayChart from './IntradayChart';
import type { Timeframe } from './DailyChart';
import type { WatchlistItem } from '../../api/types';
import type { RealtimePrice } from '../../hooks/useRealtimePrice';
import type { TradingLevels } from '../ai/AIPredictionsPanel';
import type { IChartApi } from 'lightweight-charts';
import type { DrawingToolType } from '../../types/drawings';
import type { OHLCVResponse } from '../../api/types';
import { isIntradayTimeframe } from '../../utils/time';

interface ChartContainerProps {
  symbol?: string;
  market?: string;
  compact?: boolean;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  isSelected?: boolean;
  onDoubleClick?: () => void;
  showHeader?: boolean;
  showTimeScale?: boolean;
  onSymbolChange?: (symbol: string, market: string) => void;
  watchlistSymbols?: WatchlistItem[];
  onWatchlistChange?: () => void;
  onChartReady?: (chartRef: React.RefObject<IChartApi | null>) => void;
  onVisibleRangeChange?: (range: { from: number; to: number } | null) => void;
  onDataLoaded?: (data: OHLCVResponse | null) => void;
  onDrawingToolChange?: (tool: DrawingToolType | null, showTools: boolean) => void;
  onMainChartActivate?: () => void;
  isActiveForDrawing?: boolean;
  realtimePrice?: RealtimePrice | null;
  tradingLevels?: TradingLevels | null;
}

export const ChartContainer: React.FC<ChartContainerProps> = (props) => {
  const { timeframe } = props;
  const isIntraday = timeframe ? isIntradayTimeframe(timeframe) : false;

  console.log('[ChartContainer] Rendering', isIntraday ? 'IntradayChart' : 'DailyChart', 'for timeframe:', timeframe);

  if (isIntraday) {
    return <IntradayChart {...props} />;
  }

  return <DailyChart {...props} />;
};

// Also export as default for backward compatibility
export default ChartContainer;

// Re-export types that other components might need
export { TIMEFRAMES } from './DailyChart';
export type { Timeframe } from './DailyChart';
