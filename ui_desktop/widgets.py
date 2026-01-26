"""Reusable custom widgets for the desktop app."""

from typing import List, Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QSizePolicy,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from .models import (
    AnalyzeResult,
    CoverageInfo,
    CoverageTrustLevel,
    FVG,
    OrderBlock,
    ScreenResult,
    ServerHealth,
    SymbolStatus,
    ScanMode,
    ValidationDetails,
)


class CoverageCard(QFrame):
    """A single coverage metric card with click support."""

    clicked = Signal()

    def __init__(
        self,
        title: str,
        value: str = "-",
        clickable: bool = False,
        parent=None
    ):
        super().__init__(parent)
        self.clickable = clickable
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Raised)
        self.setLineWidth(1)
        self.setMinimumSize(100, 70)

        if clickable:
            self.setCursor(Qt.CursorShape.PointingHandCursor)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)

        self.title_label = QLabel(title)
        self.title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = self.title_label.font()
        font.setPointSize(9)
        self.title_label.setFont(font)

        self.value_label = QLabel(value)
        self.value_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = QFont()
        font.setPointSize(16)
        font.setBold(True)
        self.value_label.setFont(font)

        layout.addWidget(self.title_label)
        layout.addWidget(self.value_label)

    def set_value(self, value: str, warning: bool = False):
        """Update the displayed value."""
        self.value_label.setText(value)
        if warning and value != "0" and value != "-":
            self.value_label.setStyleSheet("color: #e74c3c;")  # Red for warnings
        else:
            self.value_label.setStyleSheet("")

    def mousePressEvent(self, event):
        """Handle mouse press."""
        if self.clickable:
            self.clicked.emit()
        super().mousePressEvent(event)


class SymbolListPanel(QGroupBox):
    """Panel showing a list of symbols with status."""

    def __init__(self, title: str, parent=None):
        super().__init__(title, parent)
        layout = QVBoxLayout(self)

        self.symbol_list = QListWidget()
        self.symbol_list.setAlternatingRowColors(True)
        layout.addWidget(self.symbol_list)

        self.status_label = QLabel("")
        self.status_label.setStyleSheet("color: #666; font-style: italic;")
        layout.addWidget(self.status_label)

    def set_symbols(self, symbols: List[str], status_text: str = ""):
        """Set the list of symbols."""
        self.symbol_list.clear()
        for symbol in symbols:
            self.symbol_list.addItem(symbol)
        self.status_label.setText(status_text)

    def set_symbol_statuses(self, statuses: List[SymbolStatus]):
        """Set symbols with their status details."""
        self.symbol_list.clear()
        for status in statuses:
            item = QListWidgetItem(f"{status.symbol} - {status.status_text}")
            self.symbol_list.addItem(item)


class ScanModeSelector(QFrame):
    """Scan mode selector with descriptions."""

    mode_changed = Signal(ScanMode)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Sunken)
        self._current_mode = ScanMode.WATCHLIST_ONLY

        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)

        # Header
        header = QLabel("SCAN MODE")
        font = header.font()
        font.setBold(True)
        header.setFont(font)
        layout.addWidget(header)

        # Mode buttons
        self.mode_buttons = {}
        for mode in ScanMode:
            btn = QPushButton(mode.display_name)
            btn.setCheckable(True)
            btn.setToolTip(mode.description)
            btn.clicked.connect(lambda checked, m=mode: self._on_mode_clicked(m))
            self.mode_buttons[mode] = btn
            layout.addWidget(btn)

        # Description label
        self.desc_label = QLabel("")
        self.desc_label.setWordWrap(True)
        self.desc_label.setStyleSheet("color: #666; font-size: 10px;")
        layout.addWidget(self.desc_label)

        # Note about current implementation
        note = QLabel("(Backend uses WATCHLIST_ONLY)")
        note.setStyleSheet("color: #999; font-size: 9px; font-style: italic;")
        layout.addWidget(note)

        # Set initial state
        self._update_ui()

    def _on_mode_clicked(self, mode: ScanMode):
        """Handle mode button click."""
        self._current_mode = mode
        self._update_ui()
        self.mode_changed.emit(mode)

    def _update_ui(self):
        """Update button states and description."""
        for mode, btn in self.mode_buttons.items():
            btn.setChecked(mode == self._current_mode)
        self.desc_label.setText(self._current_mode.description)

    @property
    def current_mode(self) -> ScanMode:
        """Get the currently selected mode."""
        return self._current_mode


