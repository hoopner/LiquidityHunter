"""
OHLCV v2 Router

Thin FastAPI router that delegates to MarketDataService.
Mounted at /v2/ohlcv alongside the legacy /ohlcv endpoint.
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from engine.services.market_data_service import MarketDataService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["ohlcv-v2"])

# Single shared service instance (stateless, safe to reuse)
_service = MarketDataService()


@router.get("/ohlcv")
def get_ohlcv(
    symbol: str = Query(..., description="Stock ticker (e.g., 005930, AAPL)"),
    market: str = Query(..., description="KR or US"),
    tf: str = Query(..., description="Timeframe: 1m, 5m, 15m, 1h, 1D, 1W, 1M"),
):
    """
    Fetch OHLCV data with all technical indicators.

    This is the v2 endpoint using the repository pattern.
    The legacy /ohlcv endpoint remains unchanged.
    """
    print(f"[v2/ohlcv] Request: symbol={symbol}, market={market}, tf={tf}")
    try:
        result = _service.get_ohlcv(
            symbol=symbol,
            market=market,
            timeframe=tf,
        )
        return result

    except Exception as e:
        logger.error(f"[v2/ohlcv] Error for {symbol} {market} {tf}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch OHLCV data: {str(e)}",
        )
