import React, { useState, useEffect, useCallback } from 'react';

interface TradingConfig {
  intervalMinutes: number;
  symbols: string[];
  market: string;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  minConfluence: number;
  entryMode: 'MARKET' | 'LIMIT';
  limitPrice: number;
}

interface Position {
  symbol: string;
  market: string;
  quantity: number;
  avg_price: number;
  current_price: number;
  pnl: number;
  pnl_pct: number;
}

interface PendingOrder {
  symbol: string;
  market: string;
  quantity: number;
  target_price: number;
  reason: string;
  created_at: string;
  status: string;
}

interface TradingStatus {
  running: boolean;
  is_real: boolean;
  positions: Record<string, unknown>;
  pending_orders: Record<string, PendingOrder>;
  total_pnl: number;
  order_count: number;
  check_count?: number;
  signal_count?: number;
  last_check?: string;
  monitored_symbols: Array<{ symbol: string; market: string }>;
  strategy_params: {
    stop_loss: number;
    take_profit: number;
    position_size: number;
    min_confluence: number;
    entry_mode: string;
    limit_price: number;
  };
  stats?: {
    total_trades: number;
    wins: number;
    losses: number;
    win_rate: number;
    total_pnl: number;
  };
}

interface TradingPanelProps {
  market?: string;
}

