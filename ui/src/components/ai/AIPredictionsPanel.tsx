/**
 * AI Predictions Panel - 3 AI systems with consensus analysis
 *
 * Features:
 * 1. AI Consensus with scenario grouping
 * 2. Technical ML - Short/mid-term trend prediction
 * 3. LSTM - Price prediction for next 5-10 days
 * 4. LH AI - Custom BB + OB + FVG analysis
 * 5. Trading levels export for chart overlay
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../../config/api';

// Types
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
    bb1_lower?: number;
    bb2_lower?: number;
  };
}

interface AIOpinion {
  name: string;
  icon: string;
  signal: string;
  reasoning: string;
  color: string;
}

interface AIConsensus {
  agreement: string;
  agreementLabel: string;
  majority: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  bullishScenario: AIOpinion[];
  bearishScenario: AIOpinion[];
  neutralScenario: AIOpinion[];
  conclusion: string;
  warnings: string[];
}

export interface TradingLevels {
  entry: number;
  stop: number;
  targets: number[];
  currentPrice: number;
}

interface AIPredictionsPanelProps {
  symbol: string;
  market: string;
  onTradingLevelsChange?: (levels: TradingLevels | null) => void;
}

export function AIPredictionsPanel({ symbol, market, onTradingLevelsChange }: AIPredictionsPanelProps) {
  // View mode: 'consensus' or 'detailed'
  const [viewMode, setViewMode] = useState<'consensus' | 'detailed'>('consensus');

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
        `${API_BASE_URL}/api/ai/technical_ml?symbol=${encodeURIComponent(symbol)}&market=${market}`
      );
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setTechnicalResult(data);
    } catch {
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
        `${API_BASE_URL}/api/ai/lstm_predict?symbol=${encodeURIComponent(symbol)}&market=${market}`
      );
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setLstmResult(data);
    } catch {
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
        `${API_BASE_URL}/api/ai/lh_analysis?symbol=${encodeURIComponent(symbol)}&market=${market}`
      );
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setLhResult(data);
    } catch {
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

  // Calculate AI Consensus
  const consensus = useMemo((): AIConsensus | null => {
    const bullish: AIOpinion[] = [];
    const bearish: AIOpinion[] = [];
    const neutral: AIOpinion[] = [];

    // Technical ML classification
    if (technicalResult && activeAI.technical) {
      const prob = technicalResult.short_term.up_prob;
      const indicators = technicalResult.indicators;
      let reasoning = [];
      if (indicators.rsi > 50) reasoning.push(`RSI ${indicators.rsi.toFixed(0)} 강세`);
      else if (indicators.rsi < 50) reasoning.push(`RSI ${indicators.rsi.toFixed(0)} 약세`);
      if (indicators.ema200_position === 'above') reasoning.push('EMA200 위');
      else reasoning.push('EMA200 아래');
      if (indicators.macd > 0) reasoning.push('MACD 양수');

      if (prob > 60) {
        bullish.push({
          name: '기술적 ML',
          icon: '📊',
          signal: `단기 상승 ${prob}%`,
          reasoning: reasoning.join(', '),
          color: '#3b82f6',
        });
      } else if (prob < 40) {
        bearish.push({
          name: '기술적 ML',
          icon: '📊',
          signal: `단기 하락 ${100 - prob}%`,
          reasoning: reasoning.join(', '),
          color: '#3b82f6',
        });
      } else {
        neutral.push({
          name: '기술적 ML',
          icon: '📊',
          signal: '중립',
          reasoning: '명확한 방향성 없음',
          color: '#3b82f6',
        });
      }
    }

    // LSTM classification
    if (lstmResult && activeAI.lstm) {
      const trend = lstmResult.trend;
      const target5d = lstmResult.predictions.find((p) => p.day === 5);
      const targetPrice = target5d?.price || lstmResult.predictions[lstmResult.predictions.length - 1]?.price;
      const pctChange = targetPrice
        ? (((targetPrice - lstmResult.current_price) / lstmResult.current_price) * 100).toFixed(1)
        : '0';

      if (trend === 'upward') {
        bullish.push({
          name: 'LSTM',
          icon: '📈',
          signal: `5일 후 ${pctChange}% 상승 예측`,
          reasoning: '상승 추세 패턴 감지',
          color: '#8b5cf6',
        });
      } else if (trend === 'downward') {
        bearish.push({
          name: 'LSTM',
          icon: '📈',
          signal: `5일 후 ${pctChange}% 하락 예측`,
          reasoning: '하락 추세 패턴 감지',
          color: '#8b5cf6',
        });
      } else {
        neutral.push({
          name: 'LSTM',
          icon: '📈',
          signal: '횡보 예상',
          reasoning: '명확한 추세 없음',
          color: '#8b5cf6',
        });
      }
    }

    // LH AI classification
    if (lhResult && activeAI.lh) {
      const scenario = lhResult.scenario.toLowerCase();
      const signals = lhResult.signals.slice(0, 2).join(', ');

      if (scenario.includes('매수') || scenario.includes('상승') || scenario.includes('강세') || scenario.includes('반등')) {
        bullish.push({
          name: 'LH AI',
          icon: '🤖',
          signal: lhResult.scenario,
          reasoning: signals,
          color: '#22c55e',
        });
      } else if (scenario.includes('매도') || scenario.includes('하락') || scenario.includes('조정') || scenario.includes('약세')) {
        bearish.push({
          name: 'LH AI',
          icon: '🤖',
          signal: lhResult.scenario,
          reasoning: signals,
          color: '#22c55e',
        });
      } else {
        neutral.push({
          name: 'LH AI',
          icon: '🤖',
          signal: lhResult.scenario,
          reasoning: signals,
          color: '#22c55e',
        });
      }
    }

    // Calculate consensus
    const total = bullish.length + bearish.length + neutral.length;
    if (total === 0) return null;

    const agreementCount = Math.max(bullish.length, bearish.length, neutral.length);
    const majority: 'bullish' | 'bearish' | 'neutral' =
      bullish.length >= bearish.length
        ? bullish.length >= neutral.length
          ? 'bullish'
          : 'neutral'
        : bearish.length >= neutral.length
        ? 'bearish'
        : 'neutral';

    // Calculate combined confidence
    let confidence = 50;
    if (technicalResult) confidence += (technicalResult.short_term.up_prob - 50) * 0.3;
    if (lstmResult) confidence += lstmResult.confidence * 0.3;
    if (lhResult) confidence += (lhResult.confidence - 50) * 0.4;
    confidence = Math.min(Math.max(confidence, 20), 90);

    // Generate conclusion and warnings
    let conclusion = '';
    const warnings: string[] = [];

    if (agreementCount === total && total >= 2) {
      if (majority === 'bullish') {
        conclusion = '강한 상승 컨센서스 - 적극적 진입 타이밍';
      } else if (majority === 'bearish') {
        conclusion = '강한 하락 컨센서스 - 진입 보류 또는 숏 포지션 고려';
      } else {
        conclusion = '모든 AI 중립 - 명확한 신호 대기 권장';
      }
    } else if (bullish.length === 2 && bearish.length === 1) {
      conclusion = '단기 조정 가능성 있으나 중기적 상승 예상. 조정 시 진입 기회 대기 권장.';
      warnings.push(`${bearish[0].name} 경고: ${bearish[0].signal}`);
    } else if (bearish.length === 2 && bullish.length === 1) {
      conclusion = '단기 반등 가능하나 중기적 하락 우려. 반등 시 청산 또는 숏 진입 고려.';
      warnings.push(`${bullish[0].name} 반대 의견: ${bullish[0].signal}`);
    } else if (neutral.length >= 2) {
      conclusion = 'AI 간 의견 불일치 또는 중립 - 명확한 방향성 나올 때까지 관망 권장.';
      warnings.push('리스크 높음 - 진입 보류');
    } else {
      conclusion = '혼조 신호 - 신중한 접근 필요.';
    }

    return {
      agreement: `${agreementCount}/${total}`,
      agreementLabel: agreementCount === total ? '강한 합의' : agreementCount >= total / 2 + 1 ? '부분 합의' : '의견 불일치',
      majority,
      confidence: Math.round(confidence),
      bullishScenario: bullish,
      bearishScenario: bearish,
      neutralScenario: neutral,
      conclusion,
      warnings,
    };
  }, [technicalResult, lstmResult, lhResult, activeAI]);

  // Export trading levels when LH result changes
  useEffect(() => {
    if (lhResult && activeAI.lh && onTradingLevelsChange) {
      const levels: TradingLevels = {
        entry: lhResult.key_levels.entry,
        stop: lhResult.key_levels.stop_loss,
        targets: [lhResult.key_levels.target1],
        currentPrice: lhResult.current_price,
      };
      // Add second target if available (1.5x first target distance)
      const t1Distance = lhResult.key_levels.target1 - lhResult.key_levels.entry;
      if (t1Distance > 0) {
        levels.targets.push(lhResult.key_levels.entry + t1Distance * 1.5);
      }
      onTradingLevelsChange(levels);
    } else if (onTradingLevelsChange) {
      onTradingLevelsChange(null);
    }
  }, [lhResult, activeAI.lh, onTradingLevelsChange]);

  // Helper functions
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'bg-[#26a69a]';
    if (confidence >= 50) return 'bg-[#f59e0b]';
    return 'bg-[#ef5350]';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 70) return '높음';
    if (confidence >= 50) return '중간';
    return '낮음';
  };

  const getMajorityColor = (majority: string) => {
    if (majority === 'bullish') return 'text-[#26a69a]';
    if (majority === 'bearish') return 'text-[#ef5350]';
    return 'text-[var(--text-secondary)]';
  };

  const isLoading = loading.technical || loading.lstm || loading.lh;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header with Toggle Buttons */}
      <div className="flex flex-col gap-2 p-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        {/* View Mode Toggle */}
        <div className="flex gap-1 bg-[var(--bg-tertiary)] rounded p-0.5">
          <button
            onClick={() => setViewMode('consensus')}
            className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-all ${
              viewMode === 'consensus'
                ? 'bg-[var(--accent-blue)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            🎯 합의도
          </button>
          <button
            onClick={() => setViewMode('detailed')}
            className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-all ${
              viewMode === 'detailed'
                ? 'bg-[var(--accent-blue)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            📋 상세보기
          </button>
        </div>

        {/* AI Toggles */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setActiveAI((prev) => ({ ...prev, technical: !prev.technical }))}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${
              activeAI.technical
                ? 'bg-[#3b82f6] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}
          >
            📊 ML
          </button>
          <button
            onClick={() => setActiveAI((prev) => ({ ...prev, lstm: !prev.lstm }))}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${
              activeAI.lstm
                ? 'bg-[#8b5cf6] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}
          >
            📈 LSTM
          </button>
          <button
            onClick={() => setActiveAI((prev) => ({ ...prev, lh: !prev.lh }))}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${
              activeAI.lh
                ? 'bg-[#22c55e] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}
          >
            🤖 LH
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading && (
          <div className="text-center text-[var(--text-secondary)] text-xs py-2">
            분석중...
          </div>
        )}

        {viewMode === 'consensus' && consensus && (
          <>
            {/* Consensus Header */}
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🎯</span>
                  <span className="font-bold">AI 합의도: {consensus.agreement}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                    {consensus.agreementLabel}
                  </span>
                </div>
              </div>

              {/* Combined Confidence */}
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-secondary)]">종합 신뢰도</span>
                  <span className={getMajorityColor(consensus.majority)}>
                    {getConfidenceLabel(consensus.confidence)} ({consensus.confidence}%)
                  </span>
                </div>
                <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getConfidenceColor(consensus.confidence)} transition-all`}
                    style={{ width: `${consensus.confidence}%` }}
                  />
                </div>
              </div>

              {/* Conclusion */}
              <div className="text-sm text-[var(--text-primary)] bg-[var(--bg-tertiary)] rounded p-2">
                💡 <span className="font-medium">{consensus.conclusion}</span>
              </div>

              {/* Warnings */}
              {consensus.warnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {consensus.warnings.map((warning, i) => (
                    <div key={i} className="text-xs text-[#f59e0b] flex items-start gap-1">
                      <span>⚠️</span>
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bullish Scenario */}
            {consensus.bullishScenario.length > 0 && (
              <div className="bg-[#26a69a]/10 border border-[#26a69a]/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">🟢</span>
                  <span className="text-sm font-bold text-[#26a69a]">
                    상승 시나리오 ({consensus.bullishScenario.length}개 AI)
                  </span>
                </div>
                <div className="space-y-2">
                  {consensus.bullishScenario.map((opinion, i) => (
                    <div key={i} className="pl-4 border-l-2 border-[#26a69a]/50">
                      <div className="flex items-center gap-1.5">
                        <span>{opinion.icon}</span>
                        <span className="text-xs font-medium" style={{ color: opinion.color }}>
                          {opinion.name}:
                        </span>
                        <span className="text-xs text-[#26a69a]">{opinion.signal}</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                        이유: {opinion.reasoning}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bearish Scenario */}
            {consensus.bearishScenario.length > 0 && (
              <div className="bg-[#ef5350]/10 border border-[#ef5350]/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">🔴</span>
                  <span className="text-sm font-bold text-[#ef5350]">
                    하락/조정 시나리오 ({consensus.bearishScenario.length}개 AI)
                  </span>
                </div>
                <div className="space-y-2">
                  {consensus.bearishScenario.map((opinion, i) => (
                    <div key={i} className="pl-4 border-l-2 border-[#ef5350]/50">
                      <div className="flex items-center gap-1.5">
                        <span>{opinion.icon}</span>
                        <span className="text-xs font-medium" style={{ color: opinion.color }}>
                          {opinion.name}:
                        </span>
                        <span className="text-xs text-[#ef5350]">{opinion.signal}</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                        이유: {opinion.reasoning}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Neutral Scenario */}
            {consensus.neutralScenario.length > 0 && (
              <div className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">⚪</span>
                  <span className="text-sm font-bold text-[var(--text-secondary)]">
                    중립 ({consensus.neutralScenario.length}개 AI)
                  </span>
                </div>
                <div className="space-y-2">
                  {consensus.neutralScenario.map((opinion, i) => (
                    <div key={i} className="pl-4 border-l-2 border-[var(--border-color)]">
                      <div className="flex items-center gap-1.5">
                        <span>{opinion.icon}</span>
                        <span className="text-xs font-medium" style={{ color: opinion.color }}>
                          {opinion.name}:
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">{opinion.signal}</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                        이유: {opinion.reasoning}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trading Levels from LH AI */}
            {lhResult && activeAI.lh && (
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">📍</span>
                  <span className="text-sm font-bold">트레이딩 레벨</span>
                </div>
                <div className="space-y-1.5">
                  {/* Current Price */}
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[var(--text-secondary)]">현재가</span>
                    <span className="font-mono font-bold">
                      {market === 'KR' ? '₩' : '$'}
                      {lhResult.current_price.toLocaleString()}
                    </span>
                  </div>

                  {/* Entry */}
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#10b981]">🟢 진입</span>
                    <span className="font-mono text-[#10b981]">
                      {market === 'KR' ? '₩' : '$'}
                      {lhResult.key_levels.entry.toLocaleString()}
                      <span className="text-[10px] ml-1 opacity-70">
                        ({(((lhResult.key_levels.entry - lhResult.current_price) / lhResult.current_price) * 100).toFixed(1)}%)
                      </span>
                    </span>
                  </div>

                  {/* Stop */}
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#ef4444]">🔴 손절</span>
                    <span className="font-mono text-[#ef4444]">
                      {market === 'KR' ? '₩' : '$'}
                      {lhResult.key_levels.stop_loss.toLocaleString()}
                      <span className="text-[10px] ml-1 opacity-70">
                        ({(((lhResult.key_levels.stop_loss - lhResult.current_price) / lhResult.current_price) * 100).toFixed(1)}%)
                      </span>
                    </span>
                  </div>

                  {/* Target */}
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#3b82f6]">🔵 목표</span>
                    <span className="font-mono text-[#3b82f6]">
                      {market === 'KR' ? '₩' : '$'}
                      {lhResult.key_levels.target1.toLocaleString()}
                      <span className="text-[10px] ml-1 opacity-70">
                        (+{(((lhResult.key_levels.target1 - lhResult.current_price) / lhResult.current_price) * 100).toFixed(1)}%)
                      </span>
                    </span>
                  </div>

                  {/* Risk:Reward */}
                  {(() => {
                    const risk = Math.abs(lhResult.key_levels.entry - lhResult.key_levels.stop_loss);
                    const reward = Math.abs(lhResult.key_levels.target1 - lhResult.key_levels.entry);
                    const rr = risk > 0 ? (reward / risk).toFixed(1) : '0';
                    const isGoodRR = parseFloat(rr) >= 2;
                    return (
                      <div className="flex justify-between items-center text-xs pt-1 border-t border-[var(--border-color)]">
                        <span className="text-[var(--text-secondary)]">Risk:Reward</span>
                        <span className={`font-mono font-bold ${isGoodRR ? 'text-[#26a69a]' : 'text-[#f59e0b]'}`}>
                          1:{rr} {isGoodRR ? '✅' : '⚠️'}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </>
        )}

        {viewMode === 'detailed' && (
          <>
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
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">
                        단기 ({technicalResult.short_term.period})
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          technicalResult.short_term.signal === 'bullish'
                            ? 'text-[#26a69a]'
                            : technicalResult.short_term.signal === 'bearish'
                            ? 'text-[#ef5350]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {technicalResult.short_term.signal === 'bullish'
                          ? '↗️'
                          : technicalResult.short_term.signal === 'bearish'
                          ? '↘️'
                          : '→'}{' '}
                        상승 {technicalResult.short_term.up_prob}%
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">
                        중기 ({technicalResult.mid_term.period})
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          technicalResult.mid_term.signal === 'bullish'
                            ? 'text-[#26a69a]'
                            : technicalResult.mid_term.signal === 'bearish'
                            ? 'text-[#ef5350]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {technicalResult.mid_term.signal === 'bullish'
                          ? '↗️'
                          : technicalResult.mid_term.signal === 'bearish'
                          ? '↘️'
                          : '→'}{' '}
                        상승 {technicalResult.mid_term.up_prob}%
                      </span>
                    </div>

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
                        {lstmResult.trend === 'upward'
                          ? '📈 상승'
                          : lstmResult.trend === 'downward'
                          ? '📉 하락'
                          : '➡️ 횡보'}
                      </span>
                    </div>

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

                    <div className="space-y-1 pt-1 border-t border-[var(--border-color)]">
                      {lstmResult.predictions.slice(0, 4).map((pred) => (
                        <div key={pred.day} className="flex justify-between text-xs">
                          <span className="text-[var(--text-secondary)]">{pred.day}일 후</span>
                          <span className="text-[var(--text-primary)]">
                            {market === 'KR' ? '₩' : '$'}
                            {pred.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
                    <p className="text-sm font-medium text-[var(--text-primary)]">{lhResult.scenario}</p>

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

                    <div className="space-y-0.5 pt-1 border-t border-[var(--border-color)]">
                      {lhResult.signals.slice(0, 5).map((signal, i) => (
                        <p key={i} className="text-[11px] text-[var(--text-secondary)]">
                          {signal}
                        </p>
                      ))}
                    </div>

                    <div className="flex gap-3 text-[10px] pt-1 border-t border-[var(--border-color)]">
                      <span className="text-[var(--text-secondary)]">
                        진입: <span className="text-[#10b981]">{market === 'KR' ? '₩' : '$'}{lhResult.key_levels.entry.toLocaleString()}</span>
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        손절: <span className="text-[#ef5350]">{market === 'KR' ? '₩' : '$'}{lhResult.key_levels.stop_loss.toLocaleString()}</span>
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        목표: <span className="text-[#3b82f6]">{market === 'KR' ? '₩' : '$'}{lhResult.key_levels.target1.toLocaleString()}</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-secondary)]">데이터 로딩중...</p>
                )}
              </div>
            )}
          </>
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
