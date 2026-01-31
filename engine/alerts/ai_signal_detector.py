"""
AI Signal Detection Engine

Analyzes all AI predictions and detects strong trading signals:
- Consensus detection (2/3 or 3/3 agreement)
- Pattern alignment (AI + OB + FVG)
- Signal strength classification
- Trading level calculation
"""

from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum
from dataclasses import dataclass, asdict


class SignalType(Enum):
    """Types of trading signals"""
    STRONG_BUY = "strong_buy"
    STRONG_SELL = "strong_sell"
    MODERATE_BUY = "moderate_buy"
    MODERATE_SELL = "moderate_sell"
    DIVERGENCE = "divergence"
    NEUTRAL = "neutral"


class AIDirection(Enum):
    """AI prediction direction"""
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


@dataclass
class TradingLevels:
    """Trading levels for a signal"""
    entry: Optional[float] = None
    stop: Optional[float] = None
    targets: List[float] = None
    risk_reward: float = 0.0

    def __post_init__(self):
        if self.targets is None:
            self.targets = []

    def to_dict(self) -> dict:
        return {
            "entry": self.entry,
            "stop": self.stop,
            "targets": self.targets,
            "risk_reward": self.risk_reward
        }


@dataclass
class PatternAlignment:
    """Pattern alignment information"""
    has_ob: bool = False
    has_fvg: bool = False
    technical_confluence: int = 0
    ob_details: Optional[dict] = None
    fvg_details: Optional[dict] = None

    def to_dict(self) -> dict:
        return {
            "has_ob": self.has_ob,
            "has_fvg": self.has_fvg,
            "technical_confluence": self.technical_confluence,
            "ob_details": self.ob_details,
            "fvg_details": self.fvg_details
        }


@dataclass
class AIConsensus:
    """AI consensus information"""
    technical: str
    lstm: str
    lh: str
    agreement: int

    def to_dict(self) -> dict:
        return {
            "technical": self.technical,
            "lstm": self.lstm,
            "lh": self.lh,
            "agreement": self.agreement
        }


@dataclass
class AISignal:
    """Complete AI signal with all analysis data"""
    symbol: str
    market: str
    signal_type: SignalType
    consensus: AIConsensus
    confidence: float
    reasoning: List[str]
    pattern_alignment: PatternAlignment
    trading_levels: TradingLevels
    current_price: float
    timestamp: datetime

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "market": self.market,
            "signal_type": self.signal_type.value,
            "consensus": self.consensus.to_dict(),
            "confidence": self.confidence,
            "reasoning": self.reasoning,
            "pattern_alignment": self.pattern_alignment.to_dict(),
            "trading_levels": self.trading_levels.to_dict(),
            "current_price": self.current_price,
            "timestamp": self.timestamp.isoformat()
        }


def determine_direction(
    prediction: dict,
    current_price: float,
    threshold_pct: float = 2.0
) -> AIDirection:
    """
    Determine if prediction is bullish, bearish, or neutral.

    Args:
        prediction: AI prediction data with 'predicted_price' or similar field
        current_price: Current market price
        threshold_pct: Percentage threshold for direction determination

    Returns:
        AIDirection enum value
    """
    # Handle different prediction formats
    predicted_price = None

    # Technical ML format
    if "short_term" in prediction:
        up_prob = prediction["short_term"].get("up_prob", 50)
        if up_prob > 60:
            return AIDirection.BULLISH
        elif up_prob < 40:
            return AIDirection.BEARISH
        return AIDirection.NEUTRAL

    # LSTM format
    if "predictions" in prediction and isinstance(prediction["predictions"], list):
        if prediction["predictions"]:
            # Use day 3 or 5 prediction
            preds = prediction["predictions"]
            target_pred = preds[min(2, len(preds) - 1)]
            predicted_price = target_pred.get("price", current_price)

    # LH AI format
    if "scenario" in prediction:
        scenario = prediction.get("scenario", "").lower()
        if any(word in scenario for word in ["상승", "매수", "반등", "bullish", "long"]):
            return AIDirection.BULLISH
        elif any(word in scenario for word in ["하락", "매도", "조정", "bearish", "short"]):
            return AIDirection.BEARISH
        return AIDirection.NEUTRAL

    # Direct predicted_price format
    if "predicted_price" in prediction:
        predicted_price = prediction["predicted_price"]

    if predicted_price is None:
        return AIDirection.NEUTRAL

    # Calculate percentage change
    if current_price > 0:
        change_percent = ((predicted_price - current_price) / current_price) * 100
    else:
        return AIDirection.NEUTRAL

    if change_percent > threshold_pct:
        return AIDirection.BULLISH
    elif change_percent < -threshold_pct:
        return AIDirection.BEARISH
    return AIDirection.NEUTRAL


