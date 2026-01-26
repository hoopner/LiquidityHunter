"""Main PySide6 window for the diagnostic desktop app."""

from datetime import datetime
from typing import List, Optional

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtGui import QFont, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QApplication,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSplitter,
    QStatusBar,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from .client import LHClient
from .coverage import compute_coverage, get_data_root
from .models import CoverageInfo, ScreenResponse, ScreenResult, ScanMode
from .widgets import (
    CoverageCard,
    CoverageDetailDialog,
    MarketDataStatusPanel,
    ScanModeSelector,
    ServerHealthPanel,
    StateExplanationBanner,
    TabbedDetailDrawer,
    WatchlistEditorDialog,
)


class FetchWorker(QThread):
    """Background worker for fetching screen data."""

    finished = Signal(object)  # ClientResult

    def __init__(self, client: LHClient, market: str):
        super().__init__()
        self.client = client
        self.market = market

    def run(self):
        result = self.client.fetch_screen(self.market)
        self.finished.emit(result)


class HealthCheckWorker(QThread):
    """Background worker for health checks."""

    finished = Signal(object)  # ServerHealth

    def __init__(self, client: LHClient, market: str = "KR"):
        super().__init__()
        self.client = client
        self.market = market

    def run(self):
        health = self.client.check_health(self.market)
        self.finished.emit(health)


class AnalyzeWorker(QThread):
    """Background worker for OB analysis."""

    finished = Signal(object)  # AnalyzeClientResult

    def __init__(self, client: LHClient, symbol: str, market: str):
        super().__init__()
        self.client = client
        self.symbol = symbol
        self.market = market

    def run(self):
        result = self.client.fetch_analyze(self.symbol, self.market)
        self.finished.emit(result)


