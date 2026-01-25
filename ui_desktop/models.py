"""Dataclasses for parsing API responses.

These are local to the desktop app and mirror the API schemas
without importing from engine/.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class ScanMode(Enum):
    """Scan mode for screening."""

    FULL = "FULL"
    WATCHLIST_ONLY = "WATCHLIST_ONLY"
    WATCHLIST_FILTER = "WATCHLIST_FILTER"

    @property
    def display_name(self) -> str:
        """Human-readable display name."""
        return {
            ScanMode.FULL: "Full Universe",
            ScanMode.WATCHLIST_ONLY: "Watchlist Only",
            ScanMode.WATCHLIST_FILTER: "Watchlist Filter",
        }[self]

    @property
    def description(self) -> str:
        """Description of what this mode does."""
        return {
            ScanMode.FULL: "Scan all available symbols in the market",
            ScanMode.WATCHLIST_ONLY: "Scan only symbols in the watchlist",
            ScanMode.WATCHLIST_FILTER: "Scan all, filter to watchlist matches",
        }[self]


@dataclass
class ScreenResult:
    """Screening result for a single symbol."""

    symbol: str
    market: str
    last_close: float
    ema20: float
    ema200: float
    gap: float
    slope_diff: float
    days_to_cross: Optional[int]
    score: int
    reason: str

    @classmethod
    def from_dict(cls, data: dict) -> "ScreenResult":
        """Create instance from JSON dict."""
        return cls(
            symbol=data["symbol"],
            market=data["market"],
            last_close=data["last_close"],
            ema20=data["ema20"],
            ema200=data["ema200"],
            gap=data["gap"],
            slope_diff=data["slope_diff"],
            days_to_cross=data.get("days_to_cross"),
            score=data["score"],
            reason=data["reason"],
        )

    @property
    def ema_position(self) -> str:
        """Describe EMA position relative to each other."""
        if self.ema20 > self.ema200:
            return "EMA20 above EMA200 (bullish)"
        elif self.ema20 < self.ema200:
            return "EMA20 below EMA200 (bearish)"
        else:
            return "EMAs equal (neutral)"

    @property
    def gap_percent(self) -> float:
        """Gap as percentage."""
        return self.gap * 100


@dataclass
class ScreenResponse:
    """Response from /screen endpoint."""

    market: str
    candidates: List[ScreenResult]

    @classmethod
    def from_dict(cls, data: dict) -> "ScreenResponse":
        """Create instance from JSON dict."""
        return cls(
            market=data["market"],
            candidates=[ScreenResult.from_dict(c) for c in data["candidates"]],
        )


@dataclass
class SymbolStatus:
    """Status of a single symbol's data availability."""

    symbol: str
    has_csv: bool
    row_count: int
    is_sufficient: bool  # row_count >= MIN_ROWS_REQUIRED

    @property
    def status_text(self) -> str:
        """Human-readable status."""
        if not self.has_csv:
            return "Missing CSV"
        elif not self.is_sufficient:
            return f"Insufficient ({self.row_count} rows)"
        else:
            return f"OK ({self.row_count} rows)"


@dataclass
class CoverageInfo:
    """Coverage statistics computed from local files."""

    selected_size: int  # Symbols in watchlist
    available_count: int  # CSVs that exist
    missing_count: int  # selected_size - available_count
    insufficient_data_count: int  # CSVs with < 250 rows

    # Detailed symbol lists for actionable panels
    missing_symbols: List[str] = field(default_factory=list)
    insufficient_symbols: List[SymbolStatus] = field(default_factory=list)
    ready_symbols: List[str] = field(default_factory=list)


@dataclass
class ServerHealth:
    """Server health check result."""

    is_healthy: bool
    status_code: Optional[int]
    response_time_ms: float
    message: str
    base_url: str


# ============================================================
# Order Block Analysis Models (Phase 2.8)
# ============================================================


