import { useState, useEffect } from 'react';
import { fetchWatchlist, addToWatchlist, removeFromWatchlist } from '../../api/client';
import type { WatchlistItem } from '../../api/types';

interface WatchlistPanelProps {
  onStockSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}

/**
 * Watchlist panel - 관심리스트
 */
export function WatchlistPanel({ onStockSelect, selectedSymbol }: WatchlistPanelProps) {
  const [watchlistKR, setWatchlistKR] = useState<WatchlistItem[]>([]);
  const [watchlistUS, setWatchlistUS] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSymbol, setAddSymbol] = useState('');
  const [addMarket, setAddMarket] = useState('KR');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Load watchlists on mount
  useEffect(() => {
    loadWatchlists();
  }, []);

  const loadWatchlists = async () => {
    setLoading(true);
    try {
      const [kr, us] = await Promise.all([
        fetchWatchlist('KR'),
        fetchWatchlist('US'),
      ]);
      setWatchlistKR(kr.symbols);
      setWatchlistUS(us.symbols);
    } catch (err) {
      console.error('Failed to load watchlists:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = (item: WatchlistItem) => {
    onStockSelect(item.symbol, item.market);
  };

  const handleDelete = async (e: React.MouseEvent, item: WatchlistItem) => {
    e.stopPropagation();
    if (!confirm(`${item.symbol}을(를) 관심리스트에서 삭제하시겠습니까?`)) return;

    try {
      await removeFromWatchlist(item.symbol, item.market);
      await loadWatchlists();
    } catch (err) {
      alert(`삭제 실패: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleAddSubmit = async () => {
    if (!addSymbol.trim()) return;

    setAdding(true);
    setAddError(null);

    try {
      const result = await addToWatchlist(addSymbol.trim(), addMarket);
      if (result.success) {
        setShowAddModal(false);
        setAddSymbol('');
        await loadWatchlists();
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  const allItems = [
    ...watchlistKR,
    ...watchlistUS,
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex justify-between items-center">
        <div>
          <div className="font-semibold">관심리스트</div>
          <div className="text-xs text-[var(--text-secondary)]">
            Watchlist ({allItems.length})
          </div>
        </div>
      </div>

      {/* Watchlist items */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            로딩중...
          </div>
        ) : allItems.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
            관심 종목이 없습니다
          </div>
        ) : (
          allItems.map((item) => {
            const isSelected = item.symbol === selectedSymbol;
            return (
              <div
                key={`${item.market}-${item.symbol}`}
                onClick={() => handleItemClick(item)}
                className={`px-3 py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors group
                  ${isSelected
                    ? 'bg-[var(--accent-blue)] bg-opacity-20 border-l-2 border-l-[var(--accent-blue)]'
                    : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <div className={`font-medium ${isSelected ? 'text-[var(--accent-blue)]' : ''}`}>
                      {item.symbol}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {item.market}
                      {item.has_data && (
                        <span className="ml-1 opacity-60">({item.bar_count} bars)</span>
                      )}
                      {!item.has_data && (
                        <span className="ml-1 text-[var(--accent-red)]">(no data)</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, item)}
                    className="opacity-0 group-hover:opacity-100 text-[var(--accent-red)] text-xs px-2 py-1 hover:bg-[var(--accent-red)] hover:bg-opacity-20 rounded transition-opacity"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })
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

      {/* Add Symbol Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4 w-80">
            <h3 className="font-semibold mb-4">종목 추가</h3>

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

            <div className="mb-4">
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
                  setAddError(null);
                }}
                className="flex-1 py-2 text-sm border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)]"
              >
                취소
              </button>
              <button
                onClick={handleAddSubmit}
                disabled={adding || !addSymbol.trim()}
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
