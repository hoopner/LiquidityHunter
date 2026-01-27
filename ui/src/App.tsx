import { useState } from 'react';
import './App.css';
import { MainChart } from './components/layout/MainChart';
import { SubCharts } from './components/layout/SubCharts';
import { Sidebar } from './components/layout/Sidebar';
import { WhyPanel } from './components/layout/WhyPanel';

export interface SelectedStock {
  symbol: string;
  market: string;
}

function App() {
  const [selectedStock, setSelectedStock] = useState<SelectedStock>({
    symbol: '005930',
    market: 'KR',
  });

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
          <nav className="flex items-center gap-4 text-sm">
            <button className="text-[var(--text-primary)] hover:text-[var(--accent-blue)]">차트</button>
            <button className="text-[var(--text-secondary)] hover:text-[var(--accent-blue)]">스크리너</button>
            <button className="text-[var(--text-secondary)] hover:text-[var(--accent-blue)]">설정</button>
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
        {/* Left: Chart area */}
        <div className="flex-1 flex flex-col">
          {/* Main chart */}
          <div className="flex-1">
            <MainChart symbol={selectedStock.symbol} market={selectedStock.market} />
          </div>

          {/* Sub charts (RSI, MACD, Volume) */}
          <div className="h-40">
            <SubCharts symbol={selectedStock.symbol} market={selectedStock.market} />
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="w-96">
          <Sidebar onStockSelect={handleStockSelect} selectedStock={selectedStock} />
        </div>
      </div>

      {/* Footer: WHY panel */}
      <div className="h-14">
        <WhyPanel />
      </div>
    </div>
  );
}

export default App;
