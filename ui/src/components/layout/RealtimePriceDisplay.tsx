/**
 * Real-time price display component for header
 *
 * ARCHITECTURE:
 * - Uses useRealtimePrice hook for HTTP polling
 * - Polls every 5 seconds for latest price
 * - Displays connection status and price with color coding
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRealtimePrice, type RealtimePrice } from '../../hooks/useRealtimePrice';

interface RealtimePriceDisplayProps {
  symbol: string;
  market: string;
  onPriceUpdate?: (price: RealtimePrice) => void;
}

export function RealtimePriceDisplay({
  symbol,
  market,
  onPriceUpdate,
}: RealtimePriceDisplayProps) {
  // Track current symbol to validate price updates
  const currentSymbolRef = useRef(symbol);

  // Update ref when symbol changes
  useEffect(() => {
    console.log('[RealtimePriceDisplay] Symbol changed:', { from: currentSymbolRef.current, to: symbol });
    currentSymbolRef.current = symbol;
  }, [symbol]);

  // Wrapper for onPriceUpdate that validates symbol
  const handlePriceUpdate = useCallback((priceData: RealtimePrice) => {
    if (priceData.symbol && priceData.symbol !== currentSymbolRef.current) {
      return;
    }
    onPriceUpdate?.(priceData);
  }, [onPriceUpdate]);

  const { price, isExtended, lastUpdate, status, direction } = useRealtimePrice(
    symbol,
    market,
    { enabled: true, onPriceUpdate: handlePriceUpdate }
  );

  // Flash animation state
  const [isFlashing, setIsFlashing] = useState(false);

  // Trigger flash animation on price change
  useEffect(() => {
    if (price && direction !== 'unchanged') {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 300);
      return () => clearTimeout(timer);
    }
  }, [price?.price, direction]);

  // Format price based on market
  const formatPrice = (value: number) => {
    if (market === 'KR') {
      return value.toLocaleString('ko-KR');
    }
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Get status indicator
  const getStatusIndicator = () => {
    switch (status) {
      case 'connected':
        return (
          <span
            className={`w-2 h-2 rounded-full ${
              isFlashing
                ? direction === 'up'
                  ? 'bg-green-400'
                  : direction === 'down'
                  ? 'bg-red-400'
                  : 'bg-green-500'
                : 'bg-green-500'
            } ${status === 'connected' ? 'animate-pulse' : ''}`}
          />
        );
      case 'connecting':
        return (
          <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
        );
      case 'error':
        return <span className="w-2 h-2 rounded-full bg-red-500" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-gray-500" />;
    }
  };

  // Get status text
  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return isExtended ? '장외' : '실시간';
      case 'connecting':
        return '연결중...';
      case 'error':
        return '오류';
      default:
        return '연결 끊김';
    }
  };

  // Get price color class based on direction (Korean: red = up, blue = down)
  const getPriceColorClass = () => {
    if (!price) return 'text-[var(--text-primary)]';
    if (direction === 'up') return 'text-red-500';
    if (direction === 'down') return 'text-blue-500';
    return 'text-[var(--text-primary)]';
  };

  // Get flash class
  const getFlashClass = () => {
    if (!isFlashing) return '';
    if (direction === 'up') return 'bg-red-500/20';
    if (direction === 'down') return 'bg-blue-500/20';
    return '';
  };

  // Check if price is valid (non-zero)
  const hasValidPrice = price !== null && price.price > 0;

  return (
    <div className="flex items-center gap-3">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        {getStatusIndicator()}
        <span
          className={`text-xs font-medium ${
            status === 'connected' && hasValidPrice
              ? isExtended ? 'text-yellow-500' : 'text-green-500'
              : status === 'connecting'
              ? 'text-yellow-500'
              : status === 'error'
              ? 'text-red-500'
              : 'text-gray-500'
          }`}
        >
          {getStatusText()}
        </span>
      </div>

      {/* Price display - only show if valid price */}
      {hasValidPrice && (
        <div
          className={`flex items-center gap-2 px-2 py-0.5 rounded transition-colors duration-300 ${getFlashClass()}`}
        >
          {/* Current price */}
          <span
            className={`font-mono font-bold text-base ${getPriceColorClass()} transition-colors duration-150`}
          >
            {market === 'KR' ? '₩' : '$'}
            {formatPrice(price.price)}
          </span>

          {/* Extended hours badge */}
          {isExtended && (
            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500 text-white rounded font-bold">
              장외
            </span>
          )}

          {/* Last update time */}
          {lastUpdate && (
            <span className="text-xs text-gray-500">
              {lastUpdate.toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </span>
          )}
        </div>
      )}

      {/* Loading state */}
      {!price && status === 'connecting' && (
        <span className="text-xs text-[var(--text-tertiary)]">
          가격 로딩중...
        </span>
      )}

      {/* No price available */}
      {status === 'connected' && !hasValidPrice && (
        <span className="text-xs text-yellow-500">
          {symbol} - 데이터 없음
        </span>
      )}

      {/* Error state */}
      {status === 'error' && (
        <span className="text-xs text-red-500">
          {symbol} - 연결 실패
        </span>
      )}
    </div>
  );
}
