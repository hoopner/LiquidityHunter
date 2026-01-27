import { useState, useEffect, useCallback } from 'react';
import { MainChart, TIMEFRAMES, type Timeframe } from './MainChart';
import { SubCharts } from './SubCharts';

export type LayoutType = 1 | 2 | 4 | 8;

interface ChartCell {
  symbol: string;
  market: string;
}

interface MultiChartLayoutProps {
  selectedSymbol: string;
  selectedMarket: string;
  onStockSelect: (symbol: string, market: string) => void;
}

const DEFAULT_SYMBOLS: ChartCell[] = [
  { symbol: '005930', market: 'KR' },
  { symbol: 'AAPL', market: 'US' },
  { symbol: '000660', market: 'KR' },
  { symbol: 'MSFT', market: 'US' },
  { symbol: '035420', market: 'KR' },
  { symbol: 'GOOGL', market: 'US' },
  { symbol: '005380', market: 'KR' },
  { symbol: 'AMZN', market: 'US' },
];

export function MultiChartLayout({ selectedSymbol, selectedMarket, onStockSelect }: MultiChartLayoutProps) {
  const [layout, setLayout] = useState<LayoutType>(1);
  const [cells, setCells] = useState<ChartCell[]>(DEFAULT_SYMBOLS);
  const [selectedCell, setSelectedCell] = useState(0);
  const [maximizedCell, setMaximizedCell] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');

  // Handle layout change - clamp selectedCell to valid range
  const handleLayoutChange = (newLayout: LayoutType) => {
    setLayout(newLayout);
    // Reset maximized view when changing layout
    setMaximizedCell(null);
    // Clamp selectedCell to valid range for new layout
    if (selectedCell >= newLayout) {
      setSelectedCell(0);
      // Also update parent with the first cell's symbol
      const firstCell = cells[0];
      onStockSelect(firstCell.symbol, firstCell.market);
    }
  };

  // Update selected cell's symbol when sidebar selection changes
  useEffect(() => {
    if (layout > 1) {
      setCells(prev => {
        const newCells = [...prev];
        newCells[selectedCell] = { symbol: selectedSymbol, market: selectedMarket };
        return newCells;
      });
    }
  }, [selectedSymbol, selectedMarket, selectedCell, layout]);

  // Handle ESC key to restore from maximized view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && maximizedCell !== null) {
        setMaximizedCell(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [maximizedCell]);

  const handleCellClick = useCallback((index: number) => {
    setSelectedCell(index);
    const cell = cells[index];
    onStockSelect(cell.symbol, cell.market);
  }, [cells, onStockSelect]);

  const handleCellDoubleClick = useCallback((index: number) => {
    if (layout > 1) {
      setMaximizedCell(index);
    }
  }, [layout]);

  const handleRestore = useCallback(() => {
    setMaximizedCell(null);
  }, []);

  // Get grid class based on layout
  const getGridClass = () => {
    switch (layout) {
      case 1: return 'grid-cols-1 grid-rows-1';
      case 2: return 'grid-cols-2 grid-rows-1';
      case 4: return 'grid-cols-2 grid-rows-2';
      case 8: return 'grid-cols-4 grid-rows-2';
      default: return 'grid-cols-1 grid-rows-1';
    }
  };

  // Render single chart view (layout = 1)
  if (layout === 1) {
    return (
      <div className="flex flex-col h-full">
        {/* Layout selector in a thin bar */}
        <div className="flex items-center gap-2 px-4 py-1 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <span className="text-xs text-[var(--text-secondary)] mr-2">레이아웃:</span>
          <LayoutButtons layout={layout} setLayout={handleLayoutChange} />
          <div className="ml-4 flex items-center gap-1 bg-[var(--bg-tertiary)] rounded p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Main chart */}
        <div className="flex-1">
          <MainChart
            symbol={selectedSymbol}
            market={selectedMarket}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            showHeader={true}
          />
        </div>

        {/* Sub charts */}
        <div className="h-40">
          <SubCharts symbol={selectedSymbol} market={selectedMarket} timeframe={timeframe} />
        </div>
      </div>
    );
  }

  // Render maximized view
  if (maximizedCell !== null) {
    const cell = cells[maximizedCell];
    return (
      <div className="flex flex-col h-full">
        {/* Header with restore button */}
        <div className="flex items-center gap-2 px-4 py-1 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <span className="text-xs text-[var(--text-secondary)] mr-2">레이아웃:</span>
          <LayoutButtons layout={layout} setLayout={handleLayoutChange} />
          <div className="ml-4 flex items-center gap-1 bg-[var(--bg-tertiary)] rounded p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <button
            onClick={handleRestore}
            className="ml-auto px-3 py-1 text-xs font-medium bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
          >
            복원 (ESC)
          </button>
        </div>

        {/* Full screen chart */}
        <div className="flex-1">
          <MainChart
            symbol={cell.symbol}
            market={cell.market}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            showHeader={true}
          />
        </div>

        {/* Sub charts */}
        <div className="h-40">
          <SubCharts symbol={cell.symbol} market={cell.market} timeframe={timeframe} />
        </div>
      </div>
    );
  }

  // Render grid view (layout > 1)
  return (
    <div className="flex flex-col h-full">
      {/* Layout selector */}
      <div className="flex items-center gap-2 px-4 py-1 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <span className="text-xs text-[var(--text-secondary)] mr-2">레이아웃:</span>
        <LayoutButtons layout={layout} setLayout={handleLayoutChange} />
        <div className="ml-4 flex items-center gap-1 bg-[var(--bg-tertiary)] rounded p-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                timeframe === tf
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-[var(--text-secondary)]">
          더블클릭하여 확대 | 선택된 셀: {selectedCell + 1}
        </span>
      </div>

      {/* Chart grid */}
      <div className={`flex-1 grid ${getGridClass()} gap-[2px] bg-[#3a3f4b]`}>
        {cells.slice(0, layout).map((cell, index) => (
          <div
            key={`${layout}-${index}`}
            onClick={() => handleCellClick(index)}
            className="bg-[var(--bg-primary)] cursor-pointer p-[1px]"
          >
            <MainChart
              symbol={cell.symbol}
              market={cell.market}
              compact={true}
              timeframe={timeframe}
              isSelected={selectedCell === index}
              onDoubleClick={() => handleCellDoubleClick(index)}
              showHeader={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Layout button icons with visual grid representations
function LayoutButtons({ layout, setLayout }: { layout: LayoutType; setLayout: (l: LayoutType) => void }) {
  const buttons: { layout: LayoutType; label: string }[] = [
    { layout: 1, label: '1개' },
    { layout: 2, label: '2개' },
    { layout: 4, label: '4개' },
    { layout: 8, label: '8개' },
  ];

  // Render a mini grid icon for each layout
  const renderGridIcon = (layoutType: LayoutType, isActive: boolean) => {
    const boxClass = `rounded-sm ${isActive ? 'bg-white' : 'bg-[var(--text-secondary)]'}`;

    switch (layoutType) {
      case 1:
        return (
          <div className="w-5 h-5 flex items-center justify-center">
            <div className={`w-4 h-4 ${boxClass}`}></div>
          </div>
        );
      case 2:
        return (
          <div className="w-5 h-5 flex items-center justify-center gap-[2px]">
            <div className={`w-[9px] h-4 ${boxClass}`}></div>
            <div className={`w-[9px] h-4 ${boxClass}`}></div>
          </div>
        );
      case 4:
        return (
          <div className="w-5 h-5 grid grid-cols-2 grid-rows-2 gap-[2px]">
            <div className={boxClass}></div>
            <div className={boxClass}></div>
            <div className={boxClass}></div>
            <div className={boxClass}></div>
          </div>
        );
      case 8:
        return (
          <div className="w-5 h-5 grid grid-cols-4 grid-rows-2 gap-[1px]">
            {[...Array(8)].map((_, i) => (
              <div key={i} className={boxClass}></div>
            ))}
          </div>
        );
    }
  };

  return (
    <div className="flex items-center gap-2">
      {buttons.map((btn) => {
        const isActive = layout === btn.layout;
        return (
          <button
            key={btn.layout}
            onClick={() => setLayout(btn.layout)}
            className={`flex flex-col items-center justify-center min-w-[40px] h-[40px] px-2 py-1 rounded-lg transition-colors ${
              isActive
                ? 'bg-[var(--accent-blue)] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            {renderGridIcon(btn.layout, isActive)}
            <span className="text-[10px] mt-0.5 font-medium">{btn.label}</span>
          </button>
        );
      })}
    </div>
  );
}
