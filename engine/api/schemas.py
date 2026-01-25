"""Pydantic schemas for API responses."""

from typing import List, Literal, Optional

from pydantic import BaseModel


class FVGSchema(BaseModel):
    """Fair Value Gap schema."""
    index: int
    direction: str
    gap_high: float
    gap_low: float


class OrderBlockSchema(BaseModel):
    """Order Block schema."""
    index: int
    direction: str
    zone_top: float
    zone_bottom: float
    displacement_index: int
    has_fvg: bool
    fvg: Optional[FVGSchema] = None


class ValidationDetails(BaseModel):
    """Validation details for the analysis."""
    has_displacement: bool
    has_fvg: bool
    is_fresh: bool


class AnalyzeResponse(BaseModel):
    """Response schema for /analyze endpoint."""
    bar_index: int
    current_price: float
    current_valid_ob: Optional[OrderBlockSchema] = None
    validation_details: ValidationDetails
    reason_code: Literal["OK", "NO_VALID_OB"]


class ReplayResponse(BaseModel):
    """Response schema for /replay endpoint."""
    frames: List[AnalyzeResponse]


class ScreenResultSchema(BaseModel):
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


class ScreenResponse(BaseModel):
    """Response schema for /screen endpoint."""
    market: str
    candidates: List[ScreenResultSchema]


class ScreenAllResponse(BaseModel):
    """Response schema for /screen_all endpoint."""
    kr_candidates: List[ScreenResultSchema]
    us_candidates: List[ScreenResultSchema]
