/**
 * AI Prediction Statistics Calculator
 *
 * Calculates trading performance metrics for AI predictions:
 * - Win Rate
 * - Average Return per Trade
 * - Cumulative Return
 * - Max Drawdown
 * - Sharpe Ratio
 * - Max Consecutive Losses
 * - Best/Worst Trades
 */

import type { AIPrediction } from '../hooks/useAIPredictions';

export interface TradeResult {
  date: string;
  entryPrice: number;
  exitPrice: number;
  predictedPrice: number;
  return: number;  // Percentage return
  isWin: boolean;
}

export interface AIStatistics {
  aiType: 'technical' | 'lstm' | 'lh' | 'consensus';
  totalPredictions: number;
  completedPredictions: number;
  winRate: number;              // %
  averageReturn: number;        // % per trade
  cumulativeReturn: number;     // % total
  maxDrawdown: number;          // %
  sharpeRatio: number;
  maxConsecutiveLosses: number;
  maxConsecutiveWins: number;
  bestTrade: TradeResult | null;
  worstTrade: TradeResult | null;
  trades: TradeResult[];
}

/**
 * Calculate all statistics for a set of predictions
 */
export function calculateAIStatistics(
  predictions: AIPrediction[],
  aiType: 'technical' | 'lstm' | 'lh' | 'consensus'
): AIStatistics {
  // Filter to completed predictions only
  const completed = predictions.filter(p => p.actualPrice !== null && p.actualPrice > 0);

  if (completed.length < 2) {
    return createEmptyStats(aiType, predictions.length, completed.length);
  }

  // Calculate trades (need previous price as entry)
  const trades: TradeResult[] = [];

  for (let i = 1; i < completed.length; i++) {
    const pred = completed[i];
    const previousActual = completed[i - 1].actualPrice!;

    const predicted = pred.predictedPrice;
    const actual = pred.actualPrice!;
    const entry = previousActual;

    // Check if direction was correct
    const predictedUp = predicted > entry;
    const actualUp = actual > entry;
    const isWin = predictedUp === actualUp;

    // Calculate actual return
    const actualReturn = ((actual - entry) / entry) * 100;

    // If we traded based on prediction direction:
    // - If AI predicted up and price went up: we made the gain
    // - If AI predicted down and price went down: we made the gain (short)
    // - If AI was wrong: we lost
    const tradeReturn = isWin ? Math.abs(actualReturn) : -Math.abs(actualReturn);

    trades.push({
      date: pred.timestamp,
      entryPrice: entry,
      exitPrice: actual,
      predictedPrice: predicted,
      return: tradeReturn,
      isWin,
    });
  }

  // Calculate statistics
  const winRate = calculateWinRate(trades);
  const averageReturn = calculateAverageReturn(trades);
  const cumulativeReturn = calculateCumulativeReturn(trades);
  const maxDrawdown = calculateMaxDrawdown(trades);
  const sharpeRatio = calculateSharpeRatio(trades);
  const { maxLosses, maxWins } = calculateMaxConsecutive(trades);
  const { best, worst } = findBestWorstTrades(trades);

  return {
    aiType,
    totalPredictions: predictions.length,
    completedPredictions: completed.length,
    winRate,
    averageReturn,
    cumulativeReturn,
    maxDrawdown,
    sharpeRatio,
    maxConsecutiveLosses: maxLosses,
    maxConsecutiveWins: maxWins,
    bestTrade: best,
    worstTrade: worst,
    trades,
  };
}

function createEmptyStats(
  aiType: 'technical' | 'lstm' | 'lh' | 'consensus',
  total: number,
  completed: number
): AIStatistics {
  return {
    aiType,
    totalPredictions: total,
    completedPredictions: completed,
    winRate: 0,
    averageReturn: 0,
    cumulativeReturn: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    maxConsecutiveLosses: 0,
    maxConsecutiveWins: 0,
    bestTrade: null,
    worstTrade: null,
    trades: [],
  };
}

/**
 * Win Rate: Percentage of trades where direction was correct
 */
function calculateWinRate(trades: TradeResult[]): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter(t => t.isWin).length;
  return (wins / trades.length) * 100;
}

/**
 * Average Return per Trade
 */
