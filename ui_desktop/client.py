"""HTTP client for calling localhost FastAPI endpoints.

This module handles all communication with the backend server.
"""

import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import requests
from requests.exceptions import ConnectionError, Timeout, RequestException

from .models import AnalyzeResult, ScreenResponse, ServerHealth


@dataclass
class ClientResult:
    """Result of an API call."""

    success: bool
    data: Optional[ScreenResponse] = None
    error: Optional[str] = None
    response_time_ms: float = 0.0


@dataclass
class AnalyzeClientResult:
    """Result of an /analyze API call."""

    success: bool
    data: Optional[AnalyzeResult] = None
    error: Optional[str] = None
    response_time_ms: float = 0.0
    from_cache: bool = False


class AnalysisCache:
    """In-memory session cache for analysis results.

    Cache key: (symbol, market)
    No persistence - cleared when app restarts.
    """

    def __init__(self):
        self._cache: Dict[Tuple[str, str], AnalyzeResult] = {}

    def get(self, symbol: str, market: str) -> Optional[AnalyzeResult]:
        """Get cached result if available."""
        return self._cache.get((symbol, market))

    def put(self, symbol: str, market: str, result: AnalyzeResult) -> None:
        """Store result in cache."""
        self._cache[(symbol, market)] = result

    def clear(self) -> None:
        """Clear all cached results."""
        self._cache.clear()

    def remove(self, symbol: str, market: str) -> None:
        """Remove a specific entry from cache."""
        self._cache.pop((symbol, market), None)

    @property
    def size(self) -> int:
        """Number of cached entries."""
        return len(self._cache)

    def has(self, symbol: str, market: str) -> bool:
        """Check if result is cached."""
        return (symbol, market) in self._cache


