/**
 * AI Prediction Statistics Panel
 *
 * Displays comprehensive trading performance metrics for AI predictions:
 * - Win Rate
 * - Average/Cumulative Returns
 * - Risk Metrics (Max Drawdown, Sharpe Ratio)
 * - Best/Worst Trades
 * - Overall Rating
 *
 * NOTE: This is DIFFERENT from Strategy Backtest
 * - Strategy Backtest: Tests user-defined trading rules
 * - AI Statistics: Analyzes AI prediction performance
 */

import { useState, useMemo, useEffect } from 'react';
import type { AIPrediction, AIType, AIPredictionLines } from '../../hooks/useAIPredictions';
import {
  calculateAIStatistics,
  getPerformanceRating,
  formatPercent,
  formatDate,
} from '../../utils/aiStatistics';

// Storage key (same as useAIPredictions)
const STORAGE_KEY = 'lh_ai_predictions';

interface AIStatisticsPanelProps {
  symbol: string;
  market?: string;
}

const AI_CONFIGS: Record<AIType, { color: string; name: string; nameKo: string }> = {
  technical: { color: '#9333ea', name: 'Technical ML', nameKo: '기술적 ML' },
  lstm: { color: '#f97316', name: 'LSTM', nameKo: 'LSTM' },
  lh: { color: '#dc2626', name: 'LH AI', nameKo: 'LH AI' },
  consensus: { color: '#eab308', name: 'Consensus', nameKo: '합의' },
};