class ServerHealthPanel(QGroupBox):
    """Panel showing server health status with test button."""

    test_requested = Signal()

    def __init__(self, parent=None):
        super().__init__("Server Connection", parent)
        layout = QVBoxLayout(self)

        # Status indicator
        status_row = QHBoxLayout()
        self.status_icon = QLabel("●")
        self.status_icon.setStyleSheet("color: gray; font-size: 16px;")
        status_row.addWidget(self.status_icon)

        self.status_text = QLabel("Not checked")
        status_row.addWidget(self.status_text)
        status_row.addStretch()
        layout.addLayout(status_row)

        # Details
        self.url_label = QLabel("URL: -")
        self.url_label.setStyleSheet("color: #666; font-size: 10px;")
        layout.addWidget(self.url_label)

        self.response_label = QLabel("Response: -")
        self.response_label.setStyleSheet("color: #666; font-size: 10px;")
        layout.addWidget(self.response_label)

        self.message_label = QLabel("")
        self.message_label.setWordWrap(True)
        self.message_label.setStyleSheet("font-size: 10px;")
        layout.addWidget(self.message_label)

        # Test button
        self.test_btn = QPushButton("Test Connection")
        self.test_btn.clicked.connect(self.test_requested.emit)
        layout.addWidget(self.test_btn)

    def update_health(self, health: ServerHealth):
        """Update the panel with health check results."""
        self.url_label.setText(f"URL: {health.base_url}")
        self.response_label.setText(f"Response: {health.response_time_ms:.0f}ms")

        if health.is_healthy:
            self.status_icon.setStyleSheet("color: #27ae60; font-size: 16px;")
            self.status_text.setText("Connected")
            self.status_text.setStyleSheet("color: #27ae60;")
            self.message_label.setText(health.message)
            self.message_label.setStyleSheet("color: #27ae60; font-size: 10px;")
        else:
            self.status_icon.setStyleSheet("color: #e74c3c; font-size: 16px;")
            self.status_text.setText("Disconnected")
            self.status_text.setStyleSheet("color: #e74c3c;")
            self.message_label.setText(health.message)
            self.message_label.setStyleSheet("color: #e74c3c; font-size: 10px;")

    def set_checking(self):
        """Show checking state."""
        self.status_icon.setStyleSheet("color: #f39c12; font-size: 16px;")
        self.status_text.setText("Checking...")
        self.status_text.setStyleSheet("color: #f39c12;")
        self.test_btn.setEnabled(False)

    def set_ready(self):
        """Re-enable the test button."""
        self.test_btn.setEnabled(True)