def check_pattern_alignment(
    directions: Dict[str, AIDirection],
    current_price: float,
    order_blocks: List[dict],
    fvgs: List[dict]
) -> PatternAlignment:
    """
    Check if AI signals align with technical patterns (OB, FVG).

    Args:
        directions: Dictionary of AI directions
        current_price: Current market price
        order_blocks: List of order block data
        fvgs: List of FVG (Fair Value Gap) data

    Returns:
        PatternAlignment dataclass
    """
    # Count bullish vs bearish
    bullish_count = sum(1 for d in directions.values() if d == AIDirection.BULLISH)
    is_bullish_bias = bullish_count >= 2

    # Check for relevant OB
    relevant_ob = None
    for ob in order_blocks:
        ob_type = ob.get("type", ob.get("direction", "")).lower()
        ob_high = ob.get("zone_top", ob.get("high", 0))
        ob_low = ob.get("zone_bottom", ob.get("low", 0))

        # Check if price is within or near the OB zone
        zone_size = ob_high - ob_low
        tolerance = zone_size * 0.1 if zone_size > 0 else current_price * 0.01

        if is_bullish_bias:
            # Looking for bullish OB (support)
            if "bull" in ob_type and ob_low - tolerance <= current_price <= ob_high + tolerance:
                relevant_ob = ob
                break
        else:
            # Looking for bearish OB (resistance)
            if "bear" in ob_type and ob_low - tolerance <= current_price <= ob_high + tolerance:
                relevant_ob = ob
                break

    # Check for relevant FVG
    relevant_fvg = None
    for fvg in fvgs:
        fvg_type = fvg.get("direction", fvg.get("type", "")).lower()
        fvg_high = fvg.get("gap_high", fvg.get("high", 0))
        fvg_low = fvg.get("gap_low", fvg.get("low", 0))

        # Check if price is within or near the FVG
        if fvg_low <= current_price <= fvg_high:
            if is_bullish_bias and "bull" in fvg_type:
                relevant_fvg = fvg
                break
            elif not is_bullish_bias and "bear" in fvg_type:
                relevant_fvg = fvg
                break

    # Calculate confluence score
    confluence = 0
    if relevant_ob:
        confluence += 1
    if relevant_fvg:
        confluence += 1

    return PatternAlignment(
        has_ob=relevant_ob is not None,
        has_fvg=relevant_fvg is not None,
        technical_confluence=confluence,
        ob_details=relevant_ob,
        fvg_details=relevant_fvg
    )


def determine_signal_type(
    agreement: int,
    bullish_count: int,
    bearish_count: int,
    confidence: float,
    pattern_alignment: PatternAlignment
) -> SignalType:
    """
    Determine the type of signal based on consensus and confidence.

    Args:
        agreement: Number of AIs agreeing (0-3)
        bullish_count: Number of bullish predictions
        bearish_count: Number of bearish predictions
        confidence: Average confidence percentage
        pattern_alignment: Pattern alignment information

    Returns:
        SignalType enum value
    """
    # Strong signals (3/3 agreement + high confidence)
    if agreement == 3 and confidence >= 70:
        if bullish_count == 3:
            return SignalType.STRONG_BUY
        elif bearish_count == 3:
            return SignalType.STRONG_SELL

    # Strong signals with pattern alignment (3/3 agreement)
    if agreement == 3 and pattern_alignment.technical_confluence >= 1:
        if bullish_count == 3:
            return SignalType.STRONG_BUY
        elif bearish_count == 3:
            return SignalType.STRONG_SELL

    # Moderate signals (2/3 agreement + pattern alignment)
    if agreement >= 2:
        if pattern_alignment.technical_confluence >= 1 or confidence >= 65:
            if bullish_count >= 2:
                return SignalType.MODERATE_BUY
            elif bearish_count >= 2:
                return SignalType.MODERATE_SELL

    # Moderate signals (2/3 agreement without pattern)
    if agreement == 2 and confidence >= 70:
        if bullish_count == 2:
            return SignalType.MODERATE_BUY
        elif bearish_count == 2:
            return SignalType.MODERATE_SELL

    # Divergence (no agreement)
    if agreement <= 1 and bullish_count >= 1 and bearish_count >= 1:
        return SignalType.DIVERGENCE

    return SignalType.NEUTRAL


