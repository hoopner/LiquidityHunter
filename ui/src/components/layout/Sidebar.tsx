import { useState, useCallback } from 'react';
import { PortfolioPanel } from '../panels/PortfolioPanel';
import { WatchlistPanel } from '../panels/WatchlistPanel';
import { ScreenerPanel } from '../panels/ScreenerPanel';
import { BacktestPanel } from '../panels/BacktestPanel';
import { AlertPanel } from '../panels/AlertPanel';
import { AIPredictionsPanel } from '../ai/AIPredictionsPanel';
import type { TradingLevels } from '../ai/AIPredictionsPanel';
import type { SelectedStock } from '../../App';

type PanelType = 'portfolio' | 'watchlist' | 'screener' | 'ai' | 'backtest' | 'alerts';

interface SidebarProps {
  onStockSelect: (symbol: string, market: string) => void;
  selectedStock: SelectedStock;
  onTradingLevelsChange?: (levels: TradingLevels | null) => void;
}

/**
 * Right sidebar with collapsible panels
 */
export function Sidebar({ onStockSelect, selectedStock, onTradingLevelsChange }: SidebarProps) {
  const [expandedPanel, setExpandedPanel] = useState<PanelType>('screener');

  // Quick search state
  const [searchSymbol, setSearchSymbol] = useState('');
  const [searchMarket, setSearchMarket] = useState('US');

  // Handle quick search
  const handleQuickSearch = useCallback(() => {
    const symbol = searchSymbol.trim().toUpperCase();
    if (!symbol) return;

    console.log('[Quick Search] Searching for:', { symbol, market: searchMarket });
    onStockSelect(symbol, searchMarket);
    // Clear input after search
    setSearchSymbol('');
  }, [searchSymbol, searchMarket, onStockSelect]);

  // Handle Enter key in search input
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleQuickSearch();
    }
  }, [handleQuickSearch]);

  const panels: { id: PanelType; title: string; titleKo: string }[] = [
    { id: 'portfolio', title: 'Portfolio', titleKo: '포트폴리오' },
    { id: 'watchlist', title: 'Watchlist', titleKo: '관심리스트' },
    { id: 'screener', title: 'Screener', titleKo: 'EMA 스크리너' },
    { id: 'ai', title: 'AI Analysis', titleKo: '🤖 AI 분석' },
    { id: 'backtest', title: 'Backtest', titleKo: '백테스트' },
    { id: 'alerts', title: 'Alerts', titleKo: '알림 설정' },
  ];

  const renderPanel = (panelId: PanelType) => {
    switch (panelId) {
      case 'portfolio':
        return <PortfolioPanel onStockSelect={onStockSelect} selectedSymbol={selectedStock.symbol} />;
      case 'watchlist':
        return <WatchlistPanel onStockSelect={onStockSelect} selectedSymbol={selectedStock.symbol} />;
      case 'screener':
        return <ScreenerPanel onStockSelect={onStockSelect} selectedSymbol={selectedStock.symbol} />;
      case 'ai':
        return <AIPredictionsPanel symbol={selectedStock.symbol} market={selectedStock.market} onTradingLevelsChange={onTradingLevelsChange} />;
      case 'backtest':
        return <BacktestPanel symbol={selectedStock.symbol} market={selectedStock.market} />;
      case 'alerts':
        return <AlertPanel />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] border-l border-[var(--border-color)]">
      {/* Quick Search Bar */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="text-xs text-[var(--text-secondary)] mb-1.5 font-medium">Quick Search</div>
        <div className="flex gap-1">
          <input
            type="text"
            value={searchSymbol}
            onChange={(e) => setSearchSymbol(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="AAPL, 005930..."
            className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--accent-blue)]"
          />
          <select
            value={searchMarket}
            onChange={(e) => setSearchMarket(e.target.value)}
            className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-sm"
          >
            <option value="US">US</option>
            <option value="KR">KR</option>
          </select>
          <button
            onClick={handleQuickSearch}
            disabled={!searchSymbol.trim()}
            className="px-3 py-1.5 bg-[var(--accent-blue)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            Go
          </button>
        </div>
      </div>

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
