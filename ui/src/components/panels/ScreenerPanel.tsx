import { useState } from 'react';

/**
 * EMA Screener panel
 */
export function ScreenerPanel() {
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<typeof mockResults | null>(null);

  // Mock screener results
  const mockResults = [
    { symbol: '005930', name: '삼성전자', score: 85, daysToEMA: 3, gap: 2.1 },
    { symbol: '035420', name: 'NAVER', score: 78, daysToEMA: 5, gap: 3.4 },
    { symbol: '051910', name: 'LG화학', score: 72, daysToEMA: 7, gap: 4.2 },
    { symbol: '000660', name: 'SK하이닉스', score: 68, daysToEMA: 8, gap: 5.1 },
  ];

  const handleSearch = () => {
    setIsSearching(true);
    // Simulate API call
    setTimeout(() => {
      setResults(mockResults);
      setIsSearching(false);
    }, 500);
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
          <select className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-sm">
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
          EMA20이 EMA200에 접근하는 종목을 찾습니다
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!results ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            Search 버튼을 클릭하세요
          </div>
        ) : (
          results.map((item) => (
            <div
              key={item.symbol}
              className="px-3 py-2 border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{item.symbol}</div>
                  <div className="text-xs text-[var(--text-secondary)]">{item.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[var(--accent-green)] font-medium">{item.score}</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {item.daysToEMA}일 후 크로스
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
                <span className="text-xs text-[var(--text-secondary)]">Gap: {item.gap}%</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