class DetailDrawer(QFrame):
    """Collapsible drawer showing details of selected item."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Sunken)
        self.setMinimumHeight(0)
        self._expanded = False
        self._current_result: Optional[ScreenResult] = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)

        # Header with toggle
        header_row = QHBoxLayout()
        self.header_label = QLabel("Details")
        font = self.header_label.font()
        font.setBold(True)
        self.header_label.setFont(font)
        header_row.addWidget(self.header_label)

        self.toggle_btn = QPushButton("Expand")
        self.toggle_btn.setMaximumWidth(80)
        self.toggle_btn.clicked.connect(self._toggle)
        header_row.addWidget(self.toggle_btn)
        layout.addLayout(header_row)

        # Content area (initially hidden)
        self.content = QWidget()
        self.content_layout = QGridLayout(self.content)
        self.content_layout.setColumnStretch(1, 1)

        # Create detail labels
        self._labels = {}
        fields = [
            ("Symbol", "symbol"),
            ("Market", "market"),
            ("Score", "score"),
            ("Days to Cross", "days_to_cross"),
            ("Last Close", "last_close"),
            ("EMA20", "ema20"),
            ("EMA200", "ema200"),
            ("Gap", "gap"),
            ("Gap %", "gap_percent"),
            ("Slope Diff", "slope_diff"),
            ("EMA Position", "ema_position"),
            ("Reason", "reason"),
        ]

        for i, (label, field) in enumerate(fields):
            name_label = QLabel(f"{label}:")
            name_label.setStyleSheet("font-weight: bold;")
            value_label = QLabel("-")
            value_label.setTextInteractionFlags(
                Qt.TextInteractionFlag.TextSelectableByMouse
            )
            self._labels[field] = value_label
            self.content_layout.addWidget(name_label, i, 0)
            self.content_layout.addWidget(value_label, i, 1)

        self.content.hide()
        layout.addWidget(self.content)

    def _toggle(self):
        """Toggle drawer expansion."""
        self._expanded = not self._expanded
        self.content.setVisible(self._expanded)
        self.toggle_btn.setText("Collapse" if self._expanded else "Expand")

    def show_result(self, result: ScreenResult):
        """Display details for a screen result."""
        self._current_result = result
        self._labels["symbol"].setText(result.symbol)
        self._labels["market"].setText(result.market)
        self._labels["score"].setText(str(result.score))
        self._labels["days_to_cross"].setText(
            str(result.days_to_cross) if result.days_to_cross else "-"
        )
        self._labels["last_close"].setText(f"{result.last_close:,.2f}")
        self._labels["ema20"].setText(f"{result.ema20:,.2f}")
        self._labels["ema200"].setText(f"{result.ema200:,.2f}")
        self._labels["gap"].setText(f"{result.gap:.6f}")
        self._labels["gap_percent"].setText(f"{result.gap_percent:.2f}%")
        self._labels["slope_diff"].setText(f"{result.slope_diff:.6f}")
        self._labels["ema_position"].setText(result.ema_position)
        self._labels["reason"].setText(result.reason)

        # Auto-expand when showing new result
        if not self._expanded:
            self._toggle()

    def clear(self):
        """Clear the displayed details."""
        self._current_result = None
        for label in self._labels.values():
            label.setText("-")


class CoverageDetailDialog(QWidget):
    """Dialog showing detailed coverage information."""

    def __init__(self, coverage: CoverageInfo, market: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"Coverage Details - {market}")
        self.setMinimumSize(500, 400)
        self.setWindowFlags(Qt.WindowType.Window)

        layout = QVBoxLayout(self)

        # Summary
        summary = QLabel(
            f"Market: {market}\n"
            f"Watchlist Size: {coverage.selected_size}\n"
            f"Available: {coverage.available_count}\n"
            f"Missing: {coverage.missing_count}\n"
            f"Insufficient Data: {coverage.insufficient_data_count}"
        )
        summary.setStyleSheet("background: #f0f0f0; padding: 10px; border-radius: 4px;")
        layout.addWidget(summary)

        # Tabs for missing and insufficient
        if coverage.missing_symbols:
            missing_panel = SymbolListPanel("Missing Data Files")
            missing_panel.set_symbols(
                coverage.missing_symbols,
                f"{len(coverage.missing_symbols)} symbols need CSV files"
            )
            layout.addWidget(missing_panel)

        if coverage.insufficient_symbols:
            insufficient_panel = SymbolListPanel("Insufficient Data (<250 rows)")
            insufficient_panel.set_symbol_statuses(coverage.insufficient_symbols)
            layout.addWidget(insufficient_panel)

        if coverage.ready_symbols:
            ready_panel = SymbolListPanel("Ready for Screening")
            ready_panel.set_symbols(
                coverage.ready_symbols,
                f"{len(coverage.ready_symbols)} symbols ready"
            )
            layout.addWidget(ready_panel)

        # Close button
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.close)
        layout.addWidget(close_btn)


# ============================================================
# Order Block Analysis Widgets (Phase 2.8)
# ============================================================


class ValidationStatusCard(QFrame):
    """Card showing validation status flags."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Raised)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)

        # Title
        title = QLabel("Validation Status")
        font = title.font()
        font.setBold(True)
        title.setFont(font)
        layout.addWidget(title)

        # Status indicators
        self.indicators = {}
        for name, label in [
            ("has_displacement", "Has Displacement"),
            ("has_fvg", "Has FVG"),
            ("is_fresh", "Is Fresh"),
        ]:
            row = QHBoxLayout()
            icon = QLabel("○")
            icon.setStyleSheet("font-size: 14px;")
            text = QLabel(label)
            row.addWidget(icon)
            row.addWidget(text)
            row.addStretch()
            layout.addLayout(row)
            self.indicators[name] = icon

        # Overall status
        self.overall_label = QLabel("Overall: -")
        self.overall_label.setStyleSheet("font-weight: bold; margin-top: 5px;")
        layout.addWidget(self.overall_label)

    def update_validation(self, details: ValidationDetails):
        """Update with validation details."""
        for name, icon in self.indicators.items():
            value = getattr(details, name)
            if value:
                icon.setText("✓")
                icon.setStyleSheet("color: #27ae60; font-size: 14px;")
            else:
                icon.setText("✗")
                icon.setStyleSheet("color: #e74c3c; font-size: 14px;")

        if details.all_valid:
            self.overall_label.setText("Overall: VALID")
            self.overall_label.setStyleSheet("color: #27ae60; font-weight: bold;")
        else:
            count = details.validation_count
            self.overall_label.setText(f"Overall: {count}/3 passed")
            self.overall_label.setStyleSheet("color: #f39c12; font-weight: bold;")

    def clear(self):
        """Reset to default state."""
        for icon in self.indicators.values():
            icon.setText("○")
            icon.setStyleSheet("color: gray; font-size: 14px;")
        self.overall_label.setText("Overall: -")
        self.overall_label.setStyleSheet("font-weight: bold;")