def generate_reasoning(
    directions: Dict[str, AIDirection],
    confidences: List[float],
    pattern_alignment: PatternAlignment,
    signal_type: SignalType
) -> List[str]:
    """
    Generate human-readable reasoning for the signal.

    Returns:
        List of reasoning strings in Korean
    """
    reasoning = []

    # AI consensus
    bullish = [k for k, v in directions.items() if v == AIDirection.BULLISH]
    bearish = [k for k, v in directions.items() if v == AIDirection.BEARISH]

    ai_names = {
        "technical": "기술적 ML",
        "lstm": "LSTM",
        "lh": "LH AI"
    }

    if len(bullish) == 3:
        reasoning.append("모든 AI가 상승 예측 (3/3 합의)")
    elif len(bullish) == 2:
        names = ", ".join(ai_names.get(k, k) for k in bullish)
        reasoning.append(f"{names} AI가 상승 예측 (2/3 합의)")
    elif len(bearish) == 3:
        reasoning.append("모든 AI가 하락 예측 (3/3 합의)")
    elif len(bearish) == 2:
        names = ", ".join(ai_names.get(k, k) for k in bearish)
        reasoning.append(f"{names} AI가 하락 예측 (2/3 합의)")
    else:
        reasoning.append("AI 간 의견 불일치")

    # Confidence
    avg_conf = sum(confidences) / len(confidences) if confidences else 0
    if avg_conf >= 85:
        reasoning.append(f"매우 높은 신뢰도 ({avg_conf:.1f}%)")
    elif avg_conf >= 70:
        reasoning.append(f"높은 신뢰도 ({avg_conf:.1f}%)")
    elif avg_conf >= 55:
        reasoning.append(f"중간 신뢰도 ({avg_conf:.1f}%)")
    else:
        reasoning.append(f"낮은 신뢰도 ({avg_conf:.1f}%)")

    # Pattern alignment
    if pattern_alignment.has_ob and pattern_alignment.has_fvg:
        reasoning.append("Order Block + FVG 동시 발견 (강한 컨플루언스)")
    elif pattern_alignment.has_ob:
        reasoning.append("Order Block 영역에 위치")
    elif pattern_alignment.has_fvg:
        reasoning.append("Fair Value Gap 영역에 위치")

    # Signal interpretation
    signal_messages = {
        SignalType.STRONG_BUY: "✅ 강한 매수 시그널 - 진입 고려",
        SignalType.STRONG_SELL: "⛔ 강한 매도 시그널 - 청산/숏 고려",
        SignalType.MODERATE_BUY: "📈 중간 매수 시그널 - 신중한 진입",
        SignalType.MODERATE_SELL: "📉 중간 매도 시그널 - 관망 또는 청산",
        SignalType.DIVERGENCE: "⚠️ AI 의견 불일치 - 대기 권장",
        SignalType.NEUTRAL: "➖ 중립 시그널 - 추가 확인 필요"
    }
    reasoning.append(signal_messages.get(signal_type, ""))

    return [r for r in reasoning if r]  # Remove empty strings


def calculate_trading_levels(
    signal_type: SignalType,
    current_price: float,
    order_blocks: List[dict],
    fvgs: List[dict],
    lh_ai_prediction: Optional[dict] = None
) -> TradingLevels:
    """
    Calculate entry, stop loss, and target levels.

    Args:
        signal_type: Type of signal
        current_price: Current market price
        order_blocks: List of order blocks
        fvgs: List of FVGs
        lh_ai_prediction: LH AI prediction with key_levels

    Returns:
        TradingLevels dataclass
    """
    # Use LH AI levels if available
    if lh_ai_prediction and "key_levels" in lh_ai_prediction:
        levels = lh_ai_prediction["key_levels"]
        return TradingLevels(
            entry=levels.get("entry"),
            stop=levels.get("stop_loss"),
            targets=[levels.get("target1")] if levels.get("target1") else [],
            risk_reward=0.0  # Will be calculated below
        )

    if signal_type in [SignalType.STRONG_BUY, SignalType.MODERATE_BUY]:
        # Bullish trade
        entry = current_price

        # Stop loss: Below nearest OB or -2%
        stop = current_price * 0.98
        for ob in order_blocks:
            ob_type = ob.get("type", ob.get("direction", "")).lower()
            ob_low = ob.get("zone_bottom", ob.get("low", 0))
            if "bull" in ob_type and ob_low < current_price:
                stop = ob_low * 0.995  # Slightly below OB
                break

        # Targets: +3%, +6%, +10%
        targets = [
            round(current_price * 1.03, 2),
            round(current_price * 1.06, 2),
            round(current_price * 1.10, 2)
        ]

        # Calculate risk/reward
        risk = entry - stop
        reward = targets[0] - entry if targets else 0
        risk_reward = round(reward / risk, 2) if risk > 0 else 0

        return TradingLevels(
            entry=round(entry, 2),
            stop=round(stop, 2),
            targets=targets,
            risk_reward=risk_reward
        )

    elif signal_type in [SignalType.STRONG_SELL, SignalType.MODERATE_SELL]:
        # Bearish trade
        entry = current_price

        # Stop loss: Above nearest OB or +2%
        stop = current_price * 1.02
        for ob in order_blocks:
            ob_type = ob.get("type", ob.get("direction", "")).lower()
            ob_high = ob.get("zone_top", ob.get("high", 0))
            if "bear" in ob_type and ob_high > current_price:
                stop = ob_high * 1.005  # Slightly above OB
                break

        # Targets: -3%, -6%, -10%
        targets = [
            round(current_price * 0.97, 2),
            round(current_price * 0.94, 2),
            round(current_price * 0.90, 2)
        ]

        # Calculate risk/reward
        risk = stop - entry
        reward = entry - targets[0] if targets else 0
        risk_reward = round(reward / risk, 2) if risk > 0 else 0

        return TradingLevels(
            entry=round(entry, 2),
            stop=round(stop, 2),
            targets=targets,
            risk_reward=risk_reward
        )

    # Neutral/Divergence - no levels
    return TradingLevels()


