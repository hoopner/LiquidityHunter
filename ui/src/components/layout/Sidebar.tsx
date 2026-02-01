import { useState, useCallback } from 'react';
import { PortfolioPanel } from '../panels/PortfolioPanel';
import { WatchlistPanel } from '../panels/WatchlistPanel';
import { ScreenerPanel } from '../panels/ScreenerPanel';
import { BacktestPanel } from '../panels/BacktestPanel';
import { AlertPanel } from '../panels/AlertPanel';
import { TradingPanel } from '../panels/TradingPanel';
import { AIPredictionsPanel } from '../ai/AIPredictionsPanel';
import { AIStatisticsPanel } from '../ai/AIStatisticsPanel';
import { useResponsive } from '../../hooks/useResponsive';
import type { TradingLevels } from '../ai/AIPredictionsPanel';
import type { SelectedStock } from '../../App';

type PanelType = 'portfolio' | 'watchlist' | 'screener' | 'ai' | 'ai-stats' | 'backtest' | 'alerts' | 'trading';

interface SidebarProps {
  onStockSelect: (symbol: string, market: string) => void;
  selectedStock: SelectedStock;
  onTradingLevelsChange?: (levels: TradingLevels | null) => void;
}

/**
 * Right sidebar with independently collapsible panels
 * Multiple panels can be open simultaneously
 * Responsive: Touch-friendly on mobile/tablet
 */
