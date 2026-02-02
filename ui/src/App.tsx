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
 *
 * Responsive design:
 * - Desktop: Full layout with sidebar
 * - Tablet: Narrower sidebar
 * - Mobile: Collapsible sidebar with hamburger menu
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import './App.css';
import { MultiChartLayout } from './components/layout/MultiChartLayout';
import { Sidebar } from './components/layout/Sidebar';
import { WhyPanel } from './components/layout/WhyPanel';
import { ScreenerPage } from './components/layout/ScreenerPage';
import { useRealtimePrice } from './hooks/useRealtimePrice';
import { useResponsive } from './hooks/useResponsive';
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

// Default ticker (SK하이닉스)
const DEFAULT_SYMBOL = '000660';
const DEFAULT_MARKET = 'KR';

function App() {
  // Responsive state
  const { isMobile, isTablet, isDesktop } = useResponsive();

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Initialize with last viewed ticker or default
  const [selectedStock, setSelectedStock] = useState<SelectedStock>(() => {
    const savedSymbol = localStorage.getItem(STORAGE_KEY_SYMBOL);
    const savedMarket = localStorage.getItem(STORAGE_KEY_MARKET);

    if (savedSymbol && savedMarket) {
      return { symbol: savedSymbol, market: savedMarket };
    }

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
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY_SYMBOL, symbol);
    localStorage.setItem(STORAGE_KEY_MARKET, market);

    setSelectedStock({ symbol, market });

    // Close mobile sidebar when stock is selected
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  // Close sidebar when clicking overlay
  const handleOverlayClick = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  // Close sidebar on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  // Sidebar width based on device
  const sidebarWidth = isDesktop ? 'w-96' : isTablet ? 'w-80' : 'w-full';

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)] safe-top">
      {/* Header - Responsive */}
      <header
        className={`flex items-center px-3 md:px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] ${
          isMobile ? 'h-14' : 'h-10'
        }`}
      >
        <div className="flex items-center gap-2 md:gap-3">
          {/* Mobile hamburger menu */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 -ml-2 touch-manipulation"
              aria-label="Toggle sidebar"
            >
              <div className={`hamburger ${sidebarOpen ? 'open' : ''}`}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </button>
          )}

          {/* Logo */}
          <span className={`font-bold text-[var(--accent-blue)] ${isMobile ? 'text-base' : 'text-lg'}`}>
            {isMobile ? 'LH' : 'LiquidityHunter'}
          </span>

          {/* Navigation tabs - hidden on mobile */}
          {!isMobile && (
            <>
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
            </>
          )}
        </div>

        {/* Right side - Current ticker and price */}
        <div className="ml-auto flex items-center gap-2 md:gap-4 text-sm">
          {/* Current ticker display with real-time price */}
          <div className="flex items-center gap-1 md:gap-2">
            <span className={`text-[var(--text-primary)] font-bold ${isMobile ? 'text-sm' : 'text-base'}`}>
              {selectedStock.symbol}
            </span>
            <span className="text-[var(--text-secondary)] text-xs">({selectedStock.market})</span>

            {formattedPrice ? (
              <>
                {/* Price with flash effect */}
                <span
                  className={`font-bold transition-all duration-200 ${
                    isMobile ? 'text-sm' : 'text-base'
                  } ${
                    priceFlash === 'up' ? 'bg-[#26a69a33] scale-105' :
                    priceFlash === 'down' ? 'bg-[#ef535033] scale-105' : ''
                  } ${formattedPrice.isUp ? 'text-[#26a69a]' : 'text-[#ef5350]'} px-1 rounded`}
                >
                  {formattedPrice.currency}{formattedPrice.priceStr}
                </span>

                {/* Change percent - hidden on small mobile */}
                <span className={`text-sm font-medium hide-mobile ${formattedPrice.isUp ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                  {formattedPrice.changeStr}
                </span>

                {/* Direction arrow */}
                {priceDirection === 'up' && <span className="text-[#26a69a] text-xs">▲</span>}
                {priceDirection === 'down' && <span className="text-[#ef5350] text-xs">▼</span>}

                {/* Market status indicator - Desktop/Tablet only */}
                {!isMobile && (
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
                )}

                {/* Last update timestamp - Desktop only */}
                {isDesktop && marketStatus.isOpen && lastUpdateDisplay && (
                  <span className="text-[10px] text-[var(--text-secondary)] ml-1">
                    {lastUpdateDisplay}
                  </span>
                )}

                {/* Next market event - Desktop only */}
                {isDesktop && !marketStatus.isOpen && (
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
                    {!isMobile && '연결중...'}
                  </>
                )}
                {priceStatus === 'error' && (
                  <>
                    <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                    {!isMobile && '오류'}
                  </>
                )}
                {priceStatus === 'disconnected' && (
                  <>
                    <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
                    {!isMobile && '연결 끊김'}
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      {isMobile && (
        <nav className="flex items-center justify-center gap-2 py-2 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <button
            onClick={() => setCurrentView('chart')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentView === 'chart'
                ? 'bg-[var(--accent-blue)] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}
          >
            차트
          </button>
          <button
            onClick={() => setCurrentView('screener')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentView === 'screener'
                ? 'bg-[var(--accent-blue)] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}
          >
            스크리너
          </button>
        </nav>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Main content (Chart or Screener) */}
        <div className="flex-1 flex flex-col min-w-0">
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

        {/* Right: Sidebar - Desktop/Tablet: inline, Mobile: overlay */}
        {!isMobile ? (
          <div className={sidebarWidth}>
            <Sidebar
              onStockSelect={handleStockSelect}
              selectedStock={selectedStock}
              onTradingLevelsChange={setTradingLevels}
            />
          </div>
        ) : (
          <>
            {/* Mobile overlay */}
            <div
              className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
              onClick={handleOverlayClick}
            />

            {/* Mobile sidebar */}
            <div className={`sidebar-mobile ${sidebarOpen ? 'open' : ''}`}>
              {/* Close button */}
              <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
                <span className="font-bold text-lg">메뉴</span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  ✕
                </button>
              </div>
              <div className="h-[calc(100%-60px)] overflow-auto">
                <Sidebar
                  onStockSelect={handleStockSelect}
                  selectedStock={selectedStock}
                  onTradingLevelsChange={setTradingLevels}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer: WHY panel (only show in chart view, hidden on mobile) */}
      {currentView === 'chart' && !isMobile && (
        <div className={`${isTablet ? 'h-12' : 'h-14'}`}>
          <WhyPanel symbol={selectedStock.symbol} market={selectedStock.market} />
        </div>
      )}

      {/* Mobile floating action button for sidebar */}
      {isMobile && currentView === 'chart' && !sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed bottom-4 right-4 z-30 w-14 h-14 bg-[var(--accent-blue)] text-white rounded-full shadow-lg flex items-center justify-center text-xl safe-bottom"
          aria-label="Open sidebar"
        >
          ☰
        </button>
      )}
    </div>
  );
}

export default App;