class MainWindow(QMainWindow):
    """Main application window."""

    # Zoom constants
    SCALE_DEFAULT = 1.0
    SCALE_MIN = 0.5
    SCALE_MAX = 2.0
    SCALE_STEP = 0.1
    BASE_FONT_SIZE = 13  # Default macOS font size

    def __init__(self):
        super().__init__()
        self.client = LHClient()
        self.current_market = "KR"
        self.current_scan_mode = ScanMode.WATCHLIST_ONLY
        self.worker: Optional[FetchWorker] = None
        self.health_worker: Optional[HealthCheckWorker] = None
        self.analyze_worker: Optional[AnalyzeWorker] = None
        self.current_coverage: Optional[CoverageInfo] = None
        self.current_results: List[ScreenResult] = []
        self.coverage_dialog: Optional[CoverageDetailDialog] = None
        self.watchlist_dialog: Optional[WatchlistEditorDialog] = None

        # Zoom state
        self._scale_factor = self.SCALE_DEFAULT

        self.setup_ui()
        self.setup_zoom_shortcuts()
        self.update_coverage()
        self.check_server_health()

    def setup_ui(self):
        """Initialize the UI components."""
        self.setWindowTitle("LiquidityHunter Diagnostic Console")

        # Professional sizing: larger default, reasonable minimum
        self.setMinimumSize(1000, 700)
        self.resize(1600, 1000)

        # Central widget with minimal margins
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Main horizontal splitter: sidebar | content area
        self.main_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.main_splitter.setHandleWidth(5)
        self.main_splitter.setChildrenCollapsible(False)
        main_layout.addWidget(self.main_splitter)

        # Left sidebar (control panel)
        sidebar = self.create_sidebar()
        self.main_splitter.addWidget(sidebar)

        # Right area: vertical splitter for results table and detail drawer
        self.content_splitter = QSplitter(Qt.Orientation.Vertical)
        self.content_splitter.setHandleWidth(5)
        self.content_splitter.setChildrenCollapsible(False)
        self.main_splitter.addWidget(self.content_splitter)

        # Upper content: results table area
        results_area = self.create_results_area()
        self.content_splitter.addWidget(results_area)

        # Lower content: detail/analysis drawer
        self.detail_drawer = TabbedDetailDrawer()
        self.detail_drawer.load_analysis_requested.connect(self.on_load_analysis)
        self.detail_drawer.setMinimumHeight(200)
        self.content_splitter.addWidget(self.detail_drawer)

        # Set splitter proportions (sidebar: 240px, content stretches)
        self.main_splitter.setSizes([240, 1360])
        # Results table gets more space than detail drawer (65% / 35%)
        self.content_splitter.setSizes([600, 350])

        # Status bar
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)

        # Status bar widgets
        self.connection_label = QLabel("Server: Checking...")
        self.timestamp_label = QLabel("Last refresh: -")
        self.candidates_label = QLabel("Candidates: -")
        self.cache_label = QLabel("Cache: 0")
        self.zoom_label = QLabel("Zoom: 100%")
        self.zoom_label.setStyleSheet("color: #666;")
        self.status_bar.addWidget(self.connection_label)
        self.status_bar.addWidget(self.candidates_label)
        self.status_bar.addWidget(self.cache_label)
        self.status_bar.addWidget(self.zoom_label)
        self.status_bar.addPermanentWidget(self.timestamp_label)

    def setup_zoom_shortcuts(self):
        """Set up keyboard shortcuts for zoom controls."""
        # Cmd+Plus (Cmd+=) to zoom in
        zoom_in_shortcut = QShortcut(QKeySequence.StandardKey.ZoomIn, self)
        zoom_in_shortcut.activated.connect(self.zoom_in)

        # Also support Cmd+= directly (without shift)
        zoom_in_alt = QShortcut(QKeySequence("Ctrl+="), self)
        zoom_in_alt.activated.connect(self.zoom_in)

        # Cmd+Minus to zoom out
        zoom_out_shortcut = QShortcut(QKeySequence.StandardKey.ZoomOut, self)
        zoom_out_shortcut.activated.connect(self.zoom_out)

        # Cmd+0 to reset zoom
        reset_zoom_shortcut = QShortcut(QKeySequence("Ctrl+0"), self)
        reset_zoom_shortcut.activated.connect(self.reset_zoom)

    def zoom_in(self):
        """Increase UI scale factor."""
        new_scale = min(self._scale_factor + self.SCALE_STEP, self.SCALE_MAX)
        if new_scale != self._scale_factor:
            self._scale_factor = new_scale
            self.apply_scale()

    def zoom_out(self):
        """Decrease UI scale factor."""
        new_scale = max(self._scale_factor - self.SCALE_STEP, self.SCALE_MIN)
        if new_scale != self._scale_factor:
            self._scale_factor = new_scale
            self.apply_scale()

    def reset_zoom(self):
        """Reset UI scale to default."""
        if self._scale_factor != self.SCALE_DEFAULT:
            self._scale_factor = self.SCALE_DEFAULT
            self.apply_scale()

    def apply_scale(self):
        """Apply the current scale factor to the entire UI."""
        # Calculate scaled font size
        scaled_font_size = int(self.BASE_FONT_SIZE * self._scale_factor)

        # Apply global stylesheet with scaled font
        # This scales fonts, paddings, and other size-dependent properties
        app = QApplication.instance()
        if app:
            # Set application-wide font
            font = app.font()
            font.setPointSize(scaled_font_size)
            app.setFont(font)

            # Apply stylesheet for consistent scaling
            app.setStyleSheet(f"""
                * {{
                    font-size: {scaled_font_size}pt;
                }}
                QTableWidget {{
                    font-size: {scaled_font_size}pt;
                }}
                QTableWidget::item {{
                    padding: {int(5 * self._scale_factor)}px;
                }}
                QHeaderView::section {{
                    font-size: {scaled_font_size}pt;
                    padding: {int(6 * self._scale_factor)}px;
                    background-color: #f5f5f5;
                    border: 1px solid #ddd;
                }}
                QPushButton {{
                    padding: {int(8 * self._scale_factor)}px {int(16 * self._scale_factor)}px;
                }}
                QGroupBox {{
                    font-size: {scaled_font_size}pt;
                    font-weight: bold;
                    padding-top: {int(12 * self._scale_factor)}px;
                    margin-top: {int(8 * self._scale_factor)}px;
                }}
                QGroupBox::title {{
                    subcontrol-origin: margin;
                    padding: 0 {int(6 * self._scale_factor)}px;
                }}
                QListWidget::item {{
                    padding: {int(5 * self._scale_factor)}px;
                }}
                QSplitter::handle {{
                    background-color: #e0e0e0;
                }}
                QSplitter::handle:horizontal {{
                    width: {int(5 * self._scale_factor)}px;
                }}
                QSplitter::handle:vertical {{
                    height: {int(5 * self._scale_factor)}px;
                }}
                QSplitter::handle:hover {{
                    background-color: #3498db;
                }}
            """)

        # Update zoom indicator
        zoom_percent = int(self._scale_factor * 100)
        self.zoom_label.setText(f"Zoom: {zoom_percent}%")

    def create_sidebar(self) -> QWidget:
        """Create the left sidebar with controls."""
        sidebar = QWidget()
        sidebar.setMinimumWidth(200)
        sidebar.setMaximumWidth(350)
        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        # Market selector section
        market_label = QLabel("MARKET")
        font = market_label.font()
        font.setBold(True)
        market_label.setFont(font)
        layout.addWidget(market_label)

        self.market_list = QListWidget()
        self.market_list.setMaximumHeight(70)

        kr_item = QListWidgetItem("KR")
        us_item = QListWidgetItem("US")
        self.market_list.addItem(kr_item)
        self.market_list.addItem(us_item)

        self.market_list.setCurrentRow(0)
        self.market_list.currentRowChanged.connect(self.on_market_changed)
        layout.addWidget(self.market_list)

        # Edit watchlist button
        self.edit_watchlist_btn = QPushButton("Edit Watchlist")
        self.edit_watchlist_btn.clicked.connect(self.on_edit_watchlist_clicked)
        layout.addWidget(self.edit_watchlist_btn)

        layout.addSpacing(10)

        # Scan mode selector
        self.scan_mode_selector = ScanModeSelector()
        self.scan_mode_selector.mode_changed.connect(self.on_scan_mode_changed)
        layout.addWidget(self.scan_mode_selector)

        layout.addSpacing(10)

        # Market data status panel (trust level)
        self.data_status_panel = MarketDataStatusPanel()
        layout.addWidget(self.data_status_panel)

        layout.addSpacing(10)

        # Server health panel
        self.health_panel = ServerHealthPanel()
        self.health_panel.test_requested.connect(self.check_server_health)
        layout.addWidget(self.health_panel)

        layout.addSpacing(10)

        # Refresh button
        self.refresh_btn = QPushButton("Refresh Data")
        self.refresh_btn.setMinimumHeight(40)
        font = self.refresh_btn.font()
        font.setBold(True)
        self.refresh_btn.setFont(font)
        self.refresh_btn.clicked.connect(self.on_refresh_clicked)
        layout.addWidget(self.refresh_btn)

        # Clear cache button
        self.clear_cache_btn = QPushButton("Clear Analysis Cache")
        self.clear_cache_btn.setStyleSheet("font-size: 10px;")
        self.clear_cache_btn.clicked.connect(self.on_clear_cache_clicked)
        layout.addWidget(self.clear_cache_btn)

        layout.addStretch()

        # Disclaimer at bottom of sidebar
        disclaimer = QLabel(
            "DIAGNOSTICS ONLY\n"
            "No trading functionality"
        )
        disclaimer.setAlignment(Qt.AlignmentFlag.AlignCenter)
        disclaimer.setStyleSheet(
            "color: #999; font-size: 9px; "
            "border-top: 1px solid #ccc; padding-top: 10px;"
        )
        layout.addWidget(disclaimer)

        return sidebar

    def create_results_area(self) -> QWidget:
        """Create the results table area (upper content panel)."""
        content = QWidget()
        content.setMinimumHeight(300)
        layout = QVBoxLayout(content)
        layout.setContentsMargins(12, 12, 12, 8)
        layout.setSpacing(10)

        # Top bar with scan mode indicator
        top_bar = QHBoxLayout()
        self.mode_indicator = QLabel("Mode: WATCHLIST_ONLY")
        self.mode_indicator.setStyleSheet(
            "background: #3498db; color: white; padding: 6px 18px; "
            "border-radius: 4px; font-weight: bold;"
        )
        top_bar.addWidget(self.mode_indicator)
        top_bar.addStretch()

        self.market_indicator = QLabel("Market: KR")
        self.market_indicator.setStyleSheet(
            "background: #2ecc71; color: white; padding: 6px 18px; "
            "border-radius: 4px; font-weight: bold;"
        )
        top_bar.addWidget(self.market_indicator)
        layout.addLayout(top_bar)

        # State explanation banner (always visible)
        self.state_banner = StateExplanationBanner()
        layout.addWidget(self.state_banner)

        # Coverage summary section with clickable cards
        coverage_group = QGroupBox("Coverage Summary (click for details)")
        coverage_layout = QHBoxLayout(coverage_group)
        coverage_layout.setSpacing(10)

        self.card_selected = CoverageCard("Watchlist", clickable=True)
        self.card_selected.clicked.connect(self.show_coverage_details)

        self.card_available = CoverageCard("Available", clickable=True)
        self.card_available.clicked.connect(self.show_coverage_details)

        self.card_missing = CoverageCard("Missing", clickable=True)
        self.card_missing.clicked.connect(self.show_coverage_details)

        self.card_insufficient = CoverageCard("Insufficient", clickable=True)
        self.card_insufficient.clicked.connect(self.show_coverage_details)

        self.card_ready = CoverageCard("Ready")

        coverage_layout.addWidget(self.card_selected)
        coverage_layout.addWidget(self.card_available)
        coverage_layout.addWidget(self.card_missing)
        coverage_layout.addWidget(self.card_insufficient)
        coverage_layout.addWidget(self.card_ready)
        coverage_layout.addStretch()

        layout.addWidget(coverage_group)

        # Results table section (stretches to fill remaining space)
        results_group = QGroupBox("Screener Results")
        results_layout = QVBoxLayout(results_group)
        results_layout.setContentsMargins(8, 12, 8, 8)

        self.results_table = QTableWidget()
        self.results_table.setColumnCount(9)
        self.results_table.setHorizontalHeaderLabels([
            "Symbol", "Score", "Days to Cross", "Last Close",
            "EMA20", "EMA200", "Gap", "Slope Diff", "Reason"
        ])

        # Configure table for professional appearance
        header = self.results_table.horizontalHeader()
        header.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        header.setStretchLastSection(True)
        header.setMinimumSectionSize(60)

        self.results_table.setAlternatingRowColors(True)
        self.results_table.setSelectionBehavior(
            QTableWidget.SelectionBehavior.SelectRows
        )
        self.results_table.setSelectionMode(
            QTableWidget.SelectionMode.SingleSelection
        )
        self.results_table.setSortingEnabled(True)
        self.results_table.setShowGrid(True)
        self.results_table.verticalHeader().setVisible(False)
        self.results_table.itemSelectionChanged.connect(self.on_row_selected)

        results_layout.addWidget(self.results_table)
        layout.addWidget(results_group, stretch=1)

        return content

    def check_server_health(self):
        """Check if the backend server is reachable."""
        if self.health_worker is not None and self.health_worker.isRunning():
            return

        self.health_panel.set_checking()
        self.health_worker = HealthCheckWorker(self.client, self.current_market)
        self.health_worker.finished.connect(self.on_health_check_finished)
        self.health_worker.start()

    def on_health_check_finished(self, health):
        """Handle health check completion."""
        self.health_panel.update_health(health)
        self.health_panel.set_ready()

        if health.is_healthy:
            self.connection_label.setText("Server: OK")
            self.connection_label.setStyleSheet("color: green;")
            # Don't override state banner if we have results
            if not self.current_results:
                self.state_banner.show_ready()
        else:
            self.connection_label.setText(f"Server: {health.message[:30]}")
            self.connection_label.setStyleSheet("color: red;")
            self.state_banner.show_server_disconnected(health.message)

    def update_coverage(self):
        """Update coverage cards from local files."""
        try:
            data_root = get_data_root()
            self.current_coverage = compute_coverage(data_root, self.current_market)
            self.display_coverage(self.current_coverage)
            self.data_status_panel.update_from_coverage(self.current_coverage)
        except Exception as e:
            self.current_coverage = None
            self.card_selected.set_value("-")
            self.card_available.set_value("-")
            self.card_missing.set_value("-")
            self.card_insufficient.set_value("-")
            self.card_ready.set_value("-")
            self.data_status_panel.update_from_coverage(None)

    def display_coverage(self, coverage: CoverageInfo):
        """Display coverage statistics in cards."""
        self.card_selected.set_value(str(coverage.selected_size))
        self.card_available.set_value(str(coverage.available_count))
        self.card_missing.set_value(str(coverage.missing_count), warning=True)
        self.card_insufficient.set_value(
            str(coverage.insufficient_data_count), warning=True
        )
        # Ready = available - insufficient
        ready_count = coverage.available_count - coverage.insufficient_data_count
        self.card_ready.set_value(str(ready_count))

    def show_coverage_details(self):
        """Show detailed coverage dialog."""
        if self.current_coverage is None:
            return

        # Close existing dialog if open
        if self.coverage_dialog is not None:
            self.coverage_dialog.close()

        self.coverage_dialog = CoverageDetailDialog(
            self.current_coverage,
            self.current_market,
            self
        )
        self.coverage_dialog.show()

    def on_market_changed(self, row: int):
        """Handle market selection change."""
        markets = ["KR", "US"]
        if 0 <= row < len(markets):
            self.current_market = markets[row]
            self.market_indicator.setText(f"Market: {self.current_market}")
            self.update_coverage()
            self.results_table.setRowCount(0)
            self.current_results = []
            self.detail_drawer.clear()
            self.candidates_label.setText("Candidates: -")
            self.state_banner.show_ready()
            # Re-check server health for new market
            self.check_server_health()

    def on_scan_mode_changed(self, mode: ScanMode):
        """Handle scan mode change."""
        self.current_scan_mode = mode
        self.mode_indicator.setText(f"Mode: {mode.value}")

    def on_refresh_clicked(self):
        """Handle refresh button click."""
        if self.worker is not None and self.worker.isRunning():
            return

        self.refresh_btn.setEnabled(False)
        self.refresh_btn.setText("Loading...")
        self.state_banner.show_loading()

        self.worker = FetchWorker(self.client, self.current_market)
        self.worker.finished.connect(self.on_fetch_finished)
        self.worker.start()

    def on_fetch_finished(self, result):
        """Handle fetch completion."""
        self.refresh_btn.setEnabled(True)
        self.refresh_btn.setText("Refresh Data")

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.timestamp_label.setText(f"Last refresh: {timestamp}")

        # Update coverage first so we have the latest data
        self.update_coverage()

        if result.success:
            self.display_results(result.data)
            self.connection_label.setText("Server: OK")
            self.connection_label.setStyleSheet("color: green;")

            candidate_count = len(result.data.candidates)
            self.candidates_label.setText(f"Candidates: {candidate_count}")

            # Update state banner based on results and coverage
            self._update_state_banner(candidate_count)
        else:
            self.connection_label.setText(f"Server: {result.error[:30]}")
            self.connection_label.setStyleSheet("color: red;")
            self.results_table.setRowCount(0)
            self.current_results = []
            self.candidates_label.setText("Candidates: Error")
            self.state_banner.show_server_disconnected(result.error)

        self.update_cache_label()

    def _update_state_banner(self, candidate_count: int):
        """Update state banner based on results and coverage."""
        from .models import CoverageTrustLevel

        # Check coverage status first
        if self.current_coverage is None:
            self.state_banner.show_error("Unable to read coverage data")
            return

        trust = self.current_coverage.trust_level

        # If coverage is unreliable, always show warning
        if trust == CoverageTrustLevel.UNRELIABLE:
            self.state_banner.show_data_unreliable(self.current_coverage)
        elif candidate_count == 0:
            # Data is OK but no candidates found
            self.state_banner.show_no_candidates(self.current_coverage)
        else:
            # Candidates found
            self.state_banner.show_candidates_found(candidate_count)

    def display_results(self, response: ScreenResponse):
        """Display screening results in the table."""
        self.current_results = response.candidates
        candidates = response.candidates
        self.results_table.setSortingEnabled(False)
        self.results_table.setRowCount(len(candidates))

        for row, candidate in enumerate(candidates):
            # Store the candidate index for later retrieval
            symbol_item = QTableWidgetItem(candidate.symbol)
            symbol_item.setData(Qt.ItemDataRole.UserRole, row)
            self.results_table.setItem(row, 0, symbol_item)

            # Score as numeric for sorting
            score_item = QTableWidgetItem()
            score_item.setData(Qt.ItemDataRole.EditRole, candidate.score)
            self.results_table.setItem(row, 1, score_item)

            # Days to cross
            dtc_item = QTableWidgetItem()
            if candidate.days_to_cross is not None:
                dtc_item.setData(Qt.ItemDataRole.EditRole, candidate.days_to_cross)
            else:
                dtc_item.setText("-")
            self.results_table.setItem(row, 2, dtc_item)

            # Price values
            close_item = QTableWidgetItem()
            close_item.setData(Qt.ItemDataRole.EditRole, candidate.last_close)
            self.results_table.setItem(row, 3, close_item)

            ema20_item = QTableWidgetItem()
            ema20_item.setData(Qt.ItemDataRole.EditRole, candidate.ema20)
            self.results_table.setItem(row, 4, ema20_item)

            ema200_item = QTableWidgetItem()
            ema200_item.setData(Qt.ItemDataRole.EditRole, candidate.ema200)
            self.results_table.setItem(row, 5, ema200_item)

            # Gap and slope diff
            gap_item = QTableWidgetItem()
            gap_item.setData(Qt.ItemDataRole.EditRole, round(candidate.gap, 4))
            self.results_table.setItem(row, 6, gap_item)

            slope_item = QTableWidgetItem()
            slope_item.setData(Qt.ItemDataRole.EditRole, round(candidate.slope_diff, 6))
            self.results_table.setItem(row, 7, slope_item)

            self.results_table.setItem(
                row, 8, QTableWidgetItem(candidate.reason)
            )

        self.results_table.setSortingEnabled(True)

    def on_row_selected(self):
        """Handle row selection in results table."""
        selected = self.results_table.selectedItems()
        if not selected:
            self.detail_drawer.clear()
            return

        # Get the row index from the first column's UserRole data
        row = selected[0].row()
        symbol_item = self.results_table.item(row, 0)
        if symbol_item is None:
            return

        original_index = symbol_item.data(Qt.ItemDataRole.UserRole)
        if original_index is not None and original_index < len(self.current_results):
            result = self.current_results[original_index]
            self.detail_drawer.show_result(result)

    def on_load_analysis(self, symbol: str, market: str):
        """Handle request to load OB analysis."""
        if self.analyze_worker is not None and self.analyze_worker.isRunning():
            return

        self.detail_drawer.set_analysis_loading()

        self.analyze_worker = AnalyzeWorker(self.client, symbol, market)
        self.analyze_worker.finished.connect(self.on_analyze_finished)
        self.analyze_worker.start()

    def on_analyze_finished(self, result):
        """Handle analysis completion."""
        self.detail_drawer.set_analysis_ready()
        self.update_cache_label()

        if result.success:
            self.detail_drawer.show_analysis_result(result.data, result.from_cache)
        else:
            self.detail_drawer.show_analysis_error(result.error)

    def on_clear_cache_clicked(self):
        """Handle clear cache button click."""
        count = self.client.clear_analysis_cache()
        self.update_cache_label()
        QMessageBox.information(
            self,
            "Cache Cleared",
            f"Cleared {count} cached analysis entries."
        )

    def update_cache_label(self):
        """Update the cache size label in status bar."""
        size = self.client.analysis_cache.size
        self.cache_label.setText(f"Cache: {size}")

    def on_edit_watchlist_clicked(self):
        """Open the watchlist editor dialog."""
        from .coverage import get_data_root, get_watchlist_path

        data_root = get_data_root()
        watchlist_path = get_watchlist_path(data_root, self.current_market)

        self.watchlist_dialog = WatchlistEditorDialog(
            market=self.current_market,
            watchlist_path=str(watchlist_path),
            parent=self,
        )
        self.watchlist_dialog.watchlist_saved.connect(self.on_watchlist_saved)
        self.watchlist_dialog.show()

    def on_watchlist_saved(self):
        """Handle watchlist save - refresh coverage display."""
        self.update_coverage()
        self.results_table.setRowCount(0)
        self.current_results = []
        self.detail_drawer.clear()
        self.candidates_label.setText("Candidates: -")
        self.state_banner.show_ready()
