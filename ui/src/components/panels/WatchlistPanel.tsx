interface WatchlistPanelProps {
  onStockSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}

/**
 * Watchlist panel - 관심리스트
 */
export function WatchlistPanel({ onStockSelect, selectedSymbol }: WatchlistPanelProps) {
  // Mock watchlist data - in real app, this would come from API/localStorage
  const watchlist = [
    { symbol: '005930', name: '삼성전자', market: 'KR', price: 55800, change: 1.82 },
    { symbol: '000660', name: 'SK하이닉스', market: 'KR', price: 175000, change: -1.69 },
    { symbol: '035420', name: 'NAVER', market: 'KR', price: 192000, change: 3.78 },
    { symbol: '051910', name: 'LG화학', market: 'KR', price: 298000, change: 2.41 },
    { symbol: '006400', name: '삼성SDI', market: 'KR', price: 354000, change: -0.84 },
    { symbol: 'AAPL', name: 'Apple', market: 'US', price: 178.50, change: 0.85 },
    { symbol: 'NVDA', name: 'NVIDIA', market: 'US', price: 485.20, change: 2.34 },
    { symbol: 'META', name: 'Meta', market: 'US', price: 325.80, change: 1.12 },
  ];

  const handleItemClick = (item: typeof watchlist[0]) => {
    onStockSelect(item.symbol, item.market);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex justify-between items-center">
        <div>
          <div className="font-semibold">관심리스트</div>
          <div className="text-xs text-[var(--text-secondary)]">Watchlist</div>
        </div>
        <button className="text-[var(--accent-blue)] text-xs hover:underline">
          편집
        </button>
      </div>

      {/* Watchlist items */}
      <div className="flex-1 overflow-y-auto">
        {watchlist.map((item) => {
          const isSelected = item.symbol === selectedSymbol;
          return (
            <div
              key={item.symbol}
              onClick={() => handleItemClick(item)}
              className={`px-3 py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors
                ${isSelected
                  ? 'bg-[var(--accent-blue)] bg-opacity-20 border-l-2 border-l-[var(--accent-blue)]'
                  : 'hover:bg-[var(--bg-tertiary)]'
                }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className={`font-medium ${isSelected ? 'text-[var(--accent-blue)]' : ''}`}>
                    {item.symbol}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {item.name} <span className="opacity-60">({item.market})</span>
                  </div>
                </div>
                <div className="text-right">
                  <div>{item.price.toLocaleString()}</div>
                  <div className={`text-xs ${item.change >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add button */}
      <div className="px-3 py-2 border-t border-[var(--border-color)]">
        <button className="w-full py-1.5 text-sm text-[var(--accent-blue)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)]">
          + 종목 추가
        </button>
      </div>
    </div>
  );
}
