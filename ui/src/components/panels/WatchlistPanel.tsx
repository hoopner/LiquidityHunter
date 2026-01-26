/**
 * Watchlist panel - 관심리스트
 */
export function WatchlistPanel() {
  // Mock watchlist data
  const watchlist = [
    { symbol: '051910', name: 'LG화학', price: 298000, change: 2.41 },
    { symbol: '006400', name: '삼성SDI', price: 354000, change: -0.84 },
    { symbol: '035720', name: '카카오', price: 39150, change: 1.56 },
    { symbol: '068270', name: '셀트리온', price: 178500, change: -1.11 },
    { symbol: '012330', name: '현대모비스', price: 214000, change: 0.47 },
  ];

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
        {watchlist.map((item) => (
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
                <div>{item.price.toLocaleString()}</div>
                <div className={`text-xs ${item.change >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                  {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
        ))}
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