export function Sidebar({ onStockSelect, selectedStock, onTradingLevelsChange }: SidebarProps) {
  const { isMobile, isTouchDevice } = useResponsive();

  // Multiple panels can be open at once (default: screener open)
  const [openPanels, setOpenPanels] = useState<Set<PanelType>>(new Set(['screener']));

  // Quick search state
  const [searchSymbol, setSearchSymbol] = useState('');
  const [searchMarket, setSearchMarket] = useState('US');

  // Toggle panel open/closed independently
  const togglePanel = useCallback((panelId: PanelType) => {
    setOpenPanels(prev => {
      const newSet = new Set(prev);
      if (newSet.has(panelId)) {
        newSet.delete(panelId);  // Close this panel
      } else {
        newSet.add(panelId);  // Open this panel
      }
      return newSet;
    });
  }, []);

  // Check if panel is open
  const isPanelOpen = useCallback((panelId: PanelType) => openPanels.has(panelId), [openPanels]);

  // Handle quick search
  const handleQuickSearch = useCallback(() => {
    const symbol = searchSymbol.trim().toUpperCase();
    if (!symbol) return;

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

  const panels: { id: PanelType; title: string; titleKo: string; icon: string }[] = [
    { id: 'trading', title: 'Auto Trading', titleKo: '자동매매', icon: '🤖' },
    { id: 'portfolio', title: 'Portfolio', titleKo: '포트폴리오', icon: '💼' },
    { id: 'watchlist', title: 'Watchlist', titleKo: '관심리스트', icon: '⭐' },
    { id: 'screener', title: 'Screener', titleKo: 'EMA 스크리너', icon: '🔍' },
    { id: 'ai', title: 'AI Analysis', titleKo: 'AI 분석', icon: '🧠' },
    { id: 'ai-stats', title: 'AI Statistics', titleKo: 'AI 성과 통계', icon: '📊' },
    { id: 'backtest', title: 'Backtest', titleKo: '전략 백테스트', icon: '📈' },
    { id: 'alerts', title: 'Alerts', titleKo: '알림 설정', icon: '🔔' },
  ];

  const renderPanel = (panelId: PanelType) => {
    switch (panelId) {
      case 'trading':
        return <TradingPanel market={selectedStock.market} />;
      case 'portfolio':
        return <PortfolioPanel onStockSelect={onStockSelect} selectedSymbol={selectedStock.symbol} />;
      case 'watchlist':
        return <WatchlistPanel onStockSelect={onStockSelect} selectedSymbol={selectedStock.symbol} />;
      case 'screener':
        return <ScreenerPanel onStockSelect={onStockSelect} selectedSymbol={selectedStock.symbol} />;
      case 'ai':
        return <AIPredictionsPanel symbol={selectedStock.symbol} market={selectedStock.market} onTradingLevelsChange={onTradingLevelsChange} />;
      case 'ai-stats':
        return <AIStatisticsPanel symbol={selectedStock.symbol} market={selectedStock.market} />;
      case 'backtest':
        return <BacktestPanel symbol={selectedStock.symbol} market={selectedStock.market} />;
      case 'alerts':
        return <AlertPanel symbol={selectedStock.symbol} market={selectedStock.market} />;
    }
  };

  // Touch-friendly padding
  const touchPadding = isTouchDevice || isMobile ? 'py-3 px-4' : 'py-2 px-3';
  const inputPadding = isTouchDevice || isMobile ? 'py-3 px-3' : 'py-1.5 px-2';

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg-secondary)] border-l border-[var(--border-color)] overflow-hidden"
    >
      {/* Quick Search Bar - Fixed at top */}
      <div className={`flex-shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] ${touchPadding}`}>
        <div className="text-xs text-[var(--text-secondary)] mb-2 font-medium">Quick Search</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchSymbol}
            onChange={(e) => setSearchSymbol(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="AAPL, 005930..."
            className={`flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-sm focus:outline-none focus:border-[var(--accent-blue)] ${inputPadding}`}
            style={{ fontSize: isMobile ? '16px' : '14px' }} // Prevent iOS zoom
          />
          <select
            value={searchMarket}
            onChange={(e) => setSearchMarket(e.target.value)}
            className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-sm ${inputPadding}`}
            style={{ fontSize: isMobile ? '16px' : '14px' }}
          >
            <option value="US">US</option>
            <option value="KR">KR</option>
          </select>
          <button
            onClick={handleQuickSearch}
            disabled={!searchSymbol.trim()}
            className={`bg-[var(--accent-blue)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 touch-manipulation ${
              isTouchDevice || isMobile ? 'px-4 min-h-[44px]' : 'px-3'
            }`}
          >
            Go
          </button>
        </div>
      </div>

      {/* Scrollable Panel List */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          scrollBehavior: 'smooth',
        }}
      >
        {panels.map((panel) => {
          const isOpen = isPanelOpen(panel.id);
          return (
            <div
              key={panel.id}
              className="border-b border-[var(--border-color)]"
            >
              {/* Panel header - always visible, click to toggle */}
              <button
                onClick={() => togglePanel(panel.id)}
                className={`w-full flex items-center justify-between hover:bg-[var(--bg-tertiary)] transition-colors touch-manipulation ${
                  isOpen ? 'bg-[var(--bg-tertiary)]' : ''
                } ${touchPadding}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                  >
                    ▶
                  </span>
                  {/* Icon for touch devices */}
                  {(isTouchDevice || isMobile) && (
                    <span className="text-base">{panel.icon}</span>
                  )}
                  <span className={`font-medium ${isMobile ? 'text-base' : ''}`}>{panel.titleKo}</span>
                  {!isMobile && (
                    <span className="text-xs text-[var(--text-secondary)]">{panel.title}</span>
                  )}
                </div>
                {/* Expand/collapse indicator */}
                <span className="text-xs text-[var(--text-secondary)]">
                  {isOpen ? '−' : '+'}
                </span>
              </button>

              {/* Panel content - shown when open */}
              {isOpen && (
                <div
                  className="max-w-full overflow-x-hidden"
                  style={{
                    maxHeight: '400px',  // Limit panel height for better UX
                    overflowY: 'auto',
                  }}
                >
                  {renderPanel(panel.id)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Current stock info at bottom - Mobile only */}
      {isMobile && (
        <div className="flex-shrink-0 p-4 border-t border-[var(--border-color)] bg-[var(--bg-tertiary)]">
          <div className="text-xs text-[var(--text-secondary)] mb-1">현재 종목</div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">{selectedStock.symbol}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
              selectedStock.market === 'KR'
                ? 'bg-[#ef5350] bg-opacity-20 text-[#ef5350]'
                : 'bg-[#26a69a] bg-opacity-20 text-[#26a69a]'
            }`}>
              {selectedStock.market}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
