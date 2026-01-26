import { useState } from 'react';
import { PortfolioPanel } from '../panels/PortfolioPanel';
import { WatchlistPanel } from '../panels/WatchlistPanel';
import { ScreenerPanel } from '../panels/ScreenerPanel';

type PanelType = 'portfolio' | 'watchlist' | 'screener';

/**
 * Right sidebar with collapsible panels
 */
export function Sidebar() {
  const [expandedPanel, setExpandedPanel] = useState<PanelType>('screener');

  const panels: { id: PanelType; title: string; titleKo: string }[] = [
    { id: 'portfolio', title: 'Portfolio', titleKo: '포트폴리오' },
    { id: 'watchlist', title: 'Watchlist', titleKo: '관심리스트' },
    { id: 'screener', title: 'Screener', titleKo: 'EMA 스크리너' },
  ];

  const renderPanel = (panelId: PanelType) => {
    switch (panelId) {
      case 'portfolio':
        return <PortfolioPanel />;
      case 'watchlist':
        return <WatchlistPanel />;
      case 'screener':
        return <ScreenerPanel />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] border-l border-[var(--border-color)]">
      {panels.map((panel) => {
        const isExpanded = expandedPanel === panel.id;
        return (
          <div
            key={panel.id}
            className={`flex flex-col ${isExpanded ? 'flex-1' : ''} border-b border-[var(--border-color)]`}
          >
            {/* Panel header - always visible */}
            <button
              onClick={() => setExpandedPanel(panel.id)}
              className={`flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-tertiary)] transition-colors ${
                isExpanded ? 'bg-[var(--bg-tertiary)]' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isExpanded ? 'rotate-90' : ''} transition-transform`}>
                  ▶
                </span>
                <span className="font-medium">{panel.titleKo}</span>
                <span className="text-xs text-[var(--text-secondary)]">{panel.title}</span>
              </div>
            </button>

            {/* Panel content - only when expanded */}
            {isExpanded && (
              <div className="flex-1 overflow-hidden">
                {renderPanel(panel.id)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
