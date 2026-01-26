interface PortfolioPanelProps {
  onStockSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}

/**
 * Portfolio panel - 나의 포트폴리오
 */
export function PortfolioPanel({ onStockSelect, selectedSymbol }: PortfolioPanelProps) {
  // Mock portfolio data
  const holdings = [
    { symbol: '005930', name: '삼성전자', market: 'KR', qty: 100, avgPrice: 54000, currentPrice: 55800, pnl: 1800, pnlPercent: 3.33 },
    { symbol: '000660', name: 'SK하이닉스', market: 'KR', qty: 50, avgPrice: 178000, currentPrice: 175000, pnl: -3000, pnlPercent: -1.69 },
    { symbol: '035420', name: 'NAVER', market: 'KR', qty: 20, avgPrice: 185000, currentPrice: 192000, pnl: 7000, pnlPercent: 3.78 },
  ];

  const totalValue = holdings.reduce((sum, h) => sum + h.currentPrice * h.qty, 0);
  const totalPnl = holdings.reduce((sum, h) => sum + h.pnl * h.qty, 0);

  const handleItemClick = (item: typeof holdings[0]) => {
    onStockSelect(item.symbol, item.market);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="font-semibold">나의 포트폴리오</div>
        <div className="text-xs text-[var(--text-secondary)]">Portfolio</div>
      </div>

      {/* Summary */}
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex justify-between items-center">
          <span className="text-[var(--text-secondary)] text-xs">총 평가금액</span>
          <span className="font-medium">{totalValue.toLocaleString()}원</span>
        </div>
        <div className="flex justify-between items-center mt-1">
          <span className="text-[var(--text-secondary)] text-xs">평가손익</span>
          <span className={totalPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString()}원
          </span>
        </div>
      </div>

      {/* Holdings list */}
      <div className="flex-1 overflow-y-auto">
        {holdings.map((holding) => {
          const isSelected = holding.symbol === selectedSymbol;
          return (
            <div
              key={holding.symbol}
              onClick={() => handleItemClick(holding)}
              className={`px-3 py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors
                ${isSelected
                  ? 'bg-[var(--accent-blue)] bg-opacity-20 border-l-2 border-l-[var(--accent-blue)]'
                  : 'hover:bg-[var(--bg-tertiary)]'
                }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className={`font-medium ${isSelected ? 'text-[var(--accent-blue)]' : ''}`}>
                    {holding.symbol}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">{holding.name}</div>
                </div>
                <div className="text-right">
                  <div>{holding.currentPrice.toLocaleString()}</div>
                  <div className={`text-xs ${holding.pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {holding.pnl >= 0 ? '+' : ''}{holding.pnlPercent.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
