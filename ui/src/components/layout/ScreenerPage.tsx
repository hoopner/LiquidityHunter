import { useState, useEffect } from 'react';

interface ScreenerResult {
  symbol: string;
  market: string;
  name: string;
  price: number;
  change: number;
  signal: string;
  signalDate: string;
}

type MarketFilter = 'all' | 'KR' | 'US';
type ScreenerType = 'ema_cross' | 'ob_detect' | 'rsi_extreme';

interface ScreenerPageProps {
  onStockSelect: (symbol: string, market: string) => void;
  onBackToChart: () => void;
}

export function ScreenerPage({ onStockSelect, onBackToChart }: ScreenerPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [screenerType, setScreenerType] = useState<ScreenerType>('ob_detect');
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch screener results
  useEffect(() => {
    const fetchResults = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          screener_type: screenerType,
        });
        if (marketFilter !== 'all') {
          params.set('market', marketFilter);
        }

        const response = await fetch(`http://localhost:8000/screen_all?${params}`);
        if (!response.ok) {
          throw new Error('Failed to fetch screener results');
        }

        const data = await response.json();

        // Transform API response to our format
        const transformedResults: ScreenerResult[] = data.results.map((item: {
          symbol: string;
          market: string;
          current_price: number;
          signal_type?: string;
          ob_direction?: string;
          ema_cross_type?: string;
          rsi_signal?: string;
        }) => ({
          symbol: item.symbol,
          market: item.market,
          name: item.symbol, // API doesn't provide name, use symbol
          price: item.current_price,
          change: 0, // API doesn't provide change
          signal: item.signal_type || item.ob_direction || item.ema_cross_type || item.rsi_signal || 'Unknown',
          signalDate: new Date().toISOString().split('T')[0],
        }));

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
    (r) =>
      r.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRowClick = (result: ScreenerResult) => {
    onStockSelect(result.symbol, result.market);
    onBackToChart();
  };

  const screenerTypes: { value: ScreenerType; label: string }[] = [
    { value: 'ob_detect', label: 'OB 감지' },
    { value: 'ema_cross', label: 'EMA Cross' },
    { value: 'rsi_extreme', label: 'RSI 과매수/과매도' },
  ];

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
                <th className="pb-3 font-medium">종목</th>
                <th className="pb-3 font-medium">시장</th>
                <th className="pb-3 font-medium text-right">가격</th>
                <th className="pb-3 font-medium">시그널</th>
                <th className="pb-3 font-medium">날짜</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--text-secondary)]">
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
                    <td className="py-3 text-right font-mono">
                      {result.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-3">
                      <span
                        className={`text-sm font-medium ${
                          result.signal.toLowerCase().includes('bullish') ||
                          result.signal.toLowerCase().includes('golden') ||
                          result.signal.toLowerCase().includes('oversold')
                            ? 'text-[#26a69a]'
                            : result.signal.toLowerCase().includes('bearish') ||
                              result.signal.toLowerCase().includes('death') ||
                              result.signal.toLowerCase().includes('overbought')
                            ? 'text-[#ef5350]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {result.signal}
                      </span>
                    </td>
                    <td className="py-3 text-[var(--text-secondary)] text-sm">{result.signalDate}</td>
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