export function AIStatisticsPanel({ symbol }: AIStatisticsPanelProps) {
  const [selectedAI, setSelectedAI] = useState<AIType>('lh');
  const [showDetails, setShowDetails] = useState(false);
  const [predictions, setPredictions] = useState<{
    technical: AIPrediction[];
    lstm: AIPrediction[];
    lh: AIPrediction[];
    consensus: AIPrediction[];
  }>({
    technical: [],
    lstm: [],
    lh: [],
    consensus: [],
  });

  // Load predictions from localStorage when symbol changes
  // Load predictions from localStorage
  const loadPredictions = () => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_${symbol}`);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AIPredictionLines>;
        setPredictions({
          technical: parsed.technical?.backtestPredictions || [],
          lstm: parsed.lstm?.backtestPredictions || [],
          lh: parsed.lh?.backtestPredictions || [],
          consensus: parsed.consensus?.backtestPredictions || [],
        });
      } else {
        setPredictions({
          technical: [],
          lstm: [],
          lh: [],
          consensus: [],
        });
      }
    } catch {
      setPredictions({
        technical: [],
        lstm: [],
        lh: [],
        consensus: [],
      });
    }
  };

  // Load on mount and symbol change
  useEffect(() => {
    loadPredictions();
  }, [symbol]);

  // Listen for storage changes (when predictions are updated in other components)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `${STORAGE_KEY}_${symbol}`) {
        loadPredictions();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Also poll periodically to catch same-tab updates
    const interval = setInterval(loadPredictions, 5000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [symbol]);

  // Calculate statistics for selected AI
  const stats = useMemo(() => {
    const preds = predictions[selectedAI] || [];
    return calculateAIStatistics(preds, selectedAI);
  }, [predictions, selectedAI]);

  // Get performance rating
  const rating = useMemo(() => getPerformanceRating(stats), [stats]);

  // Calculate stats for all AIs for comparison
  const allStats = useMemo(() => {
    return {
      technical: calculateAIStatistics(predictions.technical || [], 'technical'),
      lstm: calculateAIStatistics(predictions.lstm || [], 'lstm'),
      lh: calculateAIStatistics(predictions.lh || [], 'lh'),
      consensus: calculateAIStatistics(predictions.consensus || [], 'consensus'),
    };
  }, [predictions]);

  const hasData = stats.completedPredictions >= 2;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <span className="font-bold">AI 예측 통계</span>
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-1">
          AI 예측 성과 분석 (백테스트 기반)
        </div>
      </div>

      {/* AI Selector */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] flex gap-1 flex-wrap">
        {(Object.keys(AI_CONFIGS) as AIType[]).map((aiType) => {
          const config = AI_CONFIGS[aiType];
          const aiStats = allStats[aiType];
          const isSelected = selectedAI === aiType;

          return (
            <button
              key={aiType}
              onClick={() => setSelectedAI(aiType)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
                isSelected
                  ? 'text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              style={isSelected ? { backgroundColor: config.color } : {}}
            >
              <span>{config.nameKo}</span>
              {aiStats.completedPredictions >= 2 && (
                <span
                  className={`text-[10px] ${
                    isSelected ? 'text-white/80' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {aiStats.winRate.toFixed(0)}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Statistics Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!hasData ? (
          <div className="text-center py-8 text-[var(--text-secondary)]">
            <div className="text-3xl mb-2">📈</div>
            <div className="text-sm font-medium mb-1">데이터 부족</div>
            <div className="text-xs">
              AI 예측을 생성하면 통계가 표시됩니다.
              <br />
              차트에서 AI 버튼을 클릭하세요.
            </div>
          </div>
        ) : (
          <>
            {/* Prediction Count */}
            <div className="flex justify-between items-center text-sm pb-2 border-b border-[var(--border-color)]">
              <span className="text-[var(--text-secondary)]">분석된 예측</span>
              <span className="font-bold">{stats.completedPredictions}개</span>
            </div>

            {/* Win Rate - Large Display */}
            <WinRateCard winRate={stats.winRate} />

            {/* Returns Grid */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="평균 수익률"
                value={formatPercent(stats.averageReturn, true)}
                isPositive={stats.averageReturn > 0}
              />
              <StatCard
                label="총 누적 수익"
                value={formatPercent(stats.cumulativeReturn, true)}
                isPositive={stats.cumulativeReturn > 0}
              />
            </div>

            {/* Risk Metrics */}
            <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <span>📉</span>
                <span>리스크 지표</span>
              </div>
              <div className="space-y-2">
                <RiskMetric
                  label="최대 낙폭"
                  value={`-${stats.maxDrawdown.toFixed(1)}%`}
                  color="#ef4444"
                />
                <RiskMetric
                  label="샤프 비율"
                  value={stats.sharpeRatio.toFixed(2)}
                  color={
                    stats.sharpeRatio > 1.5
                      ? '#22c55e'
                      : stats.sharpeRatio > 1.0
                      ? '#eab308'
                      : '#9ca3af'
                  }
                  tooltip="1.0 이상이면 양호, 1.5 이상이면 우수"
                />
                <RiskMetric
                  label="최대 연속 손실"
                  value={`${stats.maxConsecutiveLosses}번`}
                  color="#f97316"
                />
                <RiskMetric
                  label="최대 연속 승리"
                  value={`${stats.maxConsecutiveWins}번`}
                  color="#22c55e"
                />
              </div>
            </div>

            {/* Best/Worst Trades */}
            <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <span>🏆</span>
                <span>최고/최악 거래</span>
              </div>
              <div className="space-y-2">
                {stats.bestTrade && (
                  <TradeCard trade={stats.bestTrade} type="best" />
                )}
                {stats.worstTrade && (
                  <TradeCard trade={stats.worstTrade} type="worst" />
                )}
              </div>
            </div>

            {/* Overall Rating */}
            <div
              className="rounded-lg p-3 border"
              style={{
                backgroundColor: `${rating.color}10`,
                borderColor: `${rating.color}40`,
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">종합 평가</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {'⭐'.repeat(rating.stars)}
                    {'☆'.repeat(5 - rating.stars)}
                  </span>
                  <span
                    className="text-sm font-bold"
                    style={{ color: rating.color }}
                  >
                    {rating.labelKo}
                  </span>
                </div>
              </div>
            </div>

            {/* Trade History Toggle */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-tertiary)] rounded-lg flex items-center justify-center gap-1 transition-colors"
            >
              <span>{showDetails ? '▲' : '▼'}</span>
              <span>거래 내역 {showDetails ? '숨기기' : '보기'}</span>
              <span className="text-[var(--text-secondary)]">
                ({stats.trades.length}건)
              </span>
            </button>

            {/* Trade History List */}
            {showDetails && (
              <TradeHistoryList trades={stats.trades} />
            )}
          </>
        )}
      </div>

      {/* Footer - Comparison Summary */}
      {hasData && (
        <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-tertiary)]">
          <div className="text-xs text-[var(--text-secondary)] mb-1">AI 비교</div>
          <div className="flex gap-1 justify-between">
            {(Object.keys(AI_CONFIGS) as AIType[]).map((aiType) => {
              const aiStats = allStats[aiType];
              const config = AI_CONFIGS[aiType];
              const hasAIData = aiStats.completedPredictions >= 2;

              return (
                <div
                  key={aiType}
                  className="flex-1 text-center py-1 rounded text-xs"
                  style={{
                    backgroundColor: selectedAI === aiType ? `${config.color}20` : 'transparent',
                  }}
                >
                  <div
                    className="font-medium text-[10px] mb-0.5"
                    style={{ color: config.color }}
                  >
                    {config.nameKo}
                  </div>
                  {hasAIData ? (
                    <div className={`font-bold ${aiStats.winRate >= 55 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      {aiStats.winRate.toFixed(0)}%
                    </div>
                  ) : (
                    <div className="text-[var(--text-secondary)]">-</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Win Rate Card Component
function WinRateCard({ winRate }: { winRate: number }) {
  const getWinRateColor = () => {
    if (winRate >= 70) return '#22c55e';
    if (winRate >= 55) return '#eab308';
    return '#ef4444';
  };

  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-[var(--text-secondary)]">승률</span>
        <span
          className="text-2xl font-bold"
          style={{ color: getWinRateColor() }}
        >
          {winRate.toFixed(1)}%
        </span>
      </div>
      <div className="w-full bg-[var(--bg-primary)] rounded-full h-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, winRate)}%`,
            backgroundColor: getWinRateColor(),
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-[var(--text-secondary)] mt-1">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({
  label,
  value,
  isPositive,
}: {
  label: string;
  value: string;
  isPositive: boolean;
}) {
  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
      <div className="text-xs text-[var(--text-secondary)] mb-1">{label}</div>
      <div
        className="text-lg font-bold"
        style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
      >
        {value}
      </div>
    </div>
  );
}

// Risk Metric Component
function RiskMetric({
  label,
  value,
  color,
  tooltip,
}: {
  label: string;
  value: string;
  color: string;
  tooltip?: string;
}) {
  return (
    <div className="flex justify-between items-center" title={tooltip}>
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="font-bold text-sm" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

// Trade Card Component
function TradeCard({
  trade,
  type,
}: {
  trade: { date: string; return: number; entryPrice: number; exitPrice: number };
  type: 'best' | 'worst';
}) {
  const isBest = type === 'best';
  const bgColor = isBest ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
  const borderColor = isBest ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';
  const textColor = isBest ? '#22c55e' : '#ef4444';

  return (
    <div
      className="rounded p-2 border"
      style={{ backgroundColor: bgColor, borderColor }}
    >
      <div className="flex justify-between items-center">
        <div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            {formatDate(trade.date)}
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            {trade.entryPrice.toLocaleString()} → {trade.exitPrice.toLocaleString()}
          </div>
        </div>
        <span className="font-bold text-sm" style={{ color: textColor }}>
          {trade.return > 0 ? '+' : ''}
          {trade.return.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

// Trade History List Component
function TradeHistoryList({
  trades,
}: {
  trades: Array<{
    date: string;
    return: number;
    entryPrice: number;
    exitPrice: number;
    isWin: boolean;
  }>;
}) {
  // Show most recent trades first
  const sortedTrades = [...trades].reverse();

  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 max-h-48 overflow-y-auto">
      <div className="space-y-1">
        {sortedTrades.map((trade, index) => (
          <div
            key={index}
            className="flex items-center justify-between px-2 py-1.5 rounded text-xs"
            style={{
              backgroundColor: trade.isWin
                ? 'rgba(34, 197, 94, 0.1)'
                : 'rgba(239, 68, 68, 0.1)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className={trade.isWin ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
                {trade.isWin ? '✓' : '✗'}
              </span>
              <span className="text-[var(--text-secondary)]">
                {formatDate(trade.date)}
              </span>
            </div>
            <span
              className="font-medium"
              style={{ color: trade.return > 0 ? '#22c55e' : '#ef4444' }}
            >
              {trade.return > 0 ? '+' : ''}
              {trade.return.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