class OrderBlockCard(QFrame):
    """Card showing Order Block details."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Raised)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)

        # Title
        title = QLabel("Order Block")
        font = title.font()
        font.setBold(True)
        title.setFont(font)
        layout.addWidget(title)

        # Status
        self.status_label = QLabel("No valid OB")
        self.status_label.setStyleSheet("color: #666;")
        layout.addWidget(self.status_label)

        # Details grid
        self.details_widget = QWidget()
        details_layout = QGridLayout(self.details_widget)
        details_layout.setContentsMargins(0, 5, 0, 0)

        self._labels = {}
        fields = [
            ("Direction", "direction"),
            ("Zone Top", "zone_top"),
            ("Zone Bottom", "zone_bottom"),
            ("Zone Width", "zone_width"),
            ("Displacement", "displacement"),
        ]

        for i, (label, field) in enumerate(fields):
            name = QLabel(f"{label}:")
            name.setStyleSheet("color: #666;")
            value = QLabel("-")
            self._labels[field] = value
            details_layout.addWidget(name, i, 0)
            details_layout.addWidget(value, i, 1)

        self.details_widget.hide()
        layout.addWidget(self.details_widget)

    def update_ob(self, ob: Optional[OrderBlock]):
        """Update with Order Block details."""
        if ob is None:
            self.status_label.setText("No valid Order Block found")
            self.status_label.setStyleSheet("color: #e74c3c;")
            self.details_widget.hide()
            return

        direction = ob.direction.upper()
        color = "#27ae60" if ob.is_bullish else "#e74c3c"
        self.status_label.setText(f"● {direction} OB")
        self.status_label.setStyleSheet(f"color: {color}; font-weight: bold;")

        self._labels["direction"].setText(direction)
        self._labels["zone_top"].setText(f"{ob.zone_top:,.2f}")
        self._labels["zone_bottom"].setText(f"{ob.zone_bottom:,.2f}")
        self._labels["zone_width"].setText(
            f"{ob.zone_width:,.2f} ({ob.zone_width_percent:.2f}%)"
        )
        self._labels["displacement"].setText(f"Bar {ob.displacement_index}")

        self.details_widget.show()

    def clear(self):
        """Reset to default state."""
        self.status_label.setText("No valid OB")
        self.status_label.setStyleSheet("color: #666;")
        for label in self._labels.values():
            label.setText("-")
        self.details_widget.hide()


class FVGCard(QFrame):
    """Card showing Fair Value Gap details."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Raised)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)

        # Title
        title = QLabel("Fair Value Gap")
        font = title.font()
        font.setBold(True)
        title.setFont(font)
        layout.addWidget(title)

        # Status
        self.status_label = QLabel("No FVG")
        self.status_label.setStyleSheet("color: #666;")
        layout.addWidget(self.status_label)

        # Details grid
        self.details_widget = QWidget()
        details_layout = QGridLayout(self.details_widget)
        details_layout.setContentsMargins(0, 5, 0, 0)

        self._labels = {}
        fields = [
            ("Direction", "direction"),
            ("Gap High", "gap_high"),
            ("Gap Low", "gap_low"),
            ("Gap Size", "gap_size"),
        ]

        for i, (label, field) in enumerate(fields):
            name = QLabel(f"{label}:")
            name.setStyleSheet("color: #666;")
            value = QLabel("-")
            self._labels[field] = value
            details_layout.addWidget(name, i, 0)
            details_layout.addWidget(value, i, 1)

        self.details_widget.hide()
        layout.addWidget(self.details_widget)

    def update_fvg(self, fvg: Optional[FVG]):
        """Update with FVG details."""
        if fvg is None:
            self.status_label.setText("No FVG present")
            self.status_label.setStyleSheet("color: #666;")
            self.details_widget.hide()
            return

        direction = fvg.direction.upper()
        color = "#27ae60" if fvg.is_bullish else "#e74c3c"
        self.status_label.setText(f"● {direction} FVG")
        self.status_label.setStyleSheet(f"color: {color}; font-weight: bold;")

        self._labels["direction"].setText(direction)
        self._labels["gap_high"].setText(f"{fvg.gap_high:,.2f}")
        self._labels["gap_low"].setText(f"{fvg.gap_low:,.2f}")
        self._labels["gap_size"].setText(f"{fvg.gap_size:,.2f}")

        self.details_widget.show()

    def clear(self):
        """Reset to default state."""
        self.status_label.setText("No FVG")
        self.status_label.setStyleSheet("color: #666;")
        for label in self._labels.values():
            label.setText("-")
        self.details_widget.hide()


