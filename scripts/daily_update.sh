#!/bin/bash
# Daily update script for cron/launchd
# Updates all stock data with latest trading day

set -e

PROJECT_DIR="/Users/thkmacstudio1/LiquidityHunter"
LOG_DIR="$PROJECT_DIR/logs"
VENV="$PROJECT_DIR/.venv/bin/python3"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Change to project directory
cd "$PROJECT_DIR"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Log start
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting daily update..." >> "$LOG_DIR/cron.log"

# Run updater
$VENV "$PROJECT_DIR/engine/data/daily_updater.py"

# Log completion
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Daily update completed." >> "$LOG_DIR/cron.log"

exit 0
