/**
 * AI Predictions Panel - 3 AI systems with toggle controls
 *
 * 1. Technical ML - Short/mid-term trend prediction
 * 2. LSTM - Price prediction for next 5-10 days
 * 3. LH AI - Custom BB + OB + FVG analysis
 */

import { useState, useEffect, useCallback } from 'react';

interface TechnicalMLResult {
  symbol: string;
  short_term: {
    period: string;
    up_prob: number;
    down_prob: number;
    signal: 'bullish' | 'bearish' | 'neutral';
  };
  mid_term: {
    period: string;
    up_prob: number;
    down_prob: number;
    signal: 'bullish' | 'bearish' | 'neutral';
  };
  indicators: {
    rsi: number;
    macd: number;
    stoch_k: number;
    ema20_position: string;
    ema200_position: string;
  };
}

interface LSTMPrediction {
  day: number;
  price: number;
  upper: number;
  lower: number;
}

interface LSTMResult {
  symbol: string;
  current_price: number;
  predictions: LSTMPrediction[];
  trend: 'upward' | 'downward' | 'sideways';
  confidence: number;
  volatility: number;
}

interface LHAnalysisResult {
  symbol: string;
  current_price: number;
  scenario: string;
  confidence: number;
  signals: string[];
  custom_bb_status: {
    bb1: string;
    bb2: string;
    bb3: string;
    bb2_position_pct: number;
  };
  indicators: {
    rsi: number;
    ema200: number;
    ema200_trend: string;
  };
  key_levels: {
    entry: number;
    stop_loss: number;
    target1: number;
  };
}

interface AIPredictionsPanelProps {
  symbol: string;
  market: string;
}