class LHClient:
    """HTTP client for LiquidityHunter API."""

    def __init__(self, base_url: str = "http://127.0.0.1:8000"):
        self.base_url = base_url
        self.timeout = 30  # seconds
        self.analysis_cache = AnalysisCache()

    def fetch_screen(self, market: str, top_n: int = 20) -> ClientResult:
        """Fetch screening results for a market.

        Args:
            market: Market code (KR or US)
            top_n: Maximum number of candidates to return

        Returns:
            ClientResult with either data or error message
        """
        url = f"{self.base_url}/screen"
        params = {"market": market, "top_n": top_n}

        start_time = time.time()
        try:
            response = requests.get(url, params=params, timeout=self.timeout)
            elapsed_ms = (time.time() - start_time) * 1000
            response.raise_for_status()
            data = response.json()
            return ClientResult(
                success=True,
                data=ScreenResponse.from_dict(data),
                response_time_ms=elapsed_ms,
            )
        except ConnectionError:
            elapsed_ms = (time.time() - start_time) * 1000
            return ClientResult(
                success=False,
                error="Connection failed: Is the server running on port 8000?",
                response_time_ms=elapsed_ms,
            )
        except Timeout:
            elapsed_ms = (time.time() - start_time) * 1000
            return ClientResult(
                success=False,
                error=f"Request timed out after {self.timeout}s",
                response_time_ms=elapsed_ms,
            )
        except RequestException as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return ClientResult(
                success=False,
                error=f"Request error: {e}",
                response_time_ms=elapsed_ms,
            )
        except (KeyError, ValueError) as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return ClientResult(
                success=False,
                error=f"Invalid response format: {e}",
                response_time_ms=elapsed_ms,
            )

    def fetch_analyze(
        self,
        symbol: str,
        market: str,
        bar_index: int = -1,
        use_cache: bool = True,
    ) -> AnalyzeClientResult:
        """Fetch OB analysis for a symbol.

        Args:
            symbol: Stock symbol
            market: Market code (KR or US)
            bar_index: Bar index to analyze (-1 for latest)
            use_cache: Whether to use cached results

        Returns:
            AnalyzeClientResult with analysis data or error
        """
        # Check cache first
        if use_cache:
            cached = self.analysis_cache.get(symbol, market)
            if cached is not None:
                return AnalyzeClientResult(
                    success=True,
                    data=cached,
                    response_time_ms=0.0,
                    from_cache=True,
                )

        url = f"{self.base_url}/analyze"
        params = {
            "symbol": symbol,
            "tf": "1D",
            "bar_index": bar_index,
            "market": market,
        }

        start_time = time.time()
        try:
            response = requests.get(url, params=params, timeout=self.timeout)
            elapsed_ms = (time.time() - start_time) * 1000

            if response.status_code == 404:
                return AnalyzeClientResult(
                    success=False,
                    error=f"Data not found for {symbol} in {market}",
                    response_time_ms=elapsed_ms,
                )

            if response.status_code == 400:
                error_detail = response.json().get("detail", "Bad request")
                return AnalyzeClientResult(
                    success=False,
                    error=f"Invalid request: {error_detail}",
                    response_time_ms=elapsed_ms,
                )

            response.raise_for_status()
            data = response.json()
            result = AnalyzeResult.from_dict(data)

            # Cache the result
            self.analysis_cache.put(symbol, market, result)

            return AnalyzeClientResult(
                success=True,
                data=result,
                response_time_ms=elapsed_ms,
                from_cache=False,
            )
        except ConnectionError:
            elapsed_ms = (time.time() - start_time) * 1000
            return AnalyzeClientResult(
                success=False,
                error="Server unavailable",
                response_time_ms=elapsed_ms,
            )
        except Timeout:
            elapsed_ms = (time.time() - start_time) * 1000
            return AnalyzeClientResult(
                success=False,
                error=f"Request timed out after {self.timeout}s",
                response_time_ms=elapsed_ms,
            )
        except RequestException as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return AnalyzeClientResult(
                success=False,
                error=f"Request error: {e}",
                response_time_ms=elapsed_ms,
            )
        except (KeyError, ValueError) as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return AnalyzeClientResult(
                success=False,
                error=f"Invalid response format: {e}",
                response_time_ms=elapsed_ms,
            )

    def clear_analysis_cache(self) -> int:
        """Clear the analysis cache.

        Returns:
            Number of entries cleared
        """
        count = self.analysis_cache.size
        self.analysis_cache.clear()
        return count

    def check_health(self) -> ServerHealth:
        """Check if the server is reachable with detailed health info.

        Returns:
            ServerHealth with detailed status information
        """
        start_time = time.time()
        try:
            response = requests.get(f"{self.base_url}/", timeout=5)
            elapsed_ms = (time.time() - start_time) * 1000
            if response.status_code == 200:
                return ServerHealth(
                    is_healthy=True,
                    status_code=response.status_code,
                    response_time_ms=elapsed_ms,
                    message="Server is healthy",
                    base_url=self.base_url,
                )
            return ServerHealth(
                is_healthy=False,
                status_code=response.status_code,
                response_time_ms=elapsed_ms,
                message=f"Unexpected status code: {response.status_code}",
                base_url=self.base_url,
            )
        except ConnectionError:
            elapsed_ms = (time.time() - start_time) * 1000
            return ServerHealth(
                is_healthy=False,
                status_code=None,
                response_time_ms=elapsed_ms,
                message="Connection refused - server not running",
                base_url=self.base_url,
            )
        except Timeout:
            elapsed_ms = (time.time() - start_time) * 1000
            return ServerHealth(
                is_healthy=False,
                status_code=None,
                response_time_ms=elapsed_ms,
                message="Connection timed out",
                base_url=self.base_url,
            )
        except RequestException as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return ServerHealth(
                is_healthy=False,
                status_code=None,
                response_time_ms=elapsed_ms,
                message=str(e),
                base_url=self.base_url,
            )

    def test_endpoint(self, endpoint: str) -> ServerHealth:
        """Test a specific endpoint.

        Args:
            endpoint: Endpoint path (e.g., "/screen")

        Returns:
            ServerHealth with test results
        """
        url = f"{self.base_url}{endpoint}"
        start_time = time.time()
        try:
            # Use HEAD if possible, fall back to GET
            response = requests.head(url, timeout=5)
            if response.status_code == 405:  # Method not allowed, try GET
                response = requests.get(url, timeout=5)
            elapsed_ms = (time.time() - start_time) * 1000
            return ServerHealth(
                is_healthy=response.status_code < 500,
                status_code=response.status_code,
                response_time_ms=elapsed_ms,
                message=f"Endpoint {endpoint}: HTTP {response.status_code}",
                base_url=url,
            )
        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return ServerHealth(
                is_healthy=False,
                status_code=None,
                response_time_ms=elapsed_ms,
                message=str(e),
                base_url=url,
            )
