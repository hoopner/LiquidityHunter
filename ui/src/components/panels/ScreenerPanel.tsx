import { useState } from 'react';
import { fetchScreen } from '../../api/client';
import type { ScreenResult } from '../../api/types';

/**
 * EMA Screener panel - finds stocks where EMA20 is approaching EMA200 from below
 */
export function ScreenerPanel() {
  const [market, setMarket] = useState('KR');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<ScreenResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    setIsSearching(true);
    setError(null);

    try {
      const response = await fetchScreen(market, 20);
      setResults(response.candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="font-semibold">EMA Screener</div>
        <div className="text-xs text-[var(--text-secondary)]">EMA20/200 크로스 탐지</div>
      </div>

      {/* Search controls */}
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex gap-2 mb-2">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-sm"
          >
            <option value="KR">KR (한국)</option>
            <option value="US">US (미국)</option>
          </select>
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="px-4 py-1 bg-[var(--accent-blue)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {isSearching ? '검색중...' : 'Search'}
          </button>
        </div>
        <div className="text-xs text-[var(--text-secondary)]">
          EMA20이 EMA200 아래에서 접근하는 종목
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-3 text-[var(--accent-red)] text-sm">
            Error: {error}
          </div>
        )}
        {!results && !error ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            Search 버튼을 클릭하세요
          </div>
        ) : results && results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            조건에 맞는 종목이 없습니다
          </div>
        ) : results ? (
          results.map((item) => (
            <div
              key={item.symbol}
              className="px-3 py-2 border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{item.symbol}</div>
                  <div className="text-xs text-[var(--text-secondary)]">{item.market}</div>
                </div>
                <div className="text-right">
                  <div className="text-[var(--accent-green)] font-medium">{item.score}</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {item.days_to_cross}일 후 크로스
                  </div>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 bg-[var(--bg-tertiary)] rounded-full h-1.5">
                  <div
                    className="bg-[var(--accent-green)] h-1.5 rounded-full"
                    style={{ width: `${item.score}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--text-secondary)]">
                  Gap: {(item.gap * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                EMA20: {item.ema20.toLocaleString(undefined, { maximumFractionDigits: 0 })} |
                EMA200: {item.ema200.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          ))
        ) : null}
      </div>
    </div>
  );
}
