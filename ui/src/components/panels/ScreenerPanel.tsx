import { useState } from 'react';
import { fetchScreen, scanMarket } from '../../api/client';
import type { ScreenResult, ScanResult, ScanSignalType } from '../../api/types';

interface ScreenerPanelProps {
  onStockSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}

type TabType = 'ema' | 'sma';

/**
 * Combined EMA and SMA Screener panel
 * - EMA tab: finds stocks where EMA20 is approaching EMA200 from below
 * - SMA tab: Full market SMA scanner (Golden Cross detection)
 */
export function ScreenerPanel({ onStockSelect, selectedSymbol }: ScreenerPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('sma');

  const tabs: { id: TabType; label: string; labelKo: string }[] = [
    { id: 'sma', label: 'SMA Scanner', labelKo: 'SMA 스캐너' },
    { id: 'ema', label: 'EMA Screen', labelKo: 'EMA 스크리너' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab Header */}
      <div className="flex border-b border-[var(--border-color)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)] bg-[var(--bg-tertiary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            {tab.labelKo}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'ema' && (
        <EMAScreenerTab onStockSelect={onStockSelect} selectedSymbol={selectedSymbol} />
      )}
      {activeTab === 'sma' && (
        <SMAScreenerTab onStockSelect={onStockSelect} selectedSymbol={selectedSymbol} />
      )}
    </div>
  );
}

/**
 * Original EMA Screener tab
 */
function EMAScreenerTab({
  onStockSelect,
  selectedSymbol,
}: {
  onStockSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}) {
  const [market, setMarket] = useState('KR');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<ScreenResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    setIsSearching(true);
    setError(null);

    try {
      const response = await fetchScreen(market, 20);
      setResults(response.candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleItemClick = (item: ScreenResult) => {
    onStockSelect(item.symbol, item.market);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="font-semibold">EMA Screener</div>
        <div className="text-xs text-[var(--text-secondary)]">EMA20/200 크로스 탐지</div>
      </div>

      {/* Search controls */}
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex gap-2 mb-2">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-sm"
          >
            <option value="KR">KR (한국)</option>
            <option value="US">US (미국)</option>
          </select>
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="px-4 py-1 bg-[var(--accent-blue)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {isSearching ? '검색중...' : 'Search'}
          </button>
        </div>
        <div className="text-xs text-[var(--text-secondary)]">
          EMA20이 EMA200 아래에서 접근하는 종목
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-3 text-[var(--accent-red)] text-sm">
            Error: {error}
          </div>
        )}
        {!results && !error ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            Search 버튼을 클릭하세요
          </div>
        ) : results && results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            조건에 맞는 종목이 없습니다
          </div>
        ) : results ? (
          results.map((item) => {
            const isSelected = item.symbol === selectedSymbol;
            return (
              <div
                key={item.symbol}
                onClick={() => handleItemClick(item)}
                className={`px-3 py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors
                  ${isSelected
                    ? 'bg-[var(--accent-blue)] bg-opacity-20 border-l-2 border-l-[var(--accent-blue)]'
                    : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className={`font-medium ${isSelected ? 'text-[var(--accent-blue)]' : ''}`}>
                      {item.symbol}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">{item.market}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[var(--accent-green)] font-medium">{item.score}</div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {item.days_to_cross}일 후 크로스
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 bg-[var(--bg-tertiary)] rounded-full h-1.5">
                    <div
                      className="bg-[var(--accent-green)] h-1.5 rounded-full"
                      style={{ width: `${item.score}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)]">
                    Gap: {(item.gap * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  EMA20: {item.ema20.toLocaleString(undefined, { maximumFractionDigits: 0 })} |
                  EMA200: {item.ema200.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
            );
          })
        ) : null}
      </div>
    </div>
  );
}

/**
 * SMA Scanner tab - Full market Golden Cross detection
 */