export function AIPredictionsPanel({ symbol, market }: AIPredictionsPanelProps) {
  // Toggle states for each AI system
  const [activeAI, setActiveAI] = useState({
    technical: true,
    lstm: true,
    lh: true,
  });

  // Loading states
  const [loading, setLoading] = useState({
    technical: false,
    lstm: false,
    lh: false,
  });

  // Results
  const [technicalResult, setTechnicalResult] = useState<TechnicalMLResult | null>(null);
  const [lstmResult, setLstmResult] = useState<LSTMResult | null>(null);
  const [lhResult, setLhResult] = useState<LHAnalysisResult | null>(null);

  // Errors
  const [errors, setErrors] = useState({
    technical: null as string | null,
    lstm: null as string | null,
    lh: null as string | null,
  });

  // Fetch Technical ML
  const fetchTechnicalML = useCallback(async () => {
    if (!activeAI.technical) return;
    setLoading((prev) => ({ ...prev, technical: true }));
    setErrors((prev) => ({ ...prev, technical: null }));

    try {
      const response = await fetch(
        `http://localhost:8000/api/ai/technical_ml?symbol=${encodeURIComponent(symbol)}&market=${market}`
      );
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setTechnicalResult(data);
    } catch (err) {
      setErrors((prev) => ({ ...prev, technical: '분석 실패' }));
      setTechnicalResult(null);
    } finally {
      setLoading((prev) => ({ ...prev, technical: false }));
    }
  }, [symbol, market, activeAI.technical]);

  // Fetch LSTM Prediction
  const fetchLSTM = useCallback(async () => {
    if (!activeAI.lstm) return;
    setLoading((prev) => ({ ...prev, lstm: true }));
    setErrors((prev) => ({ ...prev, lstm: null }));

    try {
      const response = await fetch(
        `http://localhost:8000/api/ai/lstm_predict?symbol=${encodeURIComponent(symbol)}&market=${market}`
      );
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setLstmResult(data);
    } catch (err) {
      setErrors((prev) => ({ ...prev, lstm: '예측 실패' }));
      setLstmResult(null);
    } finally {
      setLoading((prev) => ({ ...prev, lstm: false }));
    }
  }, [symbol, market, activeAI.lstm]);

  // Fetch LH Analysis
  const fetchLHAnalysis = useCallback(async () => {
    if (!activeAI.lh) return;
    setLoading((prev) => ({ ...prev, lh: true }));
    setErrors((prev) => ({ ...prev, lh: null }));

    try {
      const response = await fetch(
        `http://localhost:8000/api/ai/lh_analysis?symbol=${encodeURIComponent(symbol)}&market=${market}`
      );
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setLhResult(data);
    } catch (err) {
      setErrors((prev) => ({ ...prev, lh: '분석 실패' }));
      setLhResult(null);
    } finally {
      setLoading((prev) => ({ ...prev, lh: false }));
    }
  }, [symbol, market, activeAI.lh]);

  // Fetch all on symbol change
  useEffect(() => {
    fetchTechnicalML();
    fetchLSTM();
    fetchLHAnalysis();
  }, [fetchTechnicalML, fetchLSTM, fetchLHAnalysis]);

  // Signal color helper
  const getSignalColor = (signal: string) => {
    if (signal === 'bullish' || signal.includes('상승') || signal.includes('🟢') || signal.includes('✅')) {
      return 'text-[#26a69a]';
    }
    if (signal === 'bearish' || signal.includes('하락') || signal.includes('🔴') || signal.includes('⚠️')) {
      return 'text-[#ef5350]';
    }
    return 'text-[var(--text-secondary)]';
  };

  // Confidence bar color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'bg-[#26a69a]';
    if (confidence >= 50) return 'bg-[#f59e0b]';
    return 'bg-[#ef5350]';
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Toggle Buttons */}
      <div className="flex gap-2 p-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <button
          onClick={() => setActiveAI((prev) => ({ ...prev, technical: !prev.technical }))}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
            activeAI.technical
              ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          📊 기술적 ML
        </button>

        <button
          onClick={() => setActiveAI((prev) => ({ ...prev, lstm: !prev.lstm }))}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
            activeAI.lstm
              ? 'bg-[#8b5cf6] text-white shadow-lg shadow-purple-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          📈 LSTM 예측
        </button>

        <button
          onClick={() => setActiveAI((prev) => ({ ...prev, lh: !prev.lh }))}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
            activeAI.lh
              ? 'bg-[#22c55e] text-white shadow-lg shadow-green-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          🤖 LH AI
        </button>
      </div>

      {/* Results Container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Technical ML Result */}
        {activeAI.technical && (
          <div className="bg-[#3b82f6]/10 border border-[#3b82f6]/30 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-[#3b82f6]">📊 기술적 지표 ML</h3>
              {loading.technical && (
                <span className="text-[10px] text-[var(--text-secondary)]">분석중...</span>
              )}
            </div>

            {errors.technical ? (
              <p className="text-xs text-[#ef5350]">{errors.technical}</p>
            ) : technicalResult ? (
              <div className="space-y-2">
                {/* Short Term */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-secondary)]">
                    단기 ({technicalResult.short_term.period})
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-bold ${
                        technicalResult.short_term.signal === 'bullish'
                          ? 'text-[#26a69a]'
                          : technicalResult.short_term.signal === 'bearish'
                          ? 'text-[#ef5350]'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {technicalResult.short_term.signal === 'bullish' ? '↗️' : technicalResult.short_term.signal === 'bearish' ? '↘️' : '→'}
                      {' '}상승 {technicalResult.short_term.up_prob}%
                    </span>
                  </div>
                </div>

                {/* Mid Term */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-secondary)]">
                    중기 ({technicalResult.mid_term.period})
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-bold ${
                        technicalResult.mid_term.signal === 'bullish'
                          ? 'text-[#26a69a]'
                          : technicalResult.mid_term.signal === 'bearish'
                          ? 'text-[#ef5350]'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {technicalResult.mid_term.signal === 'bullish' ? '↗️' : technicalResult.mid_term.signal === 'bearish' ? '↘️' : '→'}
                      {' '}상승 {technicalResult.mid_term.up_prob}%
                    </span>
                  </div>
                </div>

                {/* Indicators */}
                <div className="flex gap-2 text-[10px] text-[var(--text-secondary)] pt-1 border-t border-[var(--border-color)]">
                  <span>RSI: {technicalResult.indicators.rsi}</span>
                  <span>|</span>
                  <span>Stoch: {technicalResult.indicators.stoch_k}</span>
                  <span>|</span>
                  <span>EMA200: {technicalResult.indicators.ema200_position}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">데이터 로딩중...</p>
            )}
          </div>
        )}

        {/* LSTM Prediction Result */}
        {activeAI.lstm && (
          <div className="bg-[#8b5cf6]/10 border border-[#8b5cf6]/30 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-[#8b5cf6]">📈 LSTM 가격 예측</h3>
              {loading.lstm && (
                <span className="text-[10px] text-[var(--text-secondary)]">예측중...</span>
              )}
            </div>

            {errors.lstm ? (
              <p className="text-xs text-[#ef5350]">{errors.lstm}</p>
            ) : lstmResult ? (
              <div className="space-y-2">
                {/* Trend and Confidence */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-secondary)]">추세</span>
                  <span
                    className={`text-sm font-bold ${
                      lstmResult.trend === 'upward'
                        ? 'text-[#26a69a]'
                        : lstmResult.trend === 'downward'
                        ? 'text-[#ef5350]'
                        : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {lstmResult.trend === 'upward' ? '📈 상승' : lstmResult.trend === 'downward' ? '📉 하락' : '➡️ 횡보'}
                  </span>
                </div>

                {/* Confidence Bar */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-[var(--text-secondary)]">신뢰도</span>
                    <span className="text-[var(--text-primary)]">{lstmResult.confidence}%</span>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getConfidenceColor(lstmResult.confidence)} transition-all`}
                      style={{ width: `${lstmResult.confidence}%` }}
                    />
                  </div>
                </div>

                {/* Predictions */}
                <div className="space-y-1 pt-1 border-t border-[var(--border-color)]">
                  {lstmResult.predictions.slice(0, 4).map((pred) => (
                    <div key={pred.day} className="flex justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{pred.day}일 후</span>
                      <span className="text-[var(--text-primary)]">
                        ${pred.price.toFixed(2)}
                        <span className="text-[10px] text-[var(--text-secondary)] ml-1">
                          (±${((pred.upper - pred.lower) / 2).toFixed(2)})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">데이터 로딩중...</p>
            )}
          </div>
        )}

        {/* LH AI Analysis Result */}
        {activeAI.lh && (
          <div className="bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-[#22c55e]">🤖 LH AI 분석</h3>
              {loading.lh && (
                <span className="text-[10px] text-[var(--text-secondary)]">분석중...</span>
              )}
            </div>

            {errors.lh ? (
              <p className="text-xs text-[#ef5350]">{errors.lh}</p>
            ) : lhResult ? (
              <div className="space-y-2">
                {/* Scenario */}
                <p className={`text-sm font-medium ${getSignalColor(lhResult.scenario)}`}>
                  {lhResult.scenario}
                </p>

                {/* Confidence Bar */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-[var(--text-secondary)]">신뢰도</span>
                    <span className="text-[var(--text-primary)]">{lhResult.confidence}%</span>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getConfidenceColor(lhResult.confidence)} transition-all`}
                      style={{ width: `${lhResult.confidence}%` }}
                    />
                  </div>
                </div>

                {/* Signals */}
                <div className="space-y-0.5 pt-1 border-t border-[var(--border-color)]">
                  {lhResult.signals.slice(0, 5).map((signal, i) => (
                    <p key={i} className={`text-[11px] ${getSignalColor(signal)}`}>
                      {signal}
                    </p>
                  ))}
                </div>

                {/* Key Levels */}
                <div className="flex gap-3 text-[10px] pt-1 border-t border-[var(--border-color)]">
                  <span className="text-[var(--text-secondary)]">
                    진입: <span className="text-[var(--text-primary)]">${lhResult.key_levels.entry}</span>
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    손절: <span className="text-[#ef5350]">${lhResult.key_levels.stop_loss}</span>
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    목표: <span className="text-[#26a69a]">${lhResult.key_levels.target1}</span>
                  </span>
                </div>

                {/* BB Status */}
                <div className="flex gap-2 text-[10px] text-[var(--text-secondary)]">
                  <span>BB1: {lhResult.custom_bb_status.bb1}</span>
                  <span>|</span>
                  <span>BB2: {lhResult.custom_bb_status.bb2_position_pct}%</span>
                  <span>|</span>
                  <span>RSI: {lhResult.indicators.rsi}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">데이터 로딩중...</p>
            )}
          </div>
        )}

        {/* No AI selected message */}
        {!activeAI.technical && !activeAI.lstm && !activeAI.lh && (
          <div className="text-center text-[var(--text-secondary)] text-sm py-8">
            AI 분석을 보려면 위 버튼을 클릭하세요
          </div>
        )}
      </div>
    </div>
  );
}
