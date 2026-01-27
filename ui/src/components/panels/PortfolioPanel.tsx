import { useState, useEffect } from 'react';
import { fetchPortfolio, addHolding, removeHolding } from '../../api/client';
import type { PortfolioHolding, PortfolioResponse } from '../../api/types';

interface PortfolioPanelProps {
  onStockSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}

/**
 * Portfolio panel - 나의 포트폴리오
 */
export function PortfolioPanel({ onStockSelect, selectedSymbol }: PortfolioPanelProps) {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Add form state
  const [addSymbol, setAddSymbol] = useState('');
  const [addMarket, setAddMarket] = useState('KR');
  const [addQuantity, setAddQuantity] = useState('');
  const [addAvgPrice, setAddAvgPrice] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Load portfolio on mount
  useEffect(() => {
    loadPortfolio();
  }, []);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const data = await fetchPortfolio();
      setPortfolio(data);
    } catch (err) {
      console.error('Failed to load portfolio:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = (holding: PortfolioHolding) => {
    onStockSelect(holding.symbol, holding.market);
  };

  const handleDelete = async (e: React.MouseEvent, holding: PortfolioHolding) => {
    e.stopPropagation();
    if (!confirm(`${holding.symbol}을(를) 포트폴리오에서 삭제하시겠습니까?`)) return;

    try {
      await removeHolding(holding.symbol, holding.market);
      await loadPortfolio();
    } catch (err) {
      alert(`삭제 실패: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleAddSubmit = async () => {
    if (!addSymbol.trim() || !addQuantity || !addAvgPrice) return;

    const quantity = parseFloat(addQuantity);
    const avgPrice = parseFloat(addAvgPrice);

    if (isNaN(quantity) || quantity <= 0) {
      setAddError('수량은 0보다 커야 합니다');
      return;
    }
    if (isNaN(avgPrice) || avgPrice <= 0) {
      setAddError('평단가는 0보다 커야 합니다');
      return;
    }

    setAdding(true);
    setAddError(null);

    try {
      const result = await addHolding(addSymbol.trim(), addMarket, quantity, avgPrice);
      if (result.success) {
        setShowAddModal(false);
        setAddSymbol('');
        setAddQuantity('');
        setAddAvgPrice('');
        await loadPortfolio();
      } else {
        setAddError(result.message);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  const formatCurrency = (value: number, market: string) => {
    if (market === 'KR') {
      return `₩${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const krHoldings = portfolio?.holdings.filter(h => h.market === 'KR') || [];
  const usHoldings = portfolio?.holdings.filter(h => h.market === 'US') || [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="font-semibold">나의 포트폴리오</div>
        <div className="text-xs text-[var(--text-secondary)]">
          Portfolio ({portfolio?.holdings.length || 0})
        </div>
      </div>

      {/* Summary */}
      {portfolio && (
        <div className="px-3 py-2 border-b border-[var(--border-color)] text-sm">
          {portfolio.total_kr_value > 0 && (
            <div className="flex justify-between items-center mb-1">
              <span className="text-[var(--text-secondary)]">KR 총액</span>
              <div className="text-right">
                <span className="font-medium">₩{portfolio.total_kr_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className={`ml-2 text-xs ${portfolio.total_kr_pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                  {portfolio.total_kr_pnl >= 0 ? '+' : ''}₩{portfolio.total_kr_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          )}
          {portfolio.total_us_value > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-[var(--text-secondary)]">US 총액</span>
              <div className="text-right">
                <span className="font-medium">${portfolio.total_us_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className={`ml-2 text-xs ${portfolio.total_us_pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                  {portfolio.total_us_pnl >= 0 ? '+' : ''}${portfolio.total_us_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Holdings list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            로딩중...
          </div>
        ) : !portfolio || portfolio.holdings.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            보유 종목이 없습니다
          </div>
        ) : (
          <>
            {/* KR Holdings */}
            {krHoldings.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
                  한국 (KR)
                </div>
                {krHoldings.map((holding) => (
                  <HoldingItem
                    key={`${holding.market}-${holding.symbol}`}
                    holding={holding}
                    isSelected={holding.symbol === selectedSymbol}
                    onClick={() => handleItemClick(holding)}
                    onDelete={(e) => handleDelete(e, holding)}
                    formatCurrency={formatCurrency}
                  />
                ))}
              </>
            )}

            {/* US Holdings */}
            {usHoldings.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
                  미국 (US)
                </div>
                {usHoldings.map((holding) => (
                  <HoldingItem
                    key={`${holding.market}-${holding.symbol}`}
                    holding={holding}
                    isSelected={holding.symbol === selectedSymbol}
                    onClick={() => handleItemClick(holding)}
                    onDelete={(e) => handleDelete(e, holding)}
                    formatCurrency={formatCurrency}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Add button */}
      <div className="px-3 py-2 border-t border-[var(--border-color)]">
        <button
          onClick={() => setShowAddModal(true)}
          className="w-full py-1.5 text-sm text-[var(--accent-blue)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)]"
        >
          + 종목 추가
        </button>
      </div>

      {/* Add Holding Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4 w-80">
            <h3 className="font-semibold mb-4">포트폴리오 종목 추가</h3>

            <div className="mb-3">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                종목 코드
              </label>
              <input
                type="text"
                value={addSymbol}
                onChange={(e) => setAddSymbol(e.target.value.toUpperCase())}
                placeholder="예: 005930, AAPL"
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
                autoFocus
              />
            </div>

            <div className="mb-3">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                시장
              </label>
              <select
                value={addMarket}
                onChange={(e) => setAddMarket(e.target.value)}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
              >
                <option value="KR">KR (한국)</option>
                <option value="US">US (미국)</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                보유수량
              </label>
              <input
                type="number"
                value={addQuantity}
                onChange={(e) => setAddQuantity(e.target.value)}
                placeholder="예: 100"
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                평단가 {addMarket === 'KR' ? '(원)' : '(USD)'}
              </label>
              <input
                type="number"
                value={addAvgPrice}
                onChange={(e) => setAddAvgPrice(e.target.value)}
                placeholder={addMarket === 'KR' ? '예: 54000' : '예: 150.50'}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
              />
            </div>

            {addError && (
              <div className="mb-3 text-sm text-[var(--accent-red)]">
                {addError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddSymbol('');
                  setAddQuantity('');
                  setAddAvgPrice('');
                  setAddError(null);
                }}
                className="flex-1 py-2 text-sm border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)]"
              >
                취소
              </button>
              <button
                onClick={handleAddSubmit}
                disabled={adding || !addSymbol.trim() || !addQuantity || !addAvgPrice}
                className="flex-1 py-2 text-sm bg-[var(--accent-blue)] text-white rounded hover:opacity-90 disabled:opacity-50"
              >
                {adding ? '추가중...' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Separate component for holding item
interface HoldingItemProps {
  holding: PortfolioHolding;
  isSelected: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  formatCurrency: (value: number, market: string) => string;
}

function HoldingItem({ holding, isSelected, onClick, onDelete, formatCurrency }: HoldingItemProps) {
  const isProfitable = holding.pnl_amount >= 0;

  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors group
        ${isSelected
          ? 'bg-[var(--accent-blue)] bg-opacity-20 border-l-2 border-l-[var(--accent-blue)]'
          : 'hover:bg-[var(--bg-tertiary)]'
        }`}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className={`font-medium ${isSelected ? 'text-[var(--accent-blue)]' : ''}`}>
            {holding.symbol}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            {holding.quantity}주 @ {formatCurrency(holding.avg_price, holding.market)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-medium">
            {formatCurrency(holding.current_price, holding.market)}
          </div>
          <div className={`text-xs ${isProfitable ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {isProfitable ? '+' : ''}{holding.pnl_percent.toFixed(2)}%
          </div>
        </div>
        <button
          onClick={onDelete}
          className="ml-2 opacity-0 group-hover:opacity-100 text-[var(--accent-red)] text-xs px-2 py-1 hover:bg-[var(--accent-red)] hover:bg-opacity-20 rounded transition-opacity"
        >
          삭제
        </button>
      </div>
      <div className="flex justify-between items-center mt-1 text-xs">
        <span className="text-[var(--text-secondary)]">
          평가금액: {formatCurrency(holding.total_value, holding.market)}
        </span>
        <span className={isProfitable ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
          {isProfitable ? '+' : ''}{formatCurrency(holding.pnl_amount, holding.market)}
        </span>
      </div>
    </div>
  );
}