@dataclass
class FVG:
    """Fair Value Gap details."""

    index: int
    direction: str  # "bullish" or "bearish"
    gap_high: float
    gap_low: float

    @classmethod
    def from_dict(cls, data: dict) -> "FVG":
        """Create instance from JSON dict."""
        return cls(
            index=data["index"],
            direction=data["direction"],
            gap_high=data["gap_high"],
            gap_low=data["gap_low"],
        )

    @property
    def gap_size(self) -> float:
        """Size of the gap."""
        return self.gap_high - self.gap_low

    @property
    def is_bullish(self) -> bool:
        """Check if FVG is bullish."""
        return self.direction.lower() == "bullish"


@dataclass
class OrderBlock:
    """Order Block details."""

    index: int
    direction: str  # "bullish" or "bearish"
    zone_top: float
    zone_bottom: float
    displacement_index: int
    has_fvg: bool
    fvg: Optional[FVG] = None

    @classmethod
    def from_dict(cls, data: dict) -> "OrderBlock":
        """Create instance from JSON dict."""
        fvg = None
        if data.get("fvg"):
            fvg = FVG.from_dict(data["fvg"])
        return cls(
            index=data["index"],
            direction=data["direction"],
            zone_top=data["zone_top"],
            zone_bottom=data["zone_bottom"],
            displacement_index=data["displacement_index"],
            has_fvg=data["has_fvg"],
            fvg=fvg,
        )

    @property
    def zone_width(self) -> float:
        """Width of the OB zone."""
        return self.zone_top - self.zone_bottom

    @property
    def zone_width_percent(self) -> float:
        """Zone width as percentage of zone_bottom."""
        if self.zone_bottom == 0:
            return 0.0
        return (self.zone_width / self.zone_bottom) * 100

    @property
    def is_bullish(self) -> bool:
        """Check if OB is bullish."""
        return self.direction.lower() == "bullish"

    @property
    def displacement_bars(self) -> int:
        """Number of bars since displacement."""
        return abs(self.displacement_index - self.index)


@dataclass
class ValidationDetails:
    """Validation flags for OB analysis."""

    has_displacement: bool
    has_fvg: bool
    is_fresh: bool

    @classmethod
    def from_dict(cls, data: dict) -> "ValidationDetails":
        """Create instance from JSON dict."""
        return cls(
            has_displacement=data["has_displacement"],
            has_fvg=data["has_fvg"],
            is_fresh=data["is_fresh"],
        )

    @property
    def all_valid(self) -> bool:
        """Check if all validations pass."""
        return self.has_displacement and self.has_fvg and self.is_fresh

    @property
    def validation_count(self) -> int:
        """Count of passed validations."""
        return sum([self.has_displacement, self.has_fvg, self.is_fresh])


@dataclass
class AnalyzeResult:
    """Result from /analyze endpoint."""

    bar_index: int
    current_price: float
    current_valid_ob: Optional[OrderBlock]
    validation_details: ValidationDetails
    reason_code: str  # "OK" or "NO_VALID_OB"

    @classmethod
    def from_dict(cls, data: dict) -> "AnalyzeResult":
        """Create instance from JSON dict."""
        ob = None
        if data.get("current_valid_ob"):
            ob = OrderBlock.from_dict(data["current_valid_ob"])
        return cls(
            bar_index=data["bar_index"],
            current_price=data["current_price"],
            current_valid_ob=ob,
            validation_details=ValidationDetails.from_dict(data["validation_details"]),
            reason_code=data["reason_code"],
        )

    @property
    def has_valid_ob(self) -> bool:
        """Check if a valid OB was found."""
        return self.reason_code == "OK" and self.current_valid_ob is not None

    @property
    def status_text(self) -> str:
        """Human-readable status."""
        if self.has_valid_ob:
            return f"Valid {self.current_valid_ob.direction.upper()} OB found"
        return "No valid Order Block found"
