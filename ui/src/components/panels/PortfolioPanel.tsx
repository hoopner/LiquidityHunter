/**
 * Portfolio panel - 나의 포트폴리오
 */
export function PortfolioPanel() {
  // Mock portfolio data
  const holdings = [
    { symbol: '005930', name: '삼성전자', qty: 100, avgPrice: 54000, currentPrice: 55800, pnl: 1800, pnlPercent: 3.33 },
    { symbol: '000660', name: 'SK하이닉스', qty: 50, avgPrice: 178000, currentPrice: 175000, pnl: -3000, pnlPercent: -1.69 },
    { symbol: '035420', name: 'NAVER', qty: 20, avgPrice: 185000, currentPrice: 192000, pnl: 7000, pnlPercent: 3.78 },
  ];

  const totalValue = holdings.reduce((sum, h) => sum + h.currentPrice * h.qty, 0);
  const totalPnl = holdings.reduce((sum, h) => sum + h.pnl * h.qty, 0);

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
        {holdings.map((holding) => (
          <div
            key={holding.symbol}
            className="px-3 py-2 border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium">{holding.symbol}</div>
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
        ))}
      </div>
    </div>
  );
}
