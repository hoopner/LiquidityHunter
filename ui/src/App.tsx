/**
 * LiquidityHunter App - Clean Foundation with Real-time Features
 *
 * Core features:
 * - Chart with candlesticks
 * - EMA20, EMA200, SMA20, SMA200 indicators
 * - Order Block detection
 * - Multi-Timeframe analysis
 * - FVG detection
 *
 * Real-time features:
 * - Live price updates in header
 * - Last candle updates
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import './App.css';
import { MultiChartLayout } from './components/layout/MultiChartLayout';
import { Sidebar } from './components/layout/Sidebar';
import { WhyPanel } from './components/layout/WhyPanel';
import { ScreenerPage } from './components/layout/ScreenerPage';
import { useRealtimePrice } from './hooks/useRealtimePrice';
import { getMarket, getMarketStatus, formatTimeSince } from './utils/marketHours';
import type { TradingLevels } from './components/ai/AIPredictionsPanel';

export interface SelectedStock {
  symbol: string;
  market: string;
}

type ViewType = 'chart' | 'screener';

// LocalStorage keys
const STORAGE_KEY_SYMBOL = 'lh_lastSymbol';
const STORAGE_KEY_MARKET = 'lh_lastMarket';

// Default ticker (Samsung)
const DEFAULT_SYMBOL = '005930';
const DEFAULT_MARKET = 'KR';

function App() {
  // Initialize with last viewed ticker or default
  const [selectedStock, setSelectedStock] = useState<SelectedStock>(() => {
    const savedSymbol = localStorage.getItem(STORAGE_KEY_SYMBOL);
    const savedMarket = localStorage.getItem(STORAGE_KEY_MARKET);

    if (savedSymbol && savedMarket) {
      console.log('[App] Loaded last ticker from localStorage:', { symbol: savedSymbol, market: savedMarket });
      return { symbol: savedSymbol, market: savedMarket };
    }

    console.log('[App] No saved ticker, using default:', { symbol: DEFAULT_SYMBOL, market: DEFAULT_MARKET });
    return { symbol: DEFAULT_SYMBOL, market: DEFAULT_MARKET };
  });
  const [currentView, setCurrentView] = useState<ViewType>('chart');

  // Trading levels from AI panel
  const [tradingLevels, setTradingLevels] = useState<TradingLevels | null>(null);

  // Real-time price subscription
  const { price: realtimePrice, status: priceStatus, direction: priceDirection } = useRealtimePrice(
    selectedStock.symbol,
    selectedStock.market,
    { enabled: currentView === 'chart' }  // Only enable when viewing chart
  );

  // Format price for display
  const formattedPrice = useMemo(() => {
    if (!realtimePrice) return null;
    const currency = selectedStock.market === 'KR' ? '₩' : '$';
    const priceStr = selectedStock.market === 'KR'
      ? realtimePrice.price.toLocaleString('ko-KR')
      : realtimePrice.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const changeStr = realtimePrice.changePct >= 0
      ? `+${realtimePrice.changePct.toFixed(2)}%`
      : `${realtimePrice.changePct.toFixed(2)}%`;
    return { currency, priceStr, changeStr, isUp: realtimePrice.changePct >= 0 };
  }, [realtimePrice, selectedStock.market]);

  // Track last update time for "Updated Xs ago" display
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  const lastUpdateRef = useRef<number>(Date.now());
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);

  // Update "seconds ago" counter every second
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdateRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Track price updates and trigger flash effect
  useEffect(() => {
    if (realtimePrice) {
      lastUpdateRef.current = Date.now();
      setSecondsAgo(0);

      // Trigger flash effect based on direction
      if (priceDirection === 'up' || priceDirection === 'down') {
        setPriceFlash(priceDirection);
        // Clear flash after animation
        const timer = setTimeout(() => setPriceFlash(null), 300);
        return () => clearTimeout(timer);
      }
    }
  }, [realtimePrice, priceDirection]);

  // Get market status (open/closed) for current symbol
  const market = useMemo(() => getMarket(selectedStock.symbol), [selectedStock.symbol]);
  const marketStatus = useMemo(() => getMarketStatus(market), [market]);

  // Format last update time
  const lastUpdateDisplay = useMemo(() => {
    if (!realtimePrice) return null;
    return formatTimeSince(lastUpdateRef.current);
  }, [realtimePrice, secondsAgo]); // secondsAgo dependency triggers re-render

  // Stock selection handler - saves to localStorage
  const handleStockSelect = useCallback((symbol: string, market: string) => {
    console.log('[App] Stock selected:', { symbol, market });

    // Save to localStorage
    localStorage.setItem(STORAGE_KEY_SYMBOL, symbol);
    localStorage.setItem(STORAGE_KEY_MARKET, market);

    setSelectedStock({ symbol, market });
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header - Simple, no real-time price */}
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
          {/* Current ticker display with real-time price */}
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-primary)] font-bold text-base">{selectedStock.symbol}</span>
            <span className="text-[var(--text-secondary)] text-xs">({selectedStock.market})</span>
            {formattedPrice ? (
              <>
                {/* Price with flash effect */}
                <span
                  className={`font-bold text-base transition-all duration-200 ${
                    priceFlash === 'up' ? 'bg-[#26a69a33] scale-105' :
                    priceFlash === 'down' ? 'bg-[#ef535033] scale-105' : ''
                  } ${formattedPrice.isUp ? 'text-[#26a69a]' : 'text-[#ef5350]'} px-1 rounded`}
                >
                  {formattedPrice.currency}{formattedPrice.priceStr}
                </span>
                <span className={`text-sm font-medium ${formattedPrice.isUp ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                  {formattedPrice.changeStr}
                </span>
                {priceDirection === 'up' && <span className="text-[#26a69a] text-xs">▲</span>}
                {priceDirection === 'down' && <span className="text-[#ef5350] text-xs">▼</span>}

                {/* Market status indicator - LIVE when open, Closed when not */}
                <span className="flex items-center gap-1 ml-2">
                  <span
                    className={`w-2 h-2 rounded-full ${marketStatus.animate ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: marketStatus.dotColor }}
                  ></span>
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: marketStatus.textColor }}
                  >
                    {marketStatus.isOpen ? 'LIVE' : marketStatus.labelKR}
                  </span>
                </span>

                {/* Last update timestamp - only show when market is open */}
                {marketStatus.isOpen && lastUpdateDisplay && (
                  <span className="text-[10px] text-[var(--text-secondary)] ml-1">
                    {lastUpdateDisplay}
                  </span>
                )}

                {/* Next market event - show when closed */}
                {!marketStatus.isOpen && (
                  <span className="text-[10px] text-[var(--text-secondary)] ml-1">
                    ({marketStatus.nextEvent})
                  </span>
                )}
              </>
            ) : (
              <span className="text-[var(--text-secondary)] text-xs flex items-center gap-2">
                {priceStatus === 'connecting' && (
                  <>
                    <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
                    연결중...
                  </>
                )}
                {priceStatus === 'error' && (
                  <>
                    <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                    오류
                  </>
                )}
                {priceStatus === 'disconnected' && (
                  <>
                    <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
                    연결 끊김
                  </>
                )}
              </span>
            )}
          </div>
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
              realtimePrice={realtimePrice}
              tradingLevels={tradingLevels}
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
          <Sidebar onStockSelect={handleStockSelect} selectedStock={selectedStock} onTradingLevelsChange={setTradingLevels} />
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
