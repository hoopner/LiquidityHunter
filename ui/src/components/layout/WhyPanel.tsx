/**
 * WHY panel - displays reasoning for trade decisions
 */
export function WhyPanel() {
  return (
    <div className="h-full bg-[var(--bg-secondary)] border-t border-[var(--border-color)] px-4 py-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-[var(--accent-blue)]">WHY</span>
        <span className="text-[var(--text-secondary)] text-xs">분석 근거</span>
      </div>
      <div className="text-sm text-[var(--text-secondary)]">
        <span className="text-[var(--accent-green)]">●</span> EMA20이 EMA200에 접근 중 (3일 후 예상 크로스)
        <span className="mx-2">|</span>
        <span className="text-[var(--accent-blue)]">●</span> Bullish Order Block 감지 @ 54,200 - 54,800
        <span className="mx-2">|</span>
        <span className="text-[var(--text-primary)]">●</span> FVG 존재 (Gap: 54,500 - 54,700)
      </div>
    </div>
  );
}
