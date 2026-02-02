/**
 * AI Predictions Hook - Manages prediction lines for chart overlay
 *
 * Features:
 * - Generate predictions from 3 AI systems + consensus
 * - BACKTEST: Show predictions on past data for immediate accuracy verification
 * - Track accuracy over time
 * - Store prediction history
 * - Toggle individual prediction lines
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { debounce } from '../utils/performance';
import { API_BASE_URL } from '../config/api';

// Types
export interface AIPrediction {
  timestamp: string;      // ISO date string for when prediction is for
  predictedPrice: number;
  actualPrice: number | null;
  confidence: number;
  isBacktest?: boolean;   // True if this is a backtest prediction (past data)
}

export interface PredictionSet {
  id: string;
  madeAt: string;          // ISO date string when prediction was made
  predictions: AIPrediction[];
}

export interface BacktestAccuracy {
  accuracy: number;        // 0-100
  samples: number;
  avgError: number;        // Average error %
  direction: {             // Direction prediction accuracy
    correct: number;
    total: number;
    percentage: number;
  };
}

export interface AccuracyStats {
  percentage: number;      // 0-100
  samples: number;
  avgError: number;        // Average error %
}

export interface AIPredictionLine {
  name: string;
  nameKo: string;
  color: string;
  width: number;
  enabled: boolean;
  predictionSets: PredictionSet[];
  accuracy: AccuracyStats | null;
  // NEW: Backtest data
  backtestPredictions: AIPrediction[];
  futurePredictions: AIPrediction[];
  backtestAccuracy: BacktestAccuracy | null;
}

export interface AIPredictionLines {
  technical: AIPredictionLine;
  lstm: AIPredictionLine;
  lh: AIPredictionLine;
  consensus: AIPredictionLine;
}

export type AIType = 'technical' | 'lstm' | 'lh' | 'consensus';

// OHLCV bar interface for backtesting
export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Initial state
const createInitialLines = (): AIPredictionLines => ({
  technical: {
    name: 'Technical ML',
    nameKo: '기술적 ML',
    color: '#9333ea',  // Purple
    width: 3,
    enabled: false,
    predictionSets: [],
    accuracy: null,
    backtestPredictions: [],
    futurePredictions: [],
    backtestAccuracy: null,
  },
  lstm: {
    name: 'LSTM',
    nameKo: 'LSTM',
    color: '#f97316',  // Orange
    width: 3,
    enabled: false,
    predictionSets: [],
    accuracy: null,
    backtestPredictions: [],
    futurePredictions: [],
    backtestAccuracy: null,
  },
  lh: {
    name: 'LH AI',
    nameKo: 'LH AI',
    color: '#dc2626',  // Crimson
    width: 3,
    enabled: false,
    predictionSets: [],
    accuracy: null,
    backtestPredictions: [],
    futurePredictions: [],
    backtestAccuracy: null,
  },
  consensus: {
    name: 'Consensus',
    nameKo: '합의 예측',
    color: '#eab308',  // Gold
    width: 3,
    enabled: false,
    predictionSets: [],
    accuracy: null,
    backtestPredictions: [],
    futurePredictions: [],
    backtestAccuracy: null,
  },
});

// Storage key
const STORAGE_KEY = 'lh_ai_predictions';

// Performance: Limit stored prediction sets to prevent memory bloat
const MAX_PREDICTION_SETS = 10;
const MAX_BACKTEST_PREDICTIONS = 100;

// Helper to add trading days (skip weekends)
function addTradingDays(date: Date, days: number): Date {
  const result = new Date(date);
  let addedDays = 0;

  while (addedDays < days) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }

  return result;
}

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Split data for backtesting (80% training, 20% backtest)
function splitDataForBacktest(bars: OHLCVBar[]) {
  const totalBars = bars.length;
  const trainEndIndex = Math.floor(totalBars * 0.8);

  return {
    trainingData: bars.slice(0, trainEndIndex),
    backtestData: bars.slice(trainEndIndex),
    currentData: bars,
  };
}

// Calculate EMA for a given period
function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  if (prices.length < period) return [];

  // Start with SMA for initial value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema[period - 1] = sum / period;

  // Calculate EMA for remaining values
  for (let i = period; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

// Calculate RSI
function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate changes
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  if (gains.length < period) return [];

  // Initial average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i + 1] = 100 - (100 / (1 + rs));
  }

  return rsi;
}

// Simulate Technical ML prediction for a given data window
function simulateTechnicalPrediction(
  dataWindow: OHLCVBar[],
  daysAhead: number = 1
): { price: number; confidence: number } {
  const closes = dataWindow.map(b => b.close);
  const lastPrice = closes[closes.length - 1];

  // Calculate indicators
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const rsi = calculateRSI(closes);

  const lastEma20 = ema20[ema20.length - 1] || lastPrice;
  const lastEma50 = ema50[ema50.length - 1] || lastPrice;
  const lastRsi = rsi[rsi.length - 1] || 50;

  // Simple prediction logic based on indicators
  let bullScore = 0;

  // EMA crossover signal
  if (lastEma20 > lastEma50) bullScore += 30;
  else bullScore -= 30;

  // Price vs EMA20
  if (lastPrice > lastEma20) bullScore += 20;
  else bullScore -= 20;

  // RSI signal
  if (lastRsi < 30) bullScore += 25; // Oversold = bullish
  else if (lastRsi > 70) bullScore -= 25; // Overbought = bearish
  else bullScore += (50 - lastRsi) * 0.5; // Neutral zone

  // Recent momentum (last 5 days)
  const recentChange = (lastPrice - closes[Math.max(0, closes.length - 6)]) / closes[Math.max(0, closes.length - 6)];
  bullScore += recentChange * 500; // Scale momentum

  // Normalize to 0-100
  const probability = Math.max(0, Math.min(100, 50 + bullScore));

  // Calculate predicted price
  const maxChange = 0.03; // Max 3% change per day
  const change = ((probability / 100) - 0.5) * 2 * maxChange * Math.sqrt(daysAhead);
  const predictedPrice = lastPrice * (1 + change);

  return {
    price: predictedPrice,
    confidence: Math.round(Math.abs(probability - 50) * 2),
  };
}

// Simulate LSTM prediction (simplified momentum-based)
function simulateLSTMPrediction(
  dataWindow: OHLCVBar[],
  daysAhead: number = 1
): { price: number; confidence: number } {
  const closes = dataWindow.map(b => b.close);
  const lastPrice = closes[closes.length - 1];

  // Calculate recent trends at different windows
  const trend5 = closes.length >= 6
    ? (lastPrice - closes[closes.length - 6]) / closes[closes.length - 6]
    : 0;
  const trend10 = closes.length >= 11
    ? (lastPrice - closes[closes.length - 11]) / closes[closes.length - 11]
    : 0;
  const trend20 = closes.length >= 21
    ? (lastPrice - closes[closes.length - 21]) / closes[closes.length - 21]
    : 0;

  // Weighted trend
  const weightedTrend = (trend5 * 0.5 + trend10 * 0.3 + trend20 * 0.2);

  // Volatility adjustment
  const recentCloses = closes.slice(-20);
  const avgPrice = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
  const variance = recentCloses.reduce((a, b) => a + Math.pow(b - avgPrice, 2), 0) / recentCloses.length;
  const volatility = Math.sqrt(variance) / avgPrice;

  // Predict with mean reversion tendency
  const meanReversionFactor = 0.3;
  const trendFactor = 1 - meanReversionFactor;

  const dailyChange = weightedTrend / 10; // Normalize to daily
  const predictedDailyChange = dailyChange * trendFactor * Math.pow(0.9, daysAhead); // Decay over time

  const predictedPrice = lastPrice * (1 + predictedDailyChange * daysAhead);

  // Confidence based on volatility (lower volatility = higher confidence)
  const confidence = Math.round(Math.max(20, Math.min(80, 70 - volatility * 500)));

  return {
    price: predictedPrice,
    confidence,
  };
}

// Simulate LH AI prediction (support/resistance based)
function simulateLHPrediction(
  dataWindow: OHLCVBar[],
  daysAhead: number = 1
): { price: number; confidence: number } {
  const closes = dataWindow.map(b => b.close);
  const highs = dataWindow.map(b => b.high);
  const lows = dataWindow.map(b => b.low);
  const lastPrice = closes[closes.length - 1];

  // Find recent high and low (last 20 bars)
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);

  // Calculate position in range
  const range = resistance - support;
  const positionInRange = range > 0 ? (lastPrice - support) / range : 0.5;

  // Predict based on position
  let targetPrice: number;

  if (positionInRange < 0.3) {
    // Near support - expect bounce
    targetPrice = support + range * 0.5;
  } else if (positionInRange > 0.7) {
    // Near resistance - expect pullback
    targetPrice = resistance - range * 0.3;
  } else {
    // Middle of range - follow trend
    const trend = closes.length >= 6
      ? (lastPrice - closes[closes.length - 6]) / closes[closes.length - 6]
      : 0;
    targetPrice = lastPrice * (1 + trend * 0.5);
  }

  // Gradual movement toward target
  const progress = Math.min(1, daysAhead / 10);
  const predictedPrice = lastPrice + (targetPrice - lastPrice) * progress * 0.6;

  // Confidence based on how clear the setup is
  const confidence = Math.round(
    Math.abs(positionInRange - 0.5) * 100 + 30
  );

  return {
    price: predictedPrice,
    confidence: Math.min(85, confidence),
  };
}

// Calculate backtest accuracy
function calculateBacktestAccuracy(predictions: AIPrediction[]): BacktestAccuracy | null {
  if (!predictions || predictions.length === 0) return null;

  let totalError = 0;
  let directionCorrect = 0;
  let prevActual: number | null = null;

  predictions.forEach((pred, i) => {
    if (pred.actualPrice !== null && pred.actualPrice > 0) {
      const error = Math.abs(pred.predictedPrice - pred.actualPrice) / pred.actualPrice * 100;
      totalError += error;

      // Check direction prediction
      if (i > 0 && prevActual !== null) {
        const actualDirection = pred.actualPrice > prevActual;
        const predictedDirection = pred.predictedPrice > prevActual;
        if (actualDirection === predictedDirection) directionCorrect++;
      }
      prevActual = pred.actualPrice;
    }
  });

  const validSamples = predictions.filter(p => p.actualPrice !== null && p.actualPrice > 0).length;
  if (validSamples === 0) return null;

  const avgError = totalError / validSamples;
  const accuracy = Math.max(0, 100 - avgError);
  const directionTotal = Math.max(1, validSamples - 1);

  return {
    accuracy: parseFloat(accuracy.toFixed(1)),
    samples: validSamples,
    avgError: parseFloat(avgError.toFixed(2)),
    direction: {
      correct: directionCorrect,
      total: directionTotal,
      percentage: parseFloat(((directionCorrect / directionTotal) * 100).toFixed(1)),
    },
  };
}

export function useAIPredictions(
  symbol: string,
  market: string,
  currentPrice: number | null,
  historicalData?: OHLCVBar[]  // NEW: Pass historical data for backtesting
) {
  const [lines, setLines] = useState<AIPredictionLines>(createInitialLines);
  const [loading, setLoading] = useState<Record<AIType, boolean>>({
    technical: false,
    lstm: false,
    lh: false,
    consensus: false,
  });

  // Refs for cleanup and preventing stale closures
  const mountedRef = useRef(true);
  const symbolRef = useRef(symbol);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Update refs on prop changes
  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancel any pending requests
      abortControllerRef.current?.abort();
    };
  }, []);

  // Load saved predictions from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_${symbol}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with initial state to ensure all fields exist
        setLines(prev => ({
          technical: {
            ...prev.technical,
            ...parsed.technical,
            predictionSets: parsed.technical?.predictionSets || [],
            backtestPredictions: parsed.technical?.backtestPredictions || [],
            futurePredictions: parsed.technical?.futurePredictions || [],
          },
          lstm: {
            ...prev.lstm,
            ...parsed.lstm,
            predictionSets: parsed.lstm?.predictionSets || [],
            backtestPredictions: parsed.lstm?.backtestPredictions || [],
            futurePredictions: parsed.lstm?.futurePredictions || [],
          },
          lh: {
            ...prev.lh,
            ...parsed.lh,
            predictionSets: parsed.lh?.predictionSets || [],
            backtestPredictions: parsed.lh?.backtestPredictions || [],
            futurePredictions: parsed.lh?.futurePredictions || [],
          },
          consensus: {
            ...prev.consensus,
            ...parsed.consensus,
            predictionSets: parsed.consensus?.predictionSets || [],
            backtestPredictions: parsed.consensus?.backtestPredictions || [],
            futurePredictions: parsed.consensus?.futurePredictions || [],
          },
        }));
      } else {
        setLines(createInitialLines());
      }
    } catch {
      setLines(createInitialLines());
    }
  }, [symbol]);

  // Performance: Debounced save to localStorage to prevent excessive writes
  const debouncedSaveRef = useRef(
    debounce((sym: string, data: AIPredictionLines) => {
      try {
        localStorage.setItem(`${STORAGE_KEY}_${sym}`, JSON.stringify(data));
      } catch {
        // Storage full or unavailable
      }
    }, 500)
  );

  // Save to localStorage when predictions change (debounced)
  useEffect(() => {
    debouncedSaveRef.current(symbol, lines);
  }, [lines, symbol]);

  // Cleanup debounced save on unmount
  useEffect(() => {
    return () => {
      debouncedSaveRef.current.cancel();
    };
  }, []);

  // Calculate accuracy for a prediction line
  const calculateAccuracy = useCallback((line: AIPredictionLine): AccuracyStats | null => {
    let totalPredictions = 0;
    let totalError = 0;

    line.predictionSets.forEach(predSet => {
      predSet.predictions.forEach(pred => {
        if (pred.actualPrice !== null && pred.actualPrice > 0) {
          const error = Math.abs(pred.predictedPrice - pred.actualPrice) / pred.actualPrice * 100;
          totalError += error;
          totalPredictions++;
        }
      });
    });

    if (totalPredictions === 0) return null;

    const avgError = totalError / totalPredictions;
    const accuracy = Math.max(0, 100 - avgError);

    return {
      percentage: parseFloat(accuracy.toFixed(1)),
      samples: totalPredictions,
      avgError: parseFloat(avgError.toFixed(2)),
    };
  }, []);

  // Toggle prediction line visibility
  const toggleLine = useCallback((aiType: AIType) => {
    setLines(prev => ({
      ...prev,
      [aiType]: {
        ...prev[aiType],
        enabled: !prev[aiType].enabled,
      },
    }));
  }, []);

  // Generate backtest predictions for a specific AI type
  // Performance: Limited to MAX_BACKTEST_PREDICTIONS to prevent memory bloat
  const generateBacktestPredictions = useCallback((
    aiType: AIType,
    trainingData: OHLCVBar[],
    backtestData: OHLCVBar[]
  ): AIPrediction[] => {
    const predictions: AIPrediction[] = [];

    // Performance: Limit backtest data to prevent excessive calculations
    const limitedBacktestData = backtestData.slice(-MAX_BACKTEST_PREDICTIONS);

    // For each day in backtest period, predict using only data up to that point
    const backtestStartIndex = backtestData.length - limitedBacktestData.length;
    limitedBacktestData.forEach((bar, index) => {
      // Data available "yesterday" (training + backtest up to this point)
      const actualIndex = backtestStartIndex + index;
      const dataUpToYesterday = [...trainingData, ...backtestData.slice(0, actualIndex)];

      if (dataUpToYesterday.length < 30) return; // Need minimum data

      let predicted: { price: number; confidence: number };

      switch (aiType) {
        case 'technical':
          predicted = simulateTechnicalPrediction(dataUpToYesterday, 1);
          break;
        case 'lstm':
          predicted = simulateLSTMPrediction(dataUpToYesterday, 1);
          break;
        case 'lh':
          predicted = simulateLHPrediction(dataUpToYesterday, 1);
          break;
        case 'consensus':
          // Average of all three
          const tech = simulateTechnicalPrediction(dataUpToYesterday, 1);
          const lstm = simulateLSTMPrediction(dataUpToYesterday, 1);
          const lh = simulateLHPrediction(dataUpToYesterday, 1);
          predicted = {
            price: (tech.price + lstm.price + lh.price) / 3,
            confidence: Math.round((tech.confidence + lstm.confidence + lh.confidence) / 3),
          };
          break;
      }

      predictions.push({
        timestamp: bar.time,
        predictedPrice: predicted.price,
        actualPrice: bar.close,
        confidence: predicted.confidence,
        isBacktest: true,
      });
    });

    return predictions;
  }, []);

  // Generate predictions (both backtest and future)
  const generatePredictions = useCallback(async (aiType: AIType) => {
    if (!currentPrice) return;

    setLoading(prev => ({ ...prev, [aiType]: true }));

    try {
      const now = new Date();
      const futurePredictions: AIPrediction[] = [];
      let backtestPredictions: AIPrediction[] = [];
      let backtestAccuracy: BacktestAccuracy | null = null;

      // Generate backtest predictions if historical data is available
      console.log(`[AI Backtest Init] ${aiType}:`, {
        hasHistoricalData: !!historicalData,
        historicalDataLength: historicalData?.length || 0,
      });

      if (historicalData && historicalData.length > 50) {
        const { trainingData, backtestData } = splitDataForBacktest(historicalData);

        console.log(`[AI Backtest Split] ${aiType}:`, {
          trainingSize: trainingData.length,
          backtestSize: backtestData.length,
          backtestFirstBar: backtestData[0],
          backtestLastBar: backtestData[backtestData.length - 1],
        });

        backtestPredictions = generateBacktestPredictions(aiType, trainingData, backtestData);
        backtestAccuracy = calculateBacktestAccuracy(backtestPredictions);

        console.log(`[AI Backtest Results] ${aiType}:`, {
          predictions: backtestPredictions.length,
          firstPrediction: backtestPredictions[0],
          lastPrediction: backtestPredictions[backtestPredictions.length - 1],
          accuracy: backtestAccuracy?.accuracy,
          directionAccuracy: backtestAccuracy?.direction?.percentage,
        });
      } else {
        console.warn(`[AI Backtest] ${aiType}: Skipped - insufficient historical data (${historicalData?.length || 0} bars)`);
      }

      // Generate future predictions
      if (aiType === 'technical') {
        // Fetch technical ML predictions from API
        const response = await fetch(
          `${API_BASE_URL}/api/ai/technical_ml?symbol=${encodeURIComponent(symbol)}&market=${market}`
        );
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();

        const shortTermProb = data.short_term.up_prob / 100;
        const midTermProb = data.mid_term.up_prob / 100;

        for (let i = 1; i <= 10; i++) {
          const futureDate = addTradingDays(now, i);
          const blendedProb = i <= 3 ? shortTermProb : (shortTermProb * 0.3 + midTermProb * 0.7);
          const maxChange = 0.03;
          const change = (blendedProb - 0.5) * 2 * maxChange;
          const predictedPrice = currentPrice * (1 + change * (i / 5));

          futurePredictions.push({
            timestamp: futureDate.toISOString(),
            predictedPrice,
            actualPrice: null,
            confidence: Math.round(Math.abs(blendedProb - 0.5) * 200),
            isBacktest: false,
          });
        }
      } else if (aiType === 'lstm') {
        const response = await fetch(
          `${API_BASE_URL}/api/ai/lstm_predict?symbol=${encodeURIComponent(symbol)}&market=${market}`
        );
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();

        data.predictions.forEach((pred: { day: number; price: number }) => {
          const futureDate = addTradingDays(now, pred.day);
          futurePredictions.push({
            timestamp: futureDate.toISOString(),
            predictedPrice: pred.price,
            actualPrice: null,
            confidence: data.confidence,
            isBacktest: false,
          });
        });

        // Fill in missing days
        const days = [1, 2, 3, 5, 7, 10];
        for (let i = 1; i <= 10; i++) {
          if (!days.includes(i)) {
            const futureDate = addTradingDays(now, i);
            const prevDay = days.filter(d => d < i).pop() || 1;
            const nextDay = days.find(d => d > i) || 10;
            const prevPred = futurePredictions.find(p => {
              const d = Math.round((new Date(p.timestamp).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              return d === prevDay || d === prevDay + 1 || d === prevDay + 2;
            });
            const nextPred = futurePredictions.find(p => {
              const d = Math.round((new Date(p.timestamp).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              return d === nextDay || d === nextDay + 1 || d === nextDay + 2;
            });

            if (prevPred && nextPred) {
              const ratio = (i - prevDay) / (nextDay - prevDay);
              futurePredictions.push({
                timestamp: futureDate.toISOString(),
                predictedPrice: prevPred.predictedPrice + (nextPred.predictedPrice - prevPred.predictedPrice) * ratio,
                actualPrice: null,
                confidence: data.confidence,
                isBacktest: false,
              });
            }
          }
        }
        futurePredictions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      } else if (aiType === 'lh') {
        const response = await fetch(
          `${API_BASE_URL}/api/ai/lh_analysis?symbol=${encodeURIComponent(symbol)}&market=${market}`
        );
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();

        const isBullish = data.scenario.includes('상승') || data.scenario.includes('매수') || data.scenario.includes('반등');
        const targetPrice = data.key_levels.target1;
        const entryPrice = data.key_levels.entry;

        for (let i = 1; i <= 10; i++) {
          const futureDate = addTradingDays(now, i);
          const progress = i / 10;
          let predictedPrice: number;

          if (isBullish) {
            predictedPrice = currentPrice + (targetPrice - currentPrice) * progress * 0.6;
          } else {
            predictedPrice = currentPrice - (currentPrice - entryPrice) * progress * 0.4;
          }

          futurePredictions.push({
            timestamp: futureDate.toISOString(),
            predictedPrice,
            actualPrice: null,
            confidence: data.confidence,
            isBacktest: false,
          });
        }
      } else if (aiType === 'consensus') {
        const techPreds = lines.technical.futurePredictions;
        const lstmPreds = lines.lstm.futurePredictions;
        const lhPreds = lines.lh.futurePredictions;

        if (techPreds.length === 0 || lstmPreds.length === 0 || lhPreds.length === 0) {
          console.log('[Consensus] Generate other predictions first');
          setLoading(prev => ({ ...prev, [aiType]: false }));
          return;
        }

        for (let i = 0; i < 10; i++) {
          const futureDate = addTradingDays(now, i + 1);
          const techPrice = techPreds[i]?.predictedPrice || currentPrice;
          const lstmPrice = lstmPreds[i]?.predictedPrice || currentPrice;
          const lhPrice = lhPreds[i]?.predictedPrice || currentPrice;

          futurePredictions.push({
            timestamp: futureDate.toISOString(),
            predictedPrice: (techPrice + lstmPrice + lhPrice) / 3,
            actualPrice: null,
            confidence: Math.round(
              ((techPreds[i]?.confidence || 50) +
               (lstmPreds[i]?.confidence || 50) +
               (lhPreds[i]?.confidence || 50)) / 3
            ),
            isBacktest: false,
          });
        }

        // Also combine backtest predictions for consensus
        if (lines.technical.backtestPredictions.length > 0) {
          const techBT = lines.technical.backtestPredictions;
          const lstmBT = lines.lstm.backtestPredictions;
          const lhBT = lines.lh.backtestPredictions;

          backtestPredictions = techBT.map((pred, i) => ({
            timestamp: pred.timestamp,
            predictedPrice: (
              pred.predictedPrice +
              (lstmBT[i]?.predictedPrice || pred.predictedPrice) +
              (lhBT[i]?.predictedPrice || pred.predictedPrice)
            ) / 3,
            actualPrice: pred.actualPrice,
            confidence: Math.round(
              (pred.confidence +
               (lstmBT[i]?.confidence || 50) +
               (lhBT[i]?.confidence || 50)) / 3
            ),
            isBacktest: true,
          }));
          backtestAccuracy = calculateBacktestAccuracy(backtestPredictions);
        }
      }

      // Create prediction set for historical tracking
      const newSet: PredictionSet = {
        id: generateId(),
        madeAt: now.toISOString(),
        predictions: futurePredictions,
      };

      // Update state (with safety check for component mount status)
      if (!mountedRef.current) return;

      setLines(prev => {
        // Performance: Limit stored prediction sets
        const updatedSets = [...prev[aiType].predictionSets, newSet].slice(-MAX_PREDICTION_SETS);

        return {
          ...prev,
          [aiType]: {
            ...prev[aiType],
            predictionSets: updatedSets,
            backtestPredictions,
            futurePredictions,
            backtestAccuracy,
            enabled: true,
          },
        };
      });
    } catch (error) {
      console.error(`[AI Predictions] Failed to generate ${aiType} predictions:`, error);
    } finally {
      if (mountedRef.current) {
        setLoading(prev => ({ ...prev, [aiType]: false }));
      }
    }
  }, [symbol, market, currentPrice, historicalData, lines.technical.futurePredictions, lines.lstm.futurePredictions, lines.lh.futurePredictions, lines.technical.backtestPredictions, lines.lstm.backtestPredictions, lines.lh.backtestPredictions, generateBacktestPredictions]);

  // Update actual prices for past predictions
  const updateActualPrices = useCallback((historicalPrices: { time: string; close: number }[]) => {
    const now = new Date();

    setLines(prev => {
      const updated = { ...prev };

      (Object.keys(updated) as AIType[]).forEach(aiType => {
        updated[aiType] = {
          ...updated[aiType],
          predictionSets: updated[aiType].predictionSets.map(predSet => ({
            ...predSet,
            predictions: predSet.predictions.map(pred => {
              if (pred.actualPrice !== null) return pred;

              const predDate = new Date(pred.timestamp);
              if (predDate > now) return pred;

              const matchingPrice = historicalPrices.find(hp => {
                const hpDate = new Date(hp.time);
                return hpDate.toDateString() === predDate.toDateString();
              });

              if (matchingPrice) {
                return { ...pred, actualPrice: matchingPrice.close };
              }

              return pred;
            }),
          })),
        };

        updated[aiType].accuracy = calculateAccuracy(updated[aiType]);
      });

      return updated;
    });
  }, [calculateAccuracy]);

  // Clear all predictions for a specific AI type
  const clearPredictions = useCallback((aiType: AIType) => {
    setLines(prev => ({
      ...prev,
      [aiType]: {
        ...prev[aiType],
        predictionSets: [],
        backtestPredictions: [],
        futurePredictions: [],
        accuracy: null,
        backtestAccuracy: null,
      },
    }));
  }, []);

  // Get latest prediction set for an AI type
  const getLatestPredictions = useCallback((aiType: AIType): AIPrediction[] => {
    const predSets = lines[aiType].predictionSets;
    if (predSets.length === 0) return [];
    return predSets[predSets.length - 1].predictions;
  }, [lines]);

  // Get backtest predictions
  const getBacktestPredictions = useCallback((aiType: AIType): AIPrediction[] => {
    return lines[aiType].backtestPredictions;
  }, [lines]);

  // Get future predictions
  const getFuturePredictions = useCallback((aiType: AIType): AIPrediction[] => {
    return lines[aiType].futurePredictions;
  }, [lines]);

  // Check if any predictions are enabled
  const hasEnabledPredictions = useMemo(() => {
    return Object.values(lines).some(line =>
      line.enabled && (line.backtestPredictions.length > 0 || line.futurePredictions.length > 0)
    );
  }, [lines]);

  return {
    lines,
    loading,
    toggleLine,
    generatePredictions,
    updateActualPrices,
    clearPredictions,
    getLatestPredictions,
    getBacktestPredictions,
    getFuturePredictions,
    hasEnabledPredictions,
  };
}
