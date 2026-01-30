import { useEffect, useState } from 'react';
import { fetchOHLCV, fetchAnalyze } from '../../api/client';
import type { OHLCVResponse, AnalyzeResponse } from '../../api/types';

interface WhyPanelProps {
  symbol: string;
  market: string;
  timeframe?: string;
}

interface AnalysisState {
  loading: boolean;
  error: string | null;
  ohlcv: OHLCVResponse | null;
  analyze: AnalyzeResponse | null;
}

/**
 * WHY panel - displays reasoning for trade decisions
 */
export function WhyPanel({ symbol, market, timeframe = '1D' }: WhyPanelProps) {
  const [state, setState] = useState<AnalysisState>({
    loading: true,
    error: null,
    ohlcv: null,
    analyze: null,
  });

  // Fetch analysis data when symbol/market/timeframe changes
  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        // Fetch OHLCV data first
        const ohlcvData = await fetchOHLCV(symbol, market, timeframe);

        if (cancelled) return;

        // Then fetch Order Block analysis
        const barIndex = ohlcvData.bars.length - 1;
        let analyzeData: AnalyzeResponse | null = null;

        if (barIndex >= 0) {
          try {
            analyzeData = await fetchAnalyze(symbol, market, timeframe, barIndex);
          } catch {
            // Analyze might fail, that's ok
          }
        }

        if (cancelled) return;

        setState({
          loading: false,
          error: null,
          ohlcv: ohlcvData,
          analyze: analyzeData,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load data',
          ohlcv: null,
          analyze: null,
        });
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [symbol, market, timeframe]);

  // Calculate EMA analysis
  const getEmaAnalysis = () => {
    if (!state.ohlcv || state.ohlcv.ema20.length === 0 || state.ohlcv.ema200.length === 0) {
      return { status: 'unknown', text: 'EMA 데이터 없음', color: 'text-[var(--text-secondary)]' };
    }

    const len = state.ohlcv.ema20.length;
    const ema20 = state.ohlcv.ema20[len - 1];
    const ema200 = state.ohlcv.ema200[len - 1];

    // Skip if EMAs are not yet calculated (initial period) or null
    if (ema20 === null || ema200 === null || ema20 === 0 || ema200 === 0) {
      return { status: 'unknown', text: 'EMA 계산 중', color: 'text-[var(--text-secondary)]' };
    }

    const gap = ema20 - ema200;
    const gapPercent = (gap / ema200) * 100;

    // Check trend over last 5 days
    const lookback = Math.min(5, len);
    let approaching = false;
    let daysToClose = null;

    if (lookback >= 2) {
      const prevEma20 = state.ohlcv.ema20[len - lookback];
      const prevEma200 = state.ohlcv.ema200[len - lookback];
      if (prevEma20 !== null && prevEma200 !== null) {
        const prevGap = prevEma20 - prevEma200;
        const gapChange = Math.abs(gap) - Math.abs(prevGap);

        // If gap is closing
        if (gapChange < 0 && Math.abs(gap) < Math.abs(prevGap)) {
          approaching = true;
          const dailyChange = (Math.abs(prevGap) - Math.abs(gap)) / lookback;
          if (dailyChange > 0) {
            daysToClose = Math.ceil(Math.abs(gap) / dailyChange);
          }
        }
      }
    }

    if (ema20 > ema200) {
      if (approaching && gapPercent < 2) {
        return {
          status: 'bullish-converging',
          text: `EMA20이 EMA200 위 (갭 ${gapPercent.toFixed(1)}%, 수렴 중)`,
          color: 'text-[var(--accent-green)]'
        };
      }
      return {
        status: 'bullish',
        text: `EMA20이 EMA200 위에 있음 (갭 ${gapPercent.toFixed(1)}%)`,
        color: 'text-[var(--accent-green)]'
      };
    } else {
      if (approaching && daysToClose && daysToClose <= 20) {
        return {
          status: 'approaching',
          text: `EMA20이 EMA200에 접근 중 (약 ${daysToClose}일 후 예상 크로스)`,
          color: 'text-yellow-400'
        };
      }
      return {
        status: 'bearish',
        text: `EMA20이 EMA200 아래에 있음 (갭 ${Math.abs(gapPercent).toFixed(1)}%)`,
        color: 'text-[var(--accent-red)]'
      };
    }
  };

  // Format price for display
  const formatPrice = (price: number) => {
    if (market === 'KR') {
      return price.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
    }
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Get Order Block analysis
  const getObAnalysis = () => {
    if (!state.analyze || !state.analyze.current_valid_ob) {
      return { text: 'OB 없음', color: 'text-[var(--text-secondary)]' };
    }

    const ob = state.analyze.current_valid_ob;
    const direction = ob.direction === 'bullish' ? 'Bullish' : 'Bearish';
    const color = ob.direction === 'bullish' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';

    return {
      text: `${direction} OB @ ${formatPrice(ob.zone_bottom)} - ${formatPrice(ob.zone_top)}`,
      color
    };
  };

  // Get FVG analysis
  const getFvgAnalysis = () => {
    if (!state.analyze?.current_valid_ob?.has_fvg || !state.analyze.current_valid_ob.fvg) {
      return { text: 'FVG 없음', color: 'text-[var(--text-secondary)]' };
    }

    const fvg = state.analyze.current_valid_ob.fvg;
    const direction = fvg.direction === 'bullish' ? 'Bullish' : 'Bearish';
    const color = fvg.direction === 'bullish' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';

    return {
      text: `${direction} FVG @ ${formatPrice(fvg.gap_low)} - ${formatPrice(fvg.gap_high)}`,
      color
    };
  };

  // Get BOS (Break of Structure) - based on displacement
  const getBosAnalysis = () => {
    if (!state.analyze?.current_valid_ob || !state.analyze.validation_details.has_displacement) {
      return { text: 'BOS 없음', color: 'text-[var(--text-secondary)]' };
    }

    const ob = state.analyze.current_valid_ob;
    const direction = ob.direction === 'bullish' ? '상승' : '하락';
    const color = ob.direction === 'bullish' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';

    return {
      text: `${direction} BOS (구조 돌파)`,
      color
    };
  };

  // Get Volume Strength analysis
  const getVolumeAnalysis = () => {
    if (!state.analyze?.current_valid_ob) {
      return { text: '볼륨 분석 없음', color: 'text-[var(--text-secondary)]' };
    }

    const ob = state.analyze.current_valid_ob;
    const volStrength = ob.volume_strength || 'normal';
    const volRatio = ob.volume_ratio || 1.0;

    const strengthKr = volStrength === 'strong' ? '강함' : volStrength === 'weak' ? '약함' : '보통';

    if (volStrength === 'strong') {
      return {
        text: `OB 강도: ${strengthKr} (${volRatio.toFixed(1)}x)`,
        color: 'text-green-400'
      };
    } else if (volStrength === 'weak') {
      return {
        text: `OB 강도: ${strengthKr} (${volRatio.toFixed(1)}x)`,
        color: 'text-gray-400'
      };
    } else {
      return {
        text: `OB 강도: ${strengthKr} (${volRatio.toFixed(1)}x)`,
        color: 'text-[var(--text-secondary)]'
      };
    }
  };

  // Get Confluence analysis
  const getConfluenceAnalysis = () => {
    if (!state.analyze?.confluence) {
      return { text: '합류점 없음', color: 'text-[var(--text-secondary)]', score: 0 };
    }

    const conf = state.analyze.confluence;
    const score = conf.score;

    if (score >= 80) {
      return {
        text: `★ 고확률 합류점 ${score}점`,
        color: 'text-yellow-400',
        score
      };
    } else if (score >= 50) {
      return {
        text: `합류점 ${score}점`,
        color: 'text-[var(--accent-blue)]',
        score
      };
    } else {
      return {
        text: `약한 신호 ${score}점`,
        color: 'text-[var(--text-secondary)]',
        score
      };
    }
  };

  const emaAnalysis = getEmaAnalysis();
  const obAnalysis = getObAnalysis();
  const fvgAnalysis = getFvgAnalysis();
  const bosAnalysis = getBosAnalysis();
  const volumeAnalysis = getVolumeAnalysis();
  const confluenceAnalysis = getConfluenceAnalysis();

  return (
    <div className="h-full bg-[var(--bg-secondary)] border-t border-[var(--border-color)] px-4 py-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-[var(--accent-blue)]">WHY</span>
        <span className="text-[var(--text-secondary)] text-xs">
          {symbol} ({market}) 분석 근거
        </span>
        {state.loading && (
          <span className="text-xs text-[var(--text-secondary)] animate-pulse">로딩 중...</span>
        )}
      </div>

      {state.error ? (
        <div className="text-sm text-[var(--accent-red)]">
          데이터 로드 실패: {state.error}
        </div>
      ) : state.loading ? (
        <div className="text-sm text-[var(--text-secondary)]">
          분석 데이터를 불러오는 중...
        </div>
      ) : (
        <div className="text-sm flex flex-wrap items-center gap-x-1">
          {/* Confluence Score - first for prominence */}
          <span className={confluenceAnalysis.color}>●</span>
          <span className={confluenceAnalysis.color}>{confluenceAnalysis.text}</span>
          <span className="text-[var(--text-secondary)] mx-1">|</span>

          {/* EMA Status */}
          <span className={emaAnalysis.color}>●</span>
          <span className={emaAnalysis.color}>{emaAnalysis.text}</span>
          <span className="text-[var(--text-secondary)] mx-1">|</span>

          {/* Order Block */}
          <span className={obAnalysis.color}>●</span>
          <span className={obAnalysis.color}>{obAnalysis.text}</span>
          <span className="text-[var(--text-secondary)] mx-1">|</span>

          {/* Volume Strength */}
          <span className={volumeAnalysis.color}>●</span>
          <span className={volumeAnalysis.color}>{volumeAnalysis.text}</span>
          <span className="text-[var(--text-secondary)] mx-1">|</span>

          {/* FVG */}
          <span className={fvgAnalysis.color}>●</span>
          <span className={fvgAnalysis.color}>{fvgAnalysis.text}</span>
          <span className="text-[var(--text-secondary)] mx-1">|</span>

          {/* BOS */}
          <span className={bosAnalysis.color}>●</span>
          <span className={bosAnalysis.color}>{bosAnalysis.text}</span>
        </div>
      )}
    </div>
  );
}