export const TradingPanel: React.FC<TradingPanelProps> = ({ market = 'KR' }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<TradingConfig>({
    intervalMinutes: 5,
    symbols: ['005930', '000660'],
    market: market,
    stopLoss: 2.0,
    takeProfit: 5.0,
    positionSize: 10,
    minConfluence: 80,
    entryMode: 'MARKET',
    limitPrice: 50000
  });

  const [status, setStatus] = useState<TradingStatus | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<[string, PendingOrder][]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [customInterval, setCustomInterval] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8000/api/trading/status');
      if (response.ok) {
        const data: TradingStatus = await response.json();
        setStatus(data);
        setIsRunning(data.running);

        // Update pending orders
        if (data.pending_orders) {
          setPendingOrders(Object.entries(data.pending_orders));
        }

        if (data.running && data.strategy_params) {
          setConfig(prev => ({
            ...prev,
            stopLoss: data.strategy_params.stop_loss,
            takeProfit: data.strategy_params.take_profit,
            positionSize: data.strategy_params.position_size,
            minConfluence: data.strategy_params.min_confluence,
            entryMode: (data.strategy_params.entry_mode as 'MARKET' | 'LIMIT') || 'MARKET',
            limitPrice: data.strategy_params.limit_price || 0
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching status:', err);
    }
  }, []);

  // Fetch positions
  const fetchPositions = useCallback(async () => {
    if (!isRunning) return;

    try {
      const response = await fetch('http://localhost:8000/api/trading/positions');
      if (response.ok) {
        const data = await response.json();
        setPositions(data);
      }
    } catch (err) {
      console.error('Error fetching positions:', err);
    }
  }, [isRunning]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:8000/api/trading/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interval_minutes: config.intervalMinutes,
          symbols: config.symbols,
          market: config.market,
          stop_loss: config.stopLoss,
          take_profit: config.takeProfit,
          position_size: config.positionSize,
          min_confluence: config.minConfluence,
          entry_mode: config.entryMode,
          limit_price: config.limitPrice,
          use_real: false  // Always paper trading for safety
        })
      });

      if (response.ok) {
        setIsRunning(true);
        await fetchStatus();
      } else {
        const data = await response.json();
        setError(data.detail || 'Failed to start');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:8000/api/trading/stop', {
        method: 'POST'
      });

      if (response.ok) {
        setIsRunning(false);
        setPositions([]);
        setPendingOrders([]);
        await fetchStatus();
      } else {
        const data = await response.json();
        setError(data.detail || 'Failed to stop');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  };

  const addSymbol = () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (symbol && !config.symbols.includes(symbol)) {
      setConfig(prev => ({
        ...prev,
        symbols: [...prev.symbols, symbol]
      }));
      setNewSymbol('');
    }
  };

  const removeSymbol = (symbol: string) => {
    setConfig(prev => ({
      ...prev,
      symbols: prev.symbols.filter(s => s !== symbol)
    }));
  };

  const quickInterval = (minutes: number) => {
    setConfig(prev => ({ ...prev, intervalMinutes: minutes }));
    setCustomInterval('');
  };

  const setIntervalFromInput = () => {
    const minutes = parseInt(customInterval);
    if (minutes > 0 && minutes <= 1440) {
      setConfig(prev => ({ ...prev, intervalMinutes: minutes }));
    }
  };

  const totalPnL = status?.total_pnl || positions.reduce((sum, p) => sum + p.pnl, 0);
  const orderCount = status?.order_count || 0;

  return (
    <div className="bg-[#1e1e1e] rounded-lg p-4 text-gray-200 w-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <span>🤖</span> 자동매매
        </h3>
        <div className={`px-2 py-1 rounded text-xs font-semibold ${
          isRunning ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'
        }`}>
          {isRunning ? '● 실행 중' : '○ 중지'}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded p-2 mb-4 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Control Button */}
      <button
        onClick={isRunning ? handleStop : handleStart}
        disabled={isLoading || (!isRunning && config.symbols.length === 0)}
        className={`w-full py-3 rounded-md font-semibold text-base transition-colors mb-4 ${
          isRunning
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-green-500 hover:bg-green-600 text-white'
        } disabled:bg-gray-600 disabled:cursor-not-allowed`}
      >
        {isLoading ? '처리 중...' : isRunning ? '중지' : '시작'}
      </button>

      {/* Settings (only when stopped) */}
      {!isRunning && (
        <div className="bg-[#2a2a2a] rounded-md p-3 mb-4 space-y-4">
          {/* Interval - IMPROVED */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">체크 주기</label>
            {/* Quick buttons */}
            <div className="flex gap-1 mb-3">
              {[1, 5, 15, 30, 60].map(m => (
                <button
                  key={m}
                  onClick={() => quickInterval(m)}
                  className={`flex-1 py-1.5 text-xs rounded transition-all ${
                    config.intervalMinutes === m && !customInterval
                      ? 'bg-blue-500 text-white font-semibold'
                      : 'bg-[#3a3a3a] text-gray-300 border border-gray-600 hover:border-blue-400'
                  }`}
                >
                  {m}분
                </button>
              ))}
            </div>

            {/* Custom interval input - MORE VISIBLE */}
            <div className="mt-3 pt-3 border-t border-gray-700">
              <label className="block text-[10px] text-gray-500 mb-2 uppercase tracking-wider font-semibold">
                또는 직접 입력
              </label>
              <div className="flex items-center gap-2 bg-[#252525] p-2.5 rounded-md border-2 border-gray-700 focus-within:border-blue-500 transition-colors">
                <input
                  type="number"
                  placeholder="10"
                  value={customInterval}
                  onChange={(e) => setCustomInterval(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && setIntervalFromInput()}
                  min="1"
                  max="1440"
                  className="flex-1 px-3 py-2 bg-[#3a3a3a] border border-gray-600 rounded text-base text-white text-center font-semibold min-w-[70px] focus:outline-none focus:border-blue-400"
                />
                <span className="text-sm text-gray-400">분마다</span>
                <button
                  onClick={setIntervalFromInput}
                  disabled={!customInterval || parseInt(customInterval) < 1}
                  className="px-4 py-2 bg-blue-500 text-white rounded text-sm font-semibold hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                >
                  적용
                </button>
              </div>
              {customInterval && parseInt(customInterval) > 0 && (
                <div className="mt-2 px-3 py-1.5 bg-green-900/30 border-l-3 border-green-500 rounded text-xs text-green-400">
                  → {customInterval}분마다 체크
                </div>
              )}
              {/* Current setting indicator */}
              <div className="mt-2 text-xs text-gray-500">
                현재 설정: <span className="text-blue-400 font-semibold">{config.intervalMinutes}분</span>
              </div>
            </div>
          </div>

          {/* Entry Mode - NEW */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">진입 방식</label>
            <div className="space-y-2">
              <label
                className={`flex items-center gap-3 p-3 rounded-md cursor-pointer border-2 transition-all ${
                  config.entryMode === 'MARKET'
                    ? 'bg-blue-900/30 border-blue-500'
                    : 'bg-[#3a3a3a] border-gray-600 hover:border-blue-400'
                }`}
              >
                <input
                  type="radio"
                  name="entryMode"
                  value="MARKET"
                  checked={config.entryMode === 'MARKET'}
                  onChange={() => setConfig(prev => ({ ...prev, entryMode: 'MARKET' }))}
                  className="w-4 h-4 accent-blue-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>⚡</span> 시장가 (자동)
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">신호 발생 시 즉시 진입</div>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-md cursor-pointer border-2 transition-all ${
                  config.entryMode === 'LIMIT'
                    ? 'bg-blue-900/30 border-blue-500'
                    : 'bg-[#3a3a3a] border-gray-600 hover:border-blue-400'
                }`}
              >
                <input
                  type="radio"
                  name="entryMode"
                  value="LIMIT"
                  checked={config.entryMode === 'LIMIT'}
                  onChange={() => setConfig(prev => ({ ...prev, entryMode: 'LIMIT' }))}
                  className="w-4 h-4 accent-blue-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>🎯</span> 지정가 (대기)
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">목표가 도달 시 진입</div>
                </div>
              </label>
            </div>

            {/* Limit price input */}
            {config.entryMode === 'LIMIT' && (
              <div className="mt-3 flex items-center gap-2 bg-[#252525] p-2.5 rounded-md">
                <label className="text-xs text-gray-400 min-w-[50px]">목표가</label>
                <input
                  type="number"
                  value={config.limitPrice}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    limitPrice: parseFloat(e.target.value) || 0
                  }))}
                  placeholder="50000"
                  className="flex-1 px-3 py-2 bg-[#3a3a3a] border border-gray-600 rounded text-base text-white text-right font-semibold focus:outline-none focus:border-blue-400"
                />
                <span className="text-sm text-gray-400">원</span>
              </div>
            )}
          </div>

          {/* Symbols */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">모니터링 종목</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {config.symbols.map(symbol => (
                <div
                  key={symbol}
                  className="flex items-center gap-1 px-2 py-1 bg-[#3a3a3a] rounded text-xs"
                >
                  <span>{symbol}</span>
                  <button
                    onClick={() => removeSymbol(symbol)}
                    className="text-red-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="종목코드"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addSymbol()}
                className="flex-1 px-2 py-1 bg-[#3a3a3a] border border-gray-600 rounded text-xs text-white"
              />
              <button
                onClick={addSymbol}
                className="px-3 py-1 bg-blue-500 text-white rounded text-xs"
              >
                추가
              </button>
            </div>
          </div>

          {/* Strategy Params */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">전략 설정</label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-12">손절:</span>
                <input
                  type="number"
                  step="0.5"
                  value={config.stopLoss}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    stopLoss: parseFloat(e.target.value) || 0
                  }))}
                  className="flex-1 px-2 py-1 bg-[#3a3a3a] border border-gray-600 rounded text-xs text-white w-16"
                />
                <span className="text-xs text-gray-400">%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-12">익절:</span>
                <input
                  type="number"
                  step="0.5"
                  value={config.takeProfit}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    takeProfit: parseFloat(e.target.value) || 0
                  }))}
                  className="flex-1 px-2 py-1 bg-[#3a3a3a] border border-gray-600 rounded text-xs text-white w-16"
                />
                <span className="text-xs text-gray-400">%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-12">수량:</span>
                <input
                  type="number"
                  value={config.positionSize}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    positionSize: parseInt(e.target.value) || 1
                  }))}
                  className="flex-1 px-2 py-1 bg-[#3a3a3a] border border-gray-600 rounded text-xs text-white w-16"
                />
                <span className="text-xs text-gray-400">주</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Orders (when running with LIMIT mode) */}
      {isRunning && pendingOrders.length > 0 && (
        <div className="bg-[#2a2a2a] rounded-md p-3 mb-4">
          <h4 className="text-xs text-yellow-500 mb-2 flex items-center gap-1">
            <span>⏳</span> 대기 주문
          </h4>
          {pendingOrders.map(([symbol, order]) => (
            <div
              key={symbol}
              className="flex justify-between items-center bg-[#3a3a3a] rounded p-2 mb-1 last:mb-0 border-l-3 border-yellow-500"
            >
              <span className="font-semibold text-sm">{symbol}</span>
              <span className="text-xs text-yellow-400">
                목표: {order.target_price?.toLocaleString()}원
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Status */}
      <div className="bg-[#2a2a2a] rounded-md p-3 mb-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-400">포지션</span>
          <span className="text-sm font-semibold">{positions.length}개</span>
        </div>
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-400">총 손익</span>
          <span className={`text-sm font-semibold ${
            totalPnL >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {totalPnL >= 0 ? '+' : ''}{totalPnL.toLocaleString()}원
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-gray-400">주문 수</span>
          <span className="text-sm font-semibold">{orderCount}건</span>
        </div>
        {status?.check_count !== undefined && (
          <div className="flex justify-between mt-2 pt-2 border-t border-gray-700">
            <span className="text-xs text-gray-400">체크 횟수</span>
            <span className="text-xs">{status.check_count}회</span>
          </div>
        )}
        {status?.signal_count !== undefined && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-400">신호 감지</span>
            <span className="text-xs">{status.signal_count}회</span>
          </div>
        )}
        {isRunning && status?.strategy_params?.entry_mode && (
          <div className="flex justify-between mt-2 pt-2 border-t border-gray-700">
            <span className="text-xs text-gray-400">진입 방식</span>
            <span className="text-xs">
              {status.strategy_params.entry_mode === 'MARKET' ? '⚡ 시장가' : '🎯 지정가'}
            </span>
          </div>
        )}
      </div>

      {/* Positions */}
      {positions.length > 0 && (
        <div className="bg-[#2a2a2a] rounded-md p-3 mb-4">
          <h4 className="text-xs text-gray-400 mb-2">보유 포지션</h4>
          {positions.map(pos => (
            <div
              key={pos.symbol}
              className="bg-[#3a3a3a] rounded p-2 mb-2 last:mb-0"
            >
              <div className="flex justify-between mb-1">
                <span className="font-semibold text-sm">{pos.symbol}</span>
                <span className={`text-sm font-semibold ${
                  pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {pos.pnl >= 0 ? '+' : ''}{pos.pnl_pct.toFixed(2)}%
                </span>
              </div>
              <div className="flex gap-3 text-xs text-gray-400">
                <span>{pos.quantity}주</span>
                <span>평단: {pos.avg_price.toLocaleString()}</span>
                <span>현재: {pos.current_price.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warning */}
      <div className="bg-yellow-900/30 border border-yellow-600 rounded p-2 text-center text-xs text-yellow-500">
        ⚠️ 모의투자 모드 (실제 거래 아님)
      </div>
    </div>
  );
};

export default TradingPanel;