def detect_ai_signal(
    symbol: str,
    market: str,
    technical_ml_prediction: dict,
    lstm_prediction: dict,
    lh_ai_prediction: dict,
    current_price: float,
    order_blocks: Optional[List[dict]] = None,
    fvgs: Optional[List[dict]] = None
) -> AISignal:
    """
    Analyze all AI predictions and detect strong signals.

    Args:
        symbol: Stock symbol
        market: Market (US/KR)
        technical_ml_prediction: Technical ML prediction data
        lstm_prediction: LSTM prediction data
        lh_ai_prediction: LH AI prediction data
        current_price: Current market price
        order_blocks: Optional list of order blocks
        fvgs: Optional list of FVGs

    Returns:
        AISignal with complete analysis
    """
    order_blocks = order_blocks or []
    fvgs = fvgs or []

    # 1. Determine direction of each AI
    directions = {
        "technical": determine_direction(technical_ml_prediction, current_price),
        "lstm": determine_direction(lstm_prediction, current_price),
        "lh": determine_direction(lh_ai_prediction, current_price)
    }

    # 2. Count agreements
    bullish_count = sum(1 for d in directions.values() if d == AIDirection.BULLISH)
    bearish_count = sum(1 for d in directions.values() if d == AIDirection.BEARISH)
    agreement = max(bullish_count, bearish_count)

    # 3. Extract confidences
    confidences = []

    # Technical ML confidence
    if "short_term" in technical_ml_prediction:
        up_prob = technical_ml_prediction["short_term"].get("up_prob", 50)
        confidences.append(abs(up_prob - 50) * 2)  # Convert to 0-100 confidence
    elif "confidence" in technical_ml_prediction:
        confidences.append(technical_ml_prediction["confidence"])
    else:
        confidences.append(50)

    # LSTM confidence
    if "confidence" in lstm_prediction:
        confidences.append(lstm_prediction["confidence"])
    else:
        confidences.append(50)

    # LH AI confidence
    if "confidence" in lh_ai_prediction:
        confidences.append(lh_ai_prediction["confidence"])
    else:
        confidences.append(50)

    avg_confidence = sum(confidences) / len(confidences)

    # 4. Check pattern alignment
    pattern_alignment = check_pattern_alignment(
        directions=directions,
        current_price=current_price,
        order_blocks=order_blocks,
        fvgs=fvgs
    )

    # 5. Determine signal type
    signal_type = determine_signal_type(
        agreement=agreement,
        bullish_count=bullish_count,
        bearish_count=bearish_count,
        confidence=avg_confidence,
        pattern_alignment=pattern_alignment
    )

    # 6. Generate reasoning
    reasoning = generate_reasoning(
        directions=directions,
        confidences=confidences,
        pattern_alignment=pattern_alignment,
        signal_type=signal_type
    )

    # 7. Calculate trading levels
    trading_levels = calculate_trading_levels(
        signal_type=signal_type,
        current_price=current_price,
        order_blocks=order_blocks,
        fvgs=fvgs,
        lh_ai_prediction=lh_ai_prediction
    )

    # 8. Create consensus
    consensus = AIConsensus(
        technical=directions["technical"].value,
        lstm=directions["lstm"].value,
        lh=directions["lh"].value,
        agreement=agreement
    )

    return AISignal(
        symbol=symbol,
        market=market,
        signal_type=signal_type,
        consensus=consensus,
        confidence=round(avg_confidence, 1),
        reasoning=reasoning,
        pattern_alignment=pattern_alignment,
        trading_levels=trading_levels,
        current_price=current_price,
        timestamp=datetime.now()
    )
