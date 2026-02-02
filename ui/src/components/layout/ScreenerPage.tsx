import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config/api';

// Common fields for all screener results
interface BaseResult {
  symbol: string;
  market: string;
  current_price?: number;
  last_close?: number;
}

// OB Screener result
interface OBResult extends BaseResult {
  direction: string;
  zone_top: number;
  zone_bottom: number;
  distance_percent: number;
  has_fvg: boolean;
}

// EMA Cross result
interface EMAResult extends BaseResult {
  days_to_cross: number | null;
  gap: number;
  score: number;
  ema20: number;
  ema200: number;
}

// RSI result
interface RSIResult extends BaseResult {
  rsi_value: number;
  signal: string;
}

// Union type for display
interface DisplayResult {
  symbol: string;
  market: string;
  col1: string;  // Main signal column
  col1Color: 'green' | 'red' | 'neutral';
  col2: string;  // Secondary info
  col3: string;  // Third column (optional)
}

type MarketFilter = 'all' | 'KR' | 'US';
type ScreenerType = 'ob_detect' | 'ema_cross' | 'rsi_extreme';

interface ScreenerPageProps {
  onStockSelect: (symbol: string, market: string) => void;
  onBackToChart: () => void;
}

export function ScreenerPage({ onStockSelect, onBackToChart }: ScreenerPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [screenerType, setScreenerType] = useState<ScreenerType>('ob_detect');
  const [results, setResults] = useState<DisplayResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transform OB results to display format
  // Columns: 종목 | 시장 | 방향 | 가격대 | 신선도
  const transformOBResults = (data: { kr_candidates: OBResult[]; us_candidates: OBResult[] }): DisplayResult[] => {
    const krCandidates = data.kr_candidates || [];
    const usCandidates = data.us_candidates || [];

    let allCandidates: OBResult[] = [];
    if (marketFilter === 'all') {
      allCandidates = [...krCandidates, ...usCandidates];
    } else if (marketFilter === 'KR') {
      allCandidates = krCandidates;
    } else {
      allCandidates = usCandidates;
    }

    return allCandidates.map((item) => ({
      symbol: item.symbol,
      market: item.market,
      col1: item.direction === 'buy' ? 'Buy' : 'Sell',
      col1Color: item.direction === 'buy' ? 'green' : 'red' as const,
      col2: `${item.zone_bottom.toLocaleString()} ~ ${item.zone_top.toLocaleString()}`,
      col3: item.has_fvg ? 'Fresh + FVG' : 'Fresh',
    }));
  };

  // Transform EMA results to display format
  // Columns: 종목 | 시장 | 갭% | 예상일
  const transformEMAResults = (data: { kr_candidates: EMAResult[]; us_candidates: EMAResult[] }): DisplayResult[] => {
    const krCandidates = data.kr_candidates || [];
    const usCandidates = data.us_candidates || [];

    let allCandidates: EMAResult[] = [];
    if (marketFilter === 'all') {
      allCandidates = [...krCandidates, ...usCandidates];
    } else if (marketFilter === 'KR') {
      allCandidates = krCandidates;
    } else {
      allCandidates = usCandidates;
    }

    return allCandidates.map((item) => {
      const gapPercent = item.ema200 !== 0 ? (item.gap / item.ema200) * 100 : 0;
      return {
        symbol: item.symbol,
        market: item.market,
        col1: `${gapPercent.toFixed(1)}%`,
        col1Color: 'neutral' as const,
        col2: item.days_to_cross === 0 ? 'Crossed' : `${item.days_to_cross}일`,
        col3: '',
      };
    });
  };

  // Transform RSI results to display format
  // Columns: 종목 | 시장 | RSI | 신호
  const transformRSIResults = (data: { kr_candidates: RSIResult[]; us_candidates: RSIResult[] }): DisplayResult[] => {
    const krCandidates = data.kr_candidates || [];
    const usCandidates = data.us_candidates || [];

    let allCandidates: RSIResult[] = [];
    if (marketFilter === 'all') {
      allCandidates = [...krCandidates, ...usCandidates];
    } else if (marketFilter === 'KR') {
      allCandidates = krCandidates;
    } else {
      allCandidates = usCandidates;
    }

    return allCandidates.map((item) => ({
      symbol: item.symbol,
      market: item.market,
      col1: item.rsi_value.toFixed(1),
      col1Color: 'neutral' as const,
      col2: item.signal === 'overbought' ? '과매수' : '과매도',
      col3: '',
    }));
  };

  // Fetch screener results
  useEffect(() => {
    const fetchResults = async () => {
      setLoading(true);
      setError(null);

      try {
        let endpoint = '';
        let transformFn: (data: unknown) => DisplayResult[];

        switch (screenerType) {
          case 'ob_detect':
            endpoint = `${API_BASE_URL}/screen/ob`;
            transformFn = transformOBResults as (data: unknown) => DisplayResult[];
            break;
          case 'ema_cross':
            endpoint = `${API_BASE_URL}/screen_all`;
            transformFn = transformEMAResults as (data: unknown) => DisplayResult[];
            break;
          case 'rsi_extreme':
            endpoint = `${API_BASE_URL}/screen/rsi`;
            transformFn = transformRSIResults as (data: unknown) => DisplayResult[];
            break;
        }

        const response = await fetch(endpoint);
        if (!response.ok) {
          throw new Error('Failed to fetch screener results');
        }

        const data = await response.json();
        const transformedResults = transformFn(data);
        setResults(transformedResults);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [marketFilter, screenerType]);

  // Filter results by search query
  const filteredResults = results.filter(
    (r) => r.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRowClick = (result: DisplayResult) => {
    onStockSelect(result.symbol, result.market);
    onBackToChart();
  };

  const screenerTypes: { value: ScreenerType; label: string; description: string }[] = [
    { value: 'ob_detect', label: 'OB 감지', description: 'Order Block 감지' },
    { value: 'ema_cross', label: 'EMA Cross', description: 'EMA20/200 교차 예측' },
    { value: 'rsi_extreme', label: 'RSI 과매수/과매도', description: 'RSI > 70 또는 < 30' },
  ];

  // Column headers based on screener type
  const getColumnHeaders = (): string[] => {
    switch (screenerType) {
      case 'ob_detect':
        return ['종목', '시장', '방향', '가격대', '신선도'];
      case 'ema_cross':
        return ['종목', '시장', '갭%', '예상일'];
      case 'rsi_extreme':
        return ['종목', '시장', 'RSI', '신호'];
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Screener Header */}
      <div className="p-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">스크리너</h1>
          <button
            onClick={onBackToChart}
            className="px-4 py-2 text-sm bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)] hover:bg-[var(--accent-blue)] transition-colors"
          >
            차트로 돌아가기
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search Input */}
          <div className="flex-1 min-w-[200px] max-w-[300px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="종목 검색..."
              className="w-full px-3 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded focus:outline-none focus:border-[var(--accent-blue)]"
            />
          </div>

          {/* Market Filter */}
          <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded p-1">
            {(['all', 'KR', 'US'] as MarketFilter[]).map((market) => (
              <button
                key={market}
                onClick={() => setMarketFilter(market)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  marketFilter === market
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {market === 'all' ? '전체' : market}
              </button>
            ))}
          </div>

          {/* Screener Type */}
          <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded p-1">
            {screenerTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => setScreenerType(type.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  screenerType === type.value
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title={type.description}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <span className="text-[var(--text-secondary)]">로딩 중...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-32">
            <span className="text-[var(--accent-red)]">오류: {error}</span>
          </div>
        )}

        {!loading && !error && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                {getColumnHeaders().map((header, idx) => (
                  <th key={idx} className="pb-3 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={getColumnHeaders().length} className="py-8 text-center text-[var(--text-secondary)]">
                    검색 결과가 없습니다
                  </td>
                </tr>
              ) : (
                filteredResults.map((result, idx) => (
                  <tr
                    key={`${result.market}-${result.symbol}-${idx}`}
                    onClick={() => handleRowClick(result)}
                    className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                  >
                    <td className="py-3">
                      <span className="font-medium text-[var(--text-primary)]">{result.symbol}</span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          result.market === 'KR'
                            ? 'bg-[#ef5350] bg-opacity-20 text-[#ef5350]'
                            : 'bg-[#26a69a] bg-opacity-20 text-[#26a69a]'
                        }`}
                      >
                        {result.market}
                      </span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`text-sm font-medium ${
                          result.col1Color === 'green'
                            ? 'text-[#26a69a]'
                            : result.col1Color === 'red'
                            ? 'text-[#ef5350]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {result.col1}
                      </span>
                    </td>
                    <td className="py-3 text-[var(--text-secondary)] text-sm">
                      {screenerType === 'rsi_extreme' ? (
                        <span className={result.col2 === '과매수' ? 'text-[#ef5350] font-medium' : 'text-[#26a69a] font-medium'}>
                          {result.col2}
                        </span>
                      ) : (
                        result.col2
                      )}
                    </td>
                    {screenerType === 'ob_detect' && (
                      <td className="py-3 text-[var(--text-secondary)] text-sm">
                        <span className="text-[#26a69a]">{result.col3}</span>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* Results count */}
        {!loading && !error && (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">
            총 {filteredResults.length}개 결과
          </div>
        )}
      </div>
    </div>
  );
}