class ZoneVisualization(QFrame):
    """Simple visualization of price zones."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Sunken)
        self.setMinimumHeight(150)

        self._current_price: Optional[float] = None
        self._ob: Optional[OrderBlock] = None
        self._ema20: Optional[float] = None
        self._ema200: Optional[float] = None

    def update_data(
        self,
        current_price: float,
        ob: Optional[OrderBlock],
        ema20: Optional[float] = None,
        ema200: Optional[float] = None,
    ):
        """Update visualization data."""
        self._current_price = current_price
        self._ob = ob
        self._ema20 = ema20
        self._ema200 = ema200
        self.update()  # Trigger repaint

    def clear(self):
        """Clear the visualization."""
        self._current_price = None
        self._ob = None
        self._ema20 = None
        self._ema200 = None
        self.update()

    def paintEvent(self, event):
        """Custom paint for zone visualization."""
        super().paintEvent(event)

        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = self.rect().adjusted(10, 10, -10, -10)
        width = rect.width()
        height = rect.height()

        if self._current_price is None:
            # Draw placeholder
            painter.setPen(QPen(QColor("#999")))
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, "No data loaded")
            return

        # Collect all price levels
        prices = [self._current_price]
        if self._ob:
            prices.extend([self._ob.zone_top, self._ob.zone_bottom])
            if self._ob.fvg:
                prices.extend([self._ob.fvg.gap_high, self._ob.fvg.gap_low])
        if self._ema20:
            prices.append(self._ema20)
        if self._ema200:
            prices.append(self._ema200)

        min_price = min(prices) * 0.995
        max_price = max(prices) * 1.005
        price_range = max_price - min_price

        def price_to_y(price: float) -> int:
            """Convert price to Y coordinate (inverted - higher price = lower Y)."""
            return int(rect.top() + (max_price - price) / price_range * height)

        # Draw OB zone
        if self._ob:
            ob_color = QColor("#27ae60") if self._ob.is_bullish else QColor("#e74c3c")
            ob_color.setAlpha(50)
            painter.fillRect(
                rect.left(),
                price_to_y(self._ob.zone_top),
                width,
                price_to_y(self._ob.zone_bottom) - price_to_y(self._ob.zone_top),
                ob_color,
            )

            # OB zone lines
            ob_color.setAlpha(200)
            painter.setPen(QPen(ob_color, 2))
            painter.drawLine(
                rect.left(), price_to_y(self._ob.zone_top),
                rect.right(), price_to_y(self._ob.zone_top)
            )
            painter.drawLine(
                rect.left(), price_to_y(self._ob.zone_bottom),
                rect.right(), price_to_y(self._ob.zone_bottom)
            )

            # FVG zone
            if self._ob.fvg:
                fvg_color = QColor("#3498db")
                fvg_color.setAlpha(30)
                painter.fillRect(
                    rect.left() + 20,
                    price_to_y(self._ob.fvg.gap_high),
                    width - 40,
                    price_to_y(self._ob.fvg.gap_low) - price_to_y(self._ob.fvg.gap_high),
                    fvg_color,
                )

        # Draw EMA lines
        if self._ema200:
            painter.setPen(QPen(QColor("#9b59b6"), 1, Qt.PenStyle.DashLine))
            y = price_to_y(self._ema200)
            painter.drawLine(rect.left(), y, rect.right(), y)
            painter.drawText(rect.right() - 60, y - 3, f"EMA200")

        if self._ema20:
            painter.setPen(QPen(QColor("#e67e22"), 1, Qt.PenStyle.DashLine))
            y = price_to_y(self._ema20)
            painter.drawLine(rect.left(), y, rect.right(), y)
            painter.drawText(rect.right() - 50, y - 3, f"EMA20")

        # Draw current price line
        painter.setPen(QPen(QColor("#2c3e50"), 2))
        y = price_to_y(self._current_price)
        painter.drawLine(rect.left(), y, rect.right(), y)
        painter.drawText(
            rect.left() + 5, y - 3,
            f"Price: {self._current_price:,.2f}"
        )

        # Legend
        painter.setPen(QPen(QColor("#666")))
        legend_y = rect.bottom() - 5
        painter.drawText(rect.left(), legend_y, "█ OB Zone  ░ FVG  ─ Price  - - EMA")


class OBAnalysisPanel(QWidget):
    """Panel for Order Block analysis visualization."""

    load_requested = Signal(str, str)  # symbol, market

    def __init__(self, parent=None):
        super().__init__(parent)
        self._current_symbol: Optional[str] = None
        self._current_market: Optional[str] = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # Header with load button
        header = QHBoxLayout()
        self.symbol_label = QLabel("Select a symbol to analyze")
        self.symbol_label.setStyleSheet("font-weight: bold;")
        header.addWidget(self.symbol_label)
        header.addStretch()

        self.cache_label = QLabel("")
        self.cache_label.setStyleSheet("color: #666; font-size: 10px;")
        header.addWidget(self.cache_label)

        self.load_btn = QPushButton("Load Analysis")
        self.load_btn.setEnabled(False)
        self.load_btn.clicked.connect(self._on_load_clicked)
        header.addWidget(self.load_btn)

        layout.addLayout(header)

        # Status/error message
        self.status_label = QLabel("")
        self.status_label.setWordWrap(True)
        layout.addWidget(self.status_label)

        # Cards row
        cards_layout = QHBoxLayout()

        self.validation_card = ValidationStatusCard()
        cards_layout.addWidget(self.validation_card)

        self.ob_card = OrderBlockCard()
        cards_layout.addWidget(self.ob_card)

        self.fvg_card = FVGCard()
        cards_layout.addWidget(self.fvg_card)

        layout.addLayout(cards_layout)

        # Zone visualization
        self.zone_viz = ZoneVisualization()
        layout.addWidget(self.zone_viz)

    def set_symbol(self, symbol: str, market: str):
        """Set the current symbol for analysis."""
        self._current_symbol = symbol
        self._current_market = market
        self.symbol_label.setText(f"Symbol: {symbol} ({market})")
        self.load_btn.setEnabled(True)
        self.status_label.setText("Click 'Load Analysis' to fetch OB data")
        self.status_label.setStyleSheet("color: #666;")

    def set_loading(self):
        """Show loading state."""
        self.load_btn.setEnabled(False)
        self.load_btn.setText("Loading...")
        self.status_label.setText("Fetching analysis from server...")
        self.status_label.setStyleSheet("color: #3498db;")

    def set_ready(self):
        """Reset to ready state."""
        self.load_btn.setEnabled(True)
        self.load_btn.setText("Load Analysis")

    def show_result(
        self,
        result: AnalyzeResult,
        from_cache: bool = False,
        ema20: Optional[float] = None,
        ema200: Optional[float] = None,
    ):
        """Display analysis results."""
        # Update cache indicator
        if from_cache:
            self.cache_label.setText("(cached)")
        else:
            self.cache_label.setText("")

        # Update validation card
        self.validation_card.update_validation(result.validation_details)

        # Update OB card
        self.ob_card.update_ob(result.current_valid_ob)

        # Update FVG card
        fvg = result.current_valid_ob.fvg if result.current_valid_ob else None
        self.fvg_card.update_fvg(fvg)

        # Update zone visualization
        self.zone_viz.update_data(
            result.current_price,
            result.current_valid_ob,
            ema20,
            ema200,
        )

        # Update status
        if result.has_valid_ob:
            self.status_label.setText(result.status_text)
            self.status_label.setStyleSheet("color: #27ae60;")
        else:
            self.status_label.setText(result.status_text)
            self.status_label.setStyleSheet("color: #e74c3c;")

    def show_error(self, error: str):
        """Display error message."""
        self.status_label.setText(f"Error: {error}")
        self.status_label.setStyleSheet("color: #e74c3c;")
        self.validation_card.clear()
        self.ob_card.clear()
        self.fvg_card.clear()
        self.zone_viz.clear()
        self.cache_label.setText("")

    def clear(self):
        """Clear all displayed data."""
        self._current_symbol = None
        self._current_market = None
        self.symbol_label.setText("Select a symbol to analyze")
        self.load_btn.setEnabled(False)
        self.status_label.setText("")
        self.cache_label.setText("")
        self.validation_card.clear()
        self.ob_card.clear()
        self.fvg_card.clear()
        self.zone_viz.clear()

    def _on_load_clicked(self):
        """Handle load button click."""
        if self._current_symbol and self._current_market:
            self.load_requested.emit(self._current_symbol, self._current_market)


class TabbedDetailDrawer(QFrame):
    """Tabbed drawer with Summary and OB Analysis tabs."""

    load_analysis_requested = Signal(str, str)  # symbol, market

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Sunken)
        self._current_result: Optional[ScreenResult] = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(5, 5, 5, 5)

        # Tab widget
        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)

        # Summary tab
        self.summary_widget = QWidget()
        self._setup_summary_tab()
        self.tabs.addTab(self.summary_widget, "Summary")

        # OB Analysis tab
        self.ob_panel = OBAnalysisPanel()
        self.ob_panel.load_requested.connect(self.load_analysis_requested.emit)
        self.tabs.addTab(self.ob_panel, "OB Analysis")

    def _setup_summary_tab(self):
        """Set up the summary tab content."""
        layout = QGridLayout(self.summary_widget)
        layout.setColumnStretch(1, 1)
        layout.setColumnStretch(3, 1)

        self._labels = {}
        fields_left = [
            ("Symbol", "symbol"),
            ("Market", "market"),
            ("Score", "score"),
            ("Days to Cross", "days_to_cross"),
            ("Last Close", "last_close"),
            ("Reason", "reason"),
        ]
        fields_right = [
            ("EMA20", "ema20"),
            ("EMA200", "ema200"),
            ("Gap", "gap"),
            ("Gap %", "gap_percent"),
            ("Slope Diff", "slope_diff"),
            ("EMA Position", "ema_position"),
        ]

        for i, (label, field) in enumerate(fields_left):
            name_label = QLabel(f"{label}:")
            name_label.setStyleSheet("font-weight: bold;")
            value_label = QLabel("-")
            value_label.setTextInteractionFlags(
                Qt.TextInteractionFlag.TextSelectableByMouse
            )
            self._labels[field] = value_label
            layout.addWidget(name_label, i, 0)
            layout.addWidget(value_label, i, 1)

        for i, (label, field) in enumerate(fields_right):
            name_label = QLabel(f"{label}:")
            name_label.setStyleSheet("font-weight: bold;")
            value_label = QLabel("-")
            value_label.setTextInteractionFlags(
                Qt.TextInteractionFlag.TextSelectableByMouse
            )
            self._labels[field] = value_label
            layout.addWidget(name_label, i, 2)
            layout.addWidget(value_label, i, 3)

    def show_result(self, result: ScreenResult):
        """Display details for a screen result."""
        self._current_result = result

        # Update summary tab
        self._labels["symbol"].setText(result.symbol)
        self._labels["market"].setText(result.market)
        self._labels["score"].setText(str(result.score))
        self._labels["days_to_cross"].setText(
            str(result.days_to_cross) if result.days_to_cross else "-"
        )
        self._labels["last_close"].setText(f"{result.last_close:,.2f}")
        self._labels["ema20"].setText(f"{result.ema20:,.2f}")
        self._labels["ema200"].setText(f"{result.ema200:,.2f}")
        self._labels["gap"].setText(f"{result.gap:.6f}")
        self._labels["gap_percent"].setText(f"{result.gap_percent:.2f}%")
        self._labels["slope_diff"].setText(f"{result.slope_diff:.6f}")
        self._labels["ema_position"].setText(result.ema_position)
        self._labels["reason"].setText(result.reason)

        # Update OB analysis tab symbol
        self.ob_panel.set_symbol(result.symbol, result.market)

    def show_analysis_result(
        self,
        result: AnalyzeResult,
        from_cache: bool = False,
    ):
        """Display OB analysis results."""
        if self._current_result:
            self.ob_panel.show_result(
                result,
                from_cache,
                self._current_result.ema20,
                self._current_result.ema200,
            )

    def show_analysis_error(self, error: str):
        """Display analysis error."""
        self.ob_panel.show_error(error)

    def set_analysis_loading(self):
        """Set loading state for analysis."""
        self.ob_panel.set_loading()

    def set_analysis_ready(self):
        """Reset analysis to ready state."""
        self.ob_panel.set_ready()

    def clear(self):
        """Clear all displayed details."""
        self._current_result = None
        for label in self._labels.values():
            label.setText("-")
        self.ob_panel.clear()

    @property
    def current_result(self) -> Optional[ScreenResult]:
        """Get the current screen result."""
        return self._current_result


# ============================================================
# Reliability UX Widgets (Phase 2.9.1)
# ============================================================


class MarketDataStatusPanel(QFrame):
    """Panel showing market data trust level and coverage stats."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Raised)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)

        # Header
        header = QLabel("MARKET DATA STATUS")
        font = header.font()
        font.setBold(True)
        header.setFont(font)
        layout.addWidget(header)

        # Trust level indicator
        trust_row = QHBoxLayout()
        self.trust_icon = QLabel("●")
        self.trust_icon.setStyleSheet("font-size: 18px; color: gray;")
        trust_row.addWidget(self.trust_icon)

        self.trust_label = QLabel("Not checked")
        self.trust_label.setStyleSheet("font-weight: bold;")
        trust_row.addWidget(self.trust_label)
        trust_row.addStretch()
        layout.addLayout(trust_row)

        # Coverage percentage
        self.coverage_label = QLabel("Coverage: -")
        self.coverage_label.setStyleSheet("color: #666; font-size: 11px;")
        layout.addWidget(self.coverage_label)

        # Description
        self.desc_label = QLabel("")
        self.desc_label.setWordWrap(True)
        self.desc_label.setStyleSheet("color: #666; font-size: 10px;")
        layout.addWidget(self.desc_label)

    def update_from_coverage(self, coverage: Optional[CoverageInfo]):
        """Update panel from coverage info."""
        if coverage is None:
            self.trust_icon.setStyleSheet("font-size: 18px; color: gray;")
            self.trust_label.setText("Unknown")
            self.trust_label.setStyleSheet("font-weight: bold; color: gray;")
            self.coverage_label.setText("Coverage: -")
            self.desc_label.setText("No coverage data available")
            return

        trust = coverage.trust_level
        color = trust.color

        self.trust_icon.setStyleSheet(f"font-size: 18px; color: {color};")
        self.trust_label.setText(trust.display_name.upper())
        self.trust_label.setStyleSheet(f"font-weight: bold; color: {color};")

        self.coverage_label.setText(
            f"Coverage: {coverage.ready_count}/{coverage.selected_size} "
            f"({coverage.coverage_percent:.0f}%)"
        )
        self.desc_label.setText(trust.description)