function SMAScreenerTab({
  onStockSelect,
  selectedSymbol,
}: {
  onStockSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}) {
  const [market, setMarket] = useState('US');
  const [signalType, setSignalType] = useState<ScanSignalType>('golden_cross');
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[] | null>(null);
  const [scanInfo, setScanInfo] = useState<{
    symbolsScanned: number;
    signalsFound: number;
    scanDuration: number;
    cached: boolean;
    cacheAge: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async (forceRefresh: boolean = false) => {
    setIsScanning(true);
    setError(null);

    try {
      const response = await scanMarket(market, [signalType], forceRefresh);
      setResults(response.results);
      setScanInfo({
        symbolsScanned: response.symbols_scanned,
        signalsFound: response.signals_found,
        scanDuration: response.scan_duration_seconds,
        cached: response.cached,
        cacheAge: response.cache_age_minutes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResults(null);
      setScanInfo(null);
    } finally {
      setIsScanning(false);
    }
  };

  const handleItemClick = (item: ScanResult) => {
    onStockSelect(item.symbol, item.market);
  };

  const signalTypeLabels: Record<ScanSignalType, { label: string; labelKo: string; color: string }> = {
    golden_cross: { label: 'Golden Cross', labelKo: '골든 크로스', color: 'var(--accent-green)' },
    death_cross: { label: 'Death Cross', labelKo: '데스 크로스', color: 'var(--accent-red)' },
    bullish_alignment: { label: 'Bullish', labelKo: '상승 정렬', color: 'var(--accent-green)' },
    bearish_alignment: { label: 'Bearish', labelKo: '하락 정렬', color: 'var(--accent-red)' },
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="font-semibold">SMA Scanner</div>
        <div className="text-xs text-[var(--text-secondary)]">SMA20/200 전시장 스캔</div>
      </div>

      {/* Scan controls */}
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex gap-2 mb-2">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-sm"
          >
            <option value="US">US (미국)</option>
            <option value="KR">KR (한국)</option>
          </select>
          <select
            value={signalType}
            onChange={(e) => setSignalType(e.target.value as ScanSignalType)}
            className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-sm"
          >
            <option value="golden_cross">Golden Cross</option>
            <option value="death_cross">Death Cross</option>
            <option value="bullish_alignment">Bullish Trend</option>
            <option value="bearish_alignment">Bearish Trend</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleScan(false)}
            disabled={isScanning}
            className="flex-1 px-4 py-1.5 bg-[var(--accent-blue)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {isScanning ? 'Scanning...' : 'Scan'}
          </button>
          <button
            onClick={() => handleScan(true)}
            disabled={isScanning}
            className="px-3 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-sm hover:bg-[var(--bg-secondary)]"
            title="Refresh (ignore cache)"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Scan info */}
      {scanInfo && (
        <div className="px-3 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
          <div className="flex justify-between text-xs text-[var(--text-secondary)]">
            <span>
              {scanInfo.signalsFound} signals / {scanInfo.symbolsScanned} symbols
            </span>
            <span>
              {scanInfo.cached ? `Cached (${scanInfo.cacheAge}m ago)` : `${scanInfo.scanDuration.toFixed(1)}s`}
            </span>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-3 text-[var(--accent-red)] text-sm">
            Error: {error}
          </div>
        )}
        {!results && !error ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm p-4 text-center">
            Scan 버튼을 클릭하여<br />전체 시장을 스캔하세요
          </div>
        ) : results && results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm p-4 text-center">
            {signalTypeLabels[signalType].labelKo} 신호가<br />발견되지 않았습니다
          </div>
        ) : results ? (
          results.map((item) => {
            const isSelected = item.symbol === selectedSymbol;
            const signalInfo = signalTypeLabels[item.signal_type as ScanSignalType];
            return (
              <div
                key={item.symbol}
                onClick={() => handleItemClick(item)}
                className={`px-3 py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors
                  ${isSelected
                    ? 'bg-[var(--accent-blue)] bg-opacity-20 border-l-2 border-l-[var(--accent-blue)]'
                    : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${isSelected ? 'text-[var(--accent-blue)]' : ''}`}>
                        {item.symbol}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: `${signalInfo.color}20`,
                          color: signalInfo.color,
                        }}
                      >
                        {signalInfo.label}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {item.market} | ${item.current_price.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="font-medium"
                      style={{
                        color: item.price_change_pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                      }}
                    >
                      {item.price_change_pct >= 0 ? '+' : ''}{item.price_change_pct.toFixed(2)}%
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      Vol: {item.volume_ratio.toFixed(1)}x
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex justify-between text-xs text-[var(--text-secondary)]">
                  <span>SMA20: {item.sma20.toFixed(2)}</span>
                  <span>SMA200: {item.sma200.toFixed(2)}</span>
                  {item.days_since_cross > 0 && (
                    <span className="text-[var(--accent-blue)]">
                      {item.days_since_cross}일 전
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : null}
      </div>
    </div>
  );
}