function calculateAverageReturn(trades: TradeResult[]): number {
  if (trades.length === 0) return 0;
  const totalReturn = trades.reduce((sum, t) => sum + t.return, 0);
  return totalReturn / trades.length;
}

/**
 * Total Cumulative Return
 */
function calculateCumulativeReturn(trades: TradeResult[]): number {
  return trades.reduce((sum, t) => sum + t.return, 0);
}

/**
 * Maximum Drawdown: Largest peak-to-trough decline
 */
function calculateMaxDrawdown(trades: TradeResult[]): number {
  if (trades.length === 0) return 0;

  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;

  trades.forEach(trade => {
    cumulative += trade.return;

    if (cumulative > peak) {
      peak = cumulative;
    }

    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  });

  return maxDrawdown;
}

/**
 * Sharpe Ratio: Risk-adjusted return
 * Sharpe = (Average Return - Risk Free Rate) / Standard Deviation
 * Assuming risk-free rate = 0 for simplicity
 */
function calculateSharpeRatio(trades: TradeResult[]): number {
  if (trades.length < 2) return 0;

  const returns = trades.map(t => t.return);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize: assume daily returns, ~252 trading days
  // Sharpe = (avgReturn * sqrt(252)) / (stdDev * sqrt(252))
  // Simplified to: avgReturn / stdDev (same ratio)
  return avgReturn / stdDev;
}

/**
 * Max Consecutive Wins and Losses
 */
function calculateMaxConsecutive(trades: TradeResult[]): { maxLosses: number; maxWins: number } {
  let currentLossStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let maxWinStreak = 0;

  trades.forEach(trade => {
    if (trade.isWin) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    }
  });

  return { maxLosses: maxLossStreak, maxWins: maxWinStreak };
}

/**
 * Find best and worst trades
 */
function findBestWorstTrades(trades: TradeResult[]): {
  best: TradeResult | null;
  worst: TradeResult | null;
} {
  if (trades.length === 0) {
    return { best: null, worst: null };
  }

  const sorted = [...trades].sort((a, b) => b.return - a.return);

  return {
    best: sorted[0],
    worst: sorted[sorted.length - 1],
  };
}

/**
 * Get overall rating based on performance metrics
 */
export function getPerformanceRating(stats: AIStatistics): {
  stars: number;
  label: string;
  labelKo: string;
  color: string;
} {
  const { winRate, sharpeRatio, cumulativeReturn } = stats;

  // Rating logic based on multiple factors
  let score = 0;

  // Win rate contribution (0-40 points)
  if (winRate >= 70) score += 40;
  else if (winRate >= 65) score += 32;
  else if (winRate >= 60) score += 24;
  else if (winRate >= 55) score += 16;
  else if (winRate >= 50) score += 8;

  // Sharpe ratio contribution (0-30 points)
  if (sharpeRatio >= 2.0) score += 30;
  else if (sharpeRatio >= 1.5) score += 24;
  else if (sharpeRatio >= 1.0) score += 18;
  else if (sharpeRatio >= 0.5) score += 12;
  else if (sharpeRatio > 0) score += 6;

  // Cumulative return contribution (0-30 points)
  if (cumulativeReturn >= 50) score += 30;
  else if (cumulativeReturn >= 30) score += 24;
  else if (cumulativeReturn >= 15) score += 18;
  else if (cumulativeReturn >= 5) score += 12;
  else if (cumulativeReturn > 0) score += 6;

  // Convert score to stars and rating
  if (score >= 80) {
    return { stars: 5, label: 'Excellent', labelKo: '우수', color: '#22c55e' };
  } else if (score >= 60) {
    return { stars: 4, label: 'Good', labelKo: '양호', color: '#84cc16' };
  } else if (score >= 40) {
    return { stars: 3, label: 'Average', labelKo: '보통', color: '#eab308' };
  } else if (score >= 20) {
    return { stars: 2, label: 'Below Average', labelKo: '주의', color: '#f97316' };
  } else {
    return { stars: 1, label: 'Poor', labelKo: '위험', color: '#ef4444' };
  }
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number, showSign: boolean = false): string {
  const formatted = value.toFixed(2);
  if (showSign && value > 0) {
    return `+${formatted}%`;
  }
  return `${formatted}%`;
}

/**
 * Format date for display
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