class StateExplanationBanner(QFrame):
    """Banner showing one-line explanation of current application state."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.Box | QFrame.Shadow.Plain)
        self.setMinimumHeight(40)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(15, 8, 15, 8)

        self.icon_label = QLabel("ℹ")
        self.icon_label.setStyleSheet("font-size: 16px;")
        layout.addWidget(self.icon_label)

        self.message_label = QLabel("Ready")
        self.message_label.setWordWrap(True)
        layout.addWidget(self.message_label, stretch=1)

        self._set_style("info")

    def _set_style(self, style: str):
        """Set the banner style (info, warning, error, success)."""
        styles = {
            "info": ("#3498db", "#ebf5fb", "ℹ"),
            "warning": ("#f39c12", "#fef9e7", "⚠"),
            "error": ("#e74c3c", "#fdedec", "✗"),
            "success": ("#27ae60", "#eafaf1", "✓"),
        }
        color, bg_color, icon = styles.get(style, styles["info"])

        self.setStyleSheet(
            f"background-color: {bg_color}; "
            f"border: 1px solid {color}; "
            f"border-radius: 4px;"
        )
        self.icon_label.setStyleSheet(f"font-size: 16px; color: {color};")
        self.icon_label.setText(icon)
        self.message_label.setStyleSheet(f"color: {color};")

    def show_server_disconnected(self, message: str = ""):
        """Show server disconnected state."""
        self._set_style("error")
        msg = "Server disconnected"
        if message:
            msg += f": {message}"
        self.message_label.setText(msg)

    def show_data_unreliable(self, coverage: CoverageInfo):
        """Show unreliable data coverage warning."""
        self._set_style("warning")
        self.message_label.setText(
            f"Data coverage too low ({coverage.coverage_percent:.0f}%). "
            f"Only {coverage.ready_count} of {coverage.selected_size} symbols have data. "
            "Results may be incomplete."
        )

    def show_no_candidates(self, coverage: CoverageInfo):
        """Show no candidates found (but data is OK)."""
        self._set_style("info")
        self.message_label.setText(
            f"No candidates found. {coverage.ready_count} symbols scanned, "
            "but none meet the screening criteria."
        )

    def show_candidates_found(self, count: int):
        """Show candidates found successfully."""
        self._set_style("success")
        self.message_label.setText(f"Found {count} candidate(s) matching criteria.")

    def show_loading(self):
        """Show loading state."""
        self._set_style("info")
        self.message_label.setText("Loading screening results...")

    def show_ready(self):
        """Show ready to refresh state."""
        self._set_style("info")
        self.message_label.setText(
            "Click 'Refresh Data' to load screening results."
        )

    def show_error(self, error: str):
        """Show generic error."""
        self._set_style("error")
        self.message_label.setText(f"Error: {error}")
