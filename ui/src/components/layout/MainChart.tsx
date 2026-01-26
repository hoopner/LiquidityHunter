/**
 * Main chart area - placeholder for TradingView lightweight-charts
 */
export function MainChart() {
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Chart header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-color)]">
        <span className="text-lg font-semibold">005930</span>
        <span className="text-[var(--text-secondary)]">삼성전자</span>
        <span className="text-[var(--accent-green)] font-medium">55,800</span>
        <span className="text-[var(--accent-green)] text-sm">+1.82%</span>
      </div>

      {/* Chart placeholder */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-[var(--text-secondary)]">
          <div className="text-6xl mb-4 opacity-20">📈</div>
          <div className="text-lg">Main Chart Area</div>
          <div className="text-sm mt-2">lightweight-charts will render here</div>
        </div>
      </div>
    </div>
  );
}
