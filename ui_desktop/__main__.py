"""Entry point for the LiquidityHunter Diagnostic Desktop App.

Usage:
    python -m ui_desktop

Prerequisites:
    1. Start the backend server:
       uvicorn engine.api.app:app --reload --port 8000

    2. Run this app:
       python -m ui_desktop
"""

import sys

from PySide6.QtWidgets import QApplication

from .main_window import MainWindow


def main():
    """Main entry point."""
    app = QApplication(sys.argv)

    # Set application metadata
    app.setApplicationName("LiquidityHunter Diagnostic Console")
    app.setApplicationVersion("0.1.0")
    app.setOrganizationName("LiquidityHunter")

    # Create and show main window
    window = MainWindow()
    window.show()

    # Run event loop
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
