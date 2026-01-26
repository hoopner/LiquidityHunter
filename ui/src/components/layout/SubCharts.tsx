/**
 * Sub-charts area for indicators (RSI, MACD, Volume)
 */
export function SubCharts() {
  return (
    <div className="flex h-full border-t border-[var(--border-color)]">
      {/* RSI */}
      <div className="flex-1 border-r border-[var(--border-color)] p-2">
        <div className="text-xs text-[var(--text-secondary)] mb-1">RSI (14)</div>
        <div className="h-full flex items-center justify-center text-[var(--text-secondary)] text-sm opacity-50">
          RSI Chart
        </div>
      </div>

      {/* MACD */}
      <div className="flex-1 border-r border-[var(--border-color)] p-2">
        <div className="text-xs text-[var(--text-secondary)] mb-1">MACD (12, 26, 9)</div>
        <div className="h-full flex items-center justify-center text-[var(--text-secondary)] text-sm opacity-50">
          MACD Chart
        </div>
      </div>

      {/* Volume */}
      <div className="flex-1 p-2">
        <div className="text-xs text-[var(--text-secondary)] mb-1">Volume</div>
        <div className="h-full flex items-center justify-center text-[var(--text-secondary)] text-sm opacity-50">
          Volume Chart
        </div>
      </div>
    </div>
  );
}
