import { useState } from 'react';
import './App.css';
import { MultiChartLayout } from './components/layout/MultiChartLayout';
import { Sidebar } from './components/layout/Sidebar';
import { WhyPanel } from './components/layout/WhyPanel';
import { ScreenerPage } from './components/layout/ScreenerPage';

export interface SelectedStock {
  symbol: string;
  market: string;
}

type ViewType = 'chart' | 'screener';

function App() {
  const [selectedStock, setSelectedStock] = useState<SelectedStock>({
    symbol: '005930',
    market: 'KR',
  });
  const [currentView, setCurrentView] = useState<ViewType>('chart');

  const handleStockSelect = (symbol: string, market: string) => {
    setSelectedStock({ symbol, market });
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="h-10 flex items-center px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-[var(--accent-blue)]">LiquidityHunter</span>
          <span className="text-[var(--text-secondary)] text-sm">|</span>
          <nav className="flex items-center gap-1 text-sm bg-[var(--bg-tertiary)] rounded p-0.5">
            <button
              onClick={() => setCurrentView('chart')}
              className={`px-3 py-1 rounded transition-colors ${
                currentView === 'chart'
                  ? 'bg-[var(--accent-blue)] text-white font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              차트
            </button>
            <button
              onClick={() => setCurrentView('screener')}
              className={`px-3 py-1 rounded transition-colors ${
                currentView === 'screener'
                  ? 'bg-[var(--accent-blue)] text-white font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              스크리너
            </button>
          </nav>
        </div>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="text-[var(--text-secondary)]">
            현재: <span className="text-[var(--text-primary)] font-medium">{selectedStock.symbol}</span>
            <span className="text-[var(--accent-blue)] ml-1">({selectedStock.market})</span>
          </span>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Main content (Chart or Screener) */}
        <div className="flex-1 flex flex-col">
          {currentView === 'chart' ? (
            <MultiChartLayout
              selectedSymbol={selectedStock.symbol}
              selectedMarket={selectedStock.market}
              onStockSelect={handleStockSelect}
            />
          ) : (
            <ScreenerPage
              onStockSelect={handleStockSelect}
              onBackToChart={() => setCurrentView('chart')}
            />
          )}
        </div>

        {/* Right: Sidebar (always visible) */}
        <div className="w-96">
          <Sidebar onStockSelect={handleStockSelect} selectedStock={selectedStock} />
        </div>
      </div>

      {/* Footer: WHY panel (only show in chart view) */}
      {currentView === 'chart' && (
        <div className="h-14">
          <WhyPanel symbol={selectedStock.symbol} market={selectedStock.market} />
        </div>
      )}
    </div>
  );
}

export default App;
