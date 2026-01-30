"""
Korea Investment & Securities (한국투자증권) API Client

API Documentation: https://apiportal.koreainvestment.com/

Features:
- OAuth token management with auto-refresh
- Korean stock (domestic) OHLCV data
- US stock (overseas) OHLCV data
- Real-time price (WebSocket - future)
"""

import os
import time
import json
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any, Tuple
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class KISAPIError(Exception):
    """KIS API Error"""
    def __init__(self, message: str, code: str = "", details: str = ""):
        self.message = message
        self.code = code
        self.details = details
        super().__init__(f"[{code}] {message}: {details}" if code else message)


class KISClient:
    """
    Korea Investment & Securities API Client

    Usage:
        client = KISClient()
        price = client.get_current_price("005930", "KR")
        ohlcv = client.get_ohlcv("005930", "KR", "1D", count=100)
    """

    # Base URLs
    BASE_URL_REAL = "https://openapi.koreainvestment.com:9443"
    BASE_URL_MOCK = "https://openapivts.koreainvestment.com:29443"

    # Timeframe mapping (our format -> KIS format)
    TIMEFRAME_MAP = {
        "1m": "1",
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "1h": "60",
        "1H": "60",
        "1D": "D",
        "1d": "D",
        "1W": "W",
        "1w": "W",
        "1M": "M",
        "1mo": "M",
    }

    # Market code mapping
    MARKET_CODE = {
        "KR": "J",  # 주식, ETF, ETN
        "US": "N",  # 뉴욕 (NYSE, NASDAQ)
    }

    # Exchange codes for overseas
    EXCHANGE_CODE = {
        "NYSE": "NYS",
        "NASDAQ": "NAS",
        "AMEX": "AMS",
    }

    def __init__(
        self,
        app_key: Optional[str] = None,
        app_secret: Optional[str] = None,
        account_no: Optional[str] = None,
        mock: bool = False,
    ):
        """
        Initialize KIS API Client.

        Args:
            app_key: KIS API App Key (or from KIS_APP_KEY env var)
            app_secret: KIS API App Secret (or from KIS_APP_SECRET env var)
            account_no: Trading account number (or from KIS_ACCOUNT_NO env var)
            mock: Use mock trading server (default: False, or from KIS_MOCK env var)
        """
        self.app_key = app_key or os.getenv("KIS_APP_KEY", "")
        self.app_secret = app_secret or os.getenv("KIS_APP_SECRET", "")
        self.account_no = account_no or os.getenv("KIS_ACCOUNT_NO", "")

        # Parse mock setting
        mock_env = os.getenv("KIS_MOCK", "false").lower()
        self.mock = mock or mock_env in ("true", "1", "yes")

        self.base_url = self.BASE_URL_MOCK if self.mock else self.BASE_URL_REAL

        # Token management
        self._access_token: Optional[str] = None
        self._token_expires_at: Optional[datetime] = None
        self._token_file = Path(".kis_token.json")

        # Load cached token if available
        self._load_cached_token()

    def _load_cached_token(self) -> None:
        """Load token from cache file."""
        if self._token_file.exists():
            try:
                with open(self._token_file, "r") as f:
                    data = json.load(f)
                    # Verify it's for the same credentials
                    key_hash = hashlib.sha256(f"{self.app_key}{self.mock}".encode()).hexdigest()[:16]
                    if data.get("key_hash") == key_hash:
                        expires_at = datetime.fromisoformat(data["expires_at"])
                        if expires_at > datetime.now() + timedelta(minutes=5):
                            self._access_token = data["access_token"]
                            self._token_expires_at = expires_at
            except (json.JSONDecodeError, KeyError, ValueError):
                pass

    def _save_token_cache(self) -> None:
        """Save token to cache file."""
        if self._access_token and self._token_expires_at:
            key_hash = hashlib.sha256(f"{self.app_key}{self.mock}".encode()).hexdigest()[:16]
            data = {
                "access_token": self._access_token,
                "expires_at": self._token_expires_at.isoformat(),
                "key_hash": key_hash,
            }
            try:
                with open(self._token_file, "w") as f:
                    json.dump(data, f)
            except IOError:
                pass

    @property
    def is_configured(self) -> bool:
        """Check if API credentials are configured."""
        return bool(self.app_key and self.app_secret)

    @property
    def access_token(self) -> str:
        """Get valid access token, refreshing if needed."""
        if not self.is_configured:
            raise KISAPIError("API credentials not configured", "CONFIG_ERROR")

        # Check if token needs refresh
        if (
            self._access_token is None
            or self._token_expires_at is None
            or datetime.now() >= self._token_expires_at - timedelta(minutes=5)
        ):
            self._refresh_token()

        return self._access_token or ""

    def _refresh_token(self) -> None:
        """Get new access token from KIS API."""
        url = f"{self.base_url}/oauth2/tokenP"

        headers = {"Content-Type": "application/json; charset=utf-8"}
        body = {
            "grant_type": "client_credentials",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
        }

        try:
            response = requests.post(url, headers=headers, json=body, timeout=10)
            response.raise_for_status()
            data = response.json()

            if "access_token" in data:
                self._access_token = data["access_token"]
                # Token is valid for 24 hours but we'll refresh earlier
                expires_in = int(data.get("expires_in", 86400))
                self._token_expires_at = datetime.now() + timedelta(seconds=expires_in)
                self._save_token_cache()
            else:
                raise KISAPIError(
                    "Token request failed",
                    data.get("error_code", "UNKNOWN"),
                    data.get("error_description", str(data)),
                )
        except requests.RequestException as e:
            raise KISAPIError(f"Network error during token refresh: {e}", "NETWORK_ERROR")

    def _get_headers(self, tr_id: str) -> Dict[str, str]:
        """Get common headers for API requests."""
        return {
            "Content-Type": "application/json; charset=utf-8",
            "authorization": f"Bearer {self.access_token}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": tr_id,
            "custtype": "P",  # 개인
        }

    def _request(
        self,
        method: str,
        path: str,
        tr_id: str,
        params: Optional[Dict] = None,
        body: Optional[Dict] = None,
        retry: int = 1,
    ) -> Dict[str, Any]:
        """Make API request with error handling and retry."""
        url = f"{self.base_url}{path}"
        headers = self._get_headers(tr_id)

        for attempt in range(retry + 1):
            try:
                if method.upper() == "GET":
                    response = requests.get(url, headers=headers, params=params, timeout=10)
                else:
                    response = requests.post(url, headers=headers, json=body, timeout=10)

                response.raise_for_status()
                data = response.json()

                # Check for API-level errors
                rt_cd = data.get("rt_cd")
                if rt_cd and rt_cd != "0":
                    msg_cd = data.get("msg_cd", "")
                    msg1 = data.get("msg1", "")

                    # Token expired - refresh and retry
                    if "token" in msg1.lower() or "인증" in msg1:
                        self._access_token = None
                        self._refresh_token()
                        if attempt < retry:
                            continue

                    raise KISAPIError(msg1, msg_cd)

                return data

            except requests.RequestException as e:
                if attempt < retry:
                    time.sleep(1)  # Brief delay before retry
                    continue
                raise KISAPIError(f"Network error: {e}", "NETWORK_ERROR")

        raise KISAPIError("Max retries exceeded", "RETRY_ERROR")

    def test_connection(self) -> Dict[str, Any]:
        """
        Test API connection and credentials.

        Returns:
            Dict with connection status and info
        """
        result = {
            "connected": False,
            "configured": self.is_configured,
            "mock_mode": self.mock,
            "message": "",
        }

        if not self.is_configured:
            result["message"] = "API credentials not configured"
            return result

        try:
            # Try to get a token
            _ = self.access_token
            result["connected"] = True
            result["message"] = "Connection successful"
            result["token_expires"] = self._token_expires_at.isoformat() if self._token_expires_at else None
        except KISAPIError as e:
            result["message"] = str(e)
        except Exception as e:
            result["message"] = f"Unexpected error: {e}"

        return result

    def get_current_price(self, symbol: str, market: str = "KR") -> Dict[str, Any]:
        """
        Get current stock price.

        Args:
            symbol: Stock symbol (e.g., "005930" for Samsung)
            market: Market code ("KR" or "US")

        Returns:
            Dict with price info
        """
        market = market.upper()

        if market == "KR":
            return self._get_domestic_price(symbol)
        elif market == "US":
            return self._get_overseas_price(symbol)
        else:
            raise KISAPIError(f"Unsupported market: {market}", "INVALID_MARKET")

    def _get_domestic_price(self, symbol: str) -> Dict[str, Any]:
        """Get domestic (Korean) stock current price."""
        path = "/uapi/domestic-stock/v1/quotations/inquire-price"
        tr_id = "FHKST01010100"

        params = {
            "FID_COND_MRKT_DIV_CODE": "J",  # 주식
            "FID_INPUT_ISCD": symbol,
        }

        data = self._request("GET", path, tr_id, params=params)
        output = data.get("output", {})

        return {
            "symbol": symbol,
            "market": "KR",
            "price": float(output.get("stck_prpr", 0)),
            "change": float(output.get("prdy_vrss", 0)),
            "change_pct": float(output.get("prdy_ctrt", 0)),
            "volume": int(output.get("acml_vol", 0)),
            "high": float(output.get("stck_hgpr", 0)),
            "low": float(output.get("stck_lwpr", 0)),
            "open": float(output.get("stck_oprc", 0)),
            "prev_close": float(output.get("stck_sdpr", 0)),
            "timestamp": datetime.now().isoformat(),
        }

    def _get_overseas_price(self, symbol: str) -> Dict[str, Any]:
        """Get overseas (US) stock current price."""
        path = "/uapi/overseas-price/v1/quotations/price"
        tr_id = "HHDFS00000300"

        # Determine exchange (default to NYSE, auto-detect common NASDAQ stocks)
        nasdaq_prefixes = ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA"]
        excd = "NAS" if any(symbol.startswith(p) for p in nasdaq_prefixes) else "NYS"

        params = {
            "AUTH": "",
            "EXCD": excd,
            "SYMB": symbol,
        }

        data = self._request("GET", path, tr_id, params=params)
        output = data.get("output", {})

        return {
            "symbol": symbol,
            "market": "US",
            "exchange": excd,
            "price": float(output.get("last", 0)),
            "change": float(output.get("diff", 0)),
            "change_pct": float(output.get("rate", 0)),
            "volume": int(output.get("tvol", 0)),
            "high": float(output.get("high", 0)),
            "low": float(output.get("low", 0)),
            "open": float(output.get("open", 0)),
            "prev_close": float(output.get("base", 0)),
            "timestamp": datetime.now().isoformat(),
        }

    def get_ohlcv(
        self,
        symbol: str,
        market: str = "KR",
        timeframe: str = "1D",
        count: int = 100,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Get OHLCV historical data.

        Args:
            symbol: Stock symbol
            market: Market code ("KR" or "US")
            timeframe: Timeframe (1m, 5m, 15m, 30m, 1h, 1D, 1W, 1M)
            count: Number of bars to fetch (max varies by API)
            end_date: End date in YYYYMMDD format (default: today)

        Returns:
            Dict with OHLCV data arrays
        """
        market = market.upper()
        kis_tf = self.TIMEFRAME_MAP.get(timeframe, "D")

        if market == "KR":
            if kis_tf in ("D", "W", "M"):
                return self._get_domestic_daily_ohlcv(symbol, kis_tf, count, end_date)
            else:
                return self._get_domestic_minute_ohlcv(symbol, kis_tf, count)
        elif market == "US":
            if kis_tf in ("D", "W", "M"):
                return self._get_overseas_daily_ohlcv(symbol, kis_tf, count, end_date)
            else:
                return self._get_overseas_minute_ohlcv(symbol, kis_tf, count)
        else:
            raise KISAPIError(f"Unsupported market: {market}", "INVALID_MARKET")

    def _get_domestic_daily_ohlcv(
        self,
        symbol: str,
        period: str,
        count: int,
        end_date: Optional[str],
    ) -> Dict[str, Any]:
        """Get domestic stock daily/weekly/monthly OHLCV."""
        path = "/uapi/domestic-stock/v1/quotations/inquire-daily-price"
        tr_id = "FHKST01010400"

        # Period code: D=일, W=주, M=월
        params = {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": symbol,
            "FID_PERIOD_DIV_CODE": period,
            "FID_ORG_ADJ_PRC": "0",  # 수정주가 사용
        }

        data = self._request("GET", path, tr_id, params=params)
        output = data.get("output", [])

        return self._parse_domestic_ohlcv(output, symbol, period, count)

    def _get_domestic_minute_ohlcv(
        self,
        symbol: str,
        interval: str,
        count: int,
    ) -> Dict[str, Any]:
        """Get domestic stock minute OHLCV."""
        path = "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice"
        tr_id = "FHKST03010200"

        # Get current time for the request
        now = datetime.now()
        hour_str = now.strftime("%H%M%S")

        params = {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": symbol,
            "FID_INPUT_HOUR_1": hour_str,
            "FID_PW_DATA_INCU_YN": "Y",  # 과거 데이터 포함
        }

        data = self._request("GET", path, tr_id, params=params)
        output = data.get("output2", [])

        return self._parse_domestic_minute_ohlcv(output, symbol, interval, count)

    def _parse_domestic_ohlcv(
        self,
        output: List[Dict],
        symbol: str,
        period: str,
        count: int,
    ) -> Dict[str, Any]:
        """Parse domestic OHLCV response."""
        timestamps = []
        opens = []
        highs = []
        lows = []
        closes = []
        volumes = []

        for row in output[:count]:
            try:
                date_str = row.get("stck_bsop_date", "")
                if not date_str:
                    continue

                # Format: YYYYMMDD -> YYYY-MM-DD
                formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
                timestamps.append(formatted_date)
                opens.append(float(row.get("stck_oprc", 0)))
                highs.append(float(row.get("stck_hgpr", 0)))
                lows.append(float(row.get("stck_lwpr", 0)))
                closes.append(float(row.get("stck_clpr", 0)))
                volumes.append(int(row.get("acml_vol", 0)))
            except (ValueError, TypeError):
                continue

        # Reverse to chronological order (API returns newest first)
        timestamps.reverse()
        opens.reverse()
        highs.reverse()
        lows.reverse()
        closes.reverse()
        volumes.reverse()

        return {
            "symbol": symbol,
            "market": "KR",
            "timeframe": {"D": "1D", "W": "1W", "M": "1M"}.get(period, "1D"),
            "count": len(timestamps),
            "timestamps": timestamps,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }

    def _parse_domestic_minute_ohlcv(
        self,
        output: List[Dict],
        symbol: str,
        interval: str,
        count: int,
    ) -> Dict[str, Any]:
        """Parse domestic minute OHLCV response."""
        timestamps = []
        opens = []
        highs = []
        lows = []
        closes = []
        volumes = []

        for row in output[:count]:
            try:
                time_str = row.get("stck_cntg_hour", "")
                if not time_str:
                    continue

                # Format: HHMMSS -> combine with today's date
                today = datetime.now().strftime("%Y-%m-%d")
                formatted_time = f"{today} {time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
                timestamps.append(formatted_time)
                opens.append(float(row.get("stck_oprc", 0)))
                highs.append(float(row.get("stck_hgpr", 0)))
                lows.append(float(row.get("stck_lwpr", 0)))
                closes.append(float(row.get("stck_prpr", 0)))
                volumes.append(int(row.get("cntg_vol", 0)))
            except (ValueError, TypeError):
                continue

        # Reverse to chronological order
        timestamps.reverse()
        opens.reverse()
        highs.reverse()
        lows.reverse()
        closes.reverse()
        volumes.reverse()

        # Map interval back to our timeframe format
        tf_map = {"1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1h"}
        timeframe = tf_map.get(interval, "1m")

        return {
            "symbol": symbol,
            "market": "KR",
            "timeframe": timeframe,
            "count": len(timestamps),
            "timestamps": timestamps,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }

    def _get_overseas_daily_ohlcv(
        self,
        symbol: str,
        period: str,
        count: int,
        end_date: Optional[str],
    ) -> Dict[str, Any]:
        """Get overseas stock daily/weekly/monthly OHLCV."""
        path = "/uapi/overseas-price/v1/quotations/dailyprice"
        tr_id = "HHDFS76240000"

        # Determine exchange
        nasdaq_symbols = ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA", "PLTR"]
        excd = "NAS" if symbol in nasdaq_symbols else "NYS"

        # Date range
        if end_date:
            ed = end_date
        else:
            ed = datetime.now().strftime("%Y%m%d")

        # Period: 0=일, 1=주, 2=월
        period_code = {"D": "0", "W": "1", "M": "2"}.get(period, "0")

        params = {
            "AUTH": "",
            "EXCD": excd,
            "SYMB": symbol,
            "GUBN": period_code,
            "BYMD": ed,
            "MODP": "1",  # 수정주가
        }

        data = self._request("GET", path, tr_id, params=params)
        output = data.get("output2", [])

        return self._parse_overseas_ohlcv(output, symbol, period, count)

    def _get_overseas_minute_ohlcv(
        self,
        symbol: str,
        interval: str,
        count: int,
    ) -> Dict[str, Any]:
        """Get overseas stock minute OHLCV."""
        path = "/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice"
        tr_id = "HHDFS76950200"

        # Determine exchange
        nasdaq_symbols = ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA", "PLTR"]
        excd = "NAS" if symbol in nasdaq_symbols else "NYS"

        # Note: KIS overseas minute chart has limited support
        # Using NMIN (분단위) for interval
        params = {
            "AUTH": "",
            "EXCD": excd,
            "SYMB": symbol,
            "NMIN": interval,
            "PINC": "1",
            "NEXT": "",
            "NREC": str(count),
            "FILL": "",
            "KEYB": "",
        }

        data = self._request("GET", path, tr_id, params=params)
        output = data.get("output2", [])

        return self._parse_overseas_minute_ohlcv(output, symbol, interval, count)

    def _parse_overseas_ohlcv(
        self,
        output: List[Dict],
        symbol: str,
        period: str,
        count: int,
    ) -> Dict[str, Any]:
        """Parse overseas OHLCV response."""
        timestamps = []
        opens = []
        highs = []
        lows = []
        closes = []
        volumes = []

        for row in output[:count]:
            try:
                date_str = row.get("xymd", "")
                if not date_str:
                    continue

                # Format: YYYYMMDD -> YYYY-MM-DD
                formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
                timestamps.append(formatted_date)
                opens.append(float(row.get("open", 0)))
                highs.append(float(row.get("high", 0)))
                lows.append(float(row.get("low", 0)))
                closes.append(float(row.get("clos", 0)))
                volumes.append(int(float(row.get("tvol", 0))))
            except (ValueError, TypeError):
                continue

        # Reverse to chronological order
        timestamps.reverse()
        opens.reverse()
        highs.reverse()
        lows.reverse()
        closes.reverse()
        volumes.reverse()

        return {
            "symbol": symbol,
            "market": "US",
            "timeframe": {"D": "1D", "W": "1W", "M": "1M"}.get(period, "1D"),
            "count": len(timestamps),
            "timestamps": timestamps,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }

    def _parse_overseas_minute_ohlcv(
        self,
        output: List[Dict],
        symbol: str,
        interval: str,
        count: int,
    ) -> Dict[str, Any]:
        """Parse overseas minute OHLCV response."""
        timestamps = []
        opens = []
        highs = []
        lows = []
        closes = []
        volumes = []

        for row in output[:count]:
            try:
                # Combine date and time
                date_str = row.get("xymd", "")
                time_str = row.get("xhms", "")
                if not date_str or not time_str:
                    continue

                formatted_dt = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]} {time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
                timestamps.append(formatted_dt)
                opens.append(float(row.get("open", 0)))
                highs.append(float(row.get("high", 0)))
                lows.append(float(row.get("low", 0)))
                closes.append(float(row.get("clos", 0)))
                volumes.append(int(float(row.get("tvol", 0))))
            except (ValueError, TypeError):
                continue

        # Reverse to chronological order
        timestamps.reverse()
        opens.reverse()
        highs.reverse()
        lows.reverse()
        closes.reverse()
        volumes.reverse()

        # Map interval back to our timeframe format
        tf_map = {"1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1h"}
        timeframe = tf_map.get(interval, "1m")

        return {
            "symbol": symbol,
            "market": "US",
            "timeframe": timeframe,
            "count": len(timestamps),
            "timestamps": timestamps,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }


# Singleton instance
_kis_client: Optional[KISClient] = None


def get_kis_client() -> KISClient:
    """Get or create singleton KIS client instance."""
    global _kis_client
    if _kis_client is None:
        _kis_client = KISClient()
    return _kis_client


def configure_kis_client(
    app_key: str,
    app_secret: str,
    account_no: str = "",
    mock: bool = False,
) -> KISClient:
    """
    Configure and return a new KIS client.

    Args:
        app_key: KIS API App Key
        app_secret: KIS API App Secret
        account_no: Trading account number
        mock: Use mock trading server

    Returns:
        Configured KISClient instance
    """
    global _kis_client
    _kis_client = KISClient(
        app_key=app_key,
        app_secret=app_secret,
        account_no=account_no,
        mock=mock,
    )
    return _kis_client
