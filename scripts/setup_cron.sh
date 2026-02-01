#!/bin/bash
# Setup cron job for daily updates

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UPDATE_SCRIPT="$PROJECT_DIR/scripts/daily_update.sh"

echo "Setting up daily update cron job..."
echo ""

# Make update script executable
chmod +x "$UPDATE_SCRIPT"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "daily_update.sh"; then
    echo "Cron job already exists!"
    echo ""
    echo "Current crontab entry:"
    crontab -l | grep daily_update
    echo ""
    read -p "Replace existing job? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
    # Remove existing
    crontab -l | grep -v "daily_update.sh" | crontab -
fi

# Add cron job: Run daily at 1:00 AM
(crontab -l 2>/dev/null; echo "0 1 * * * $UPDATE_SCRIPT >> $PROJECT_DIR/logs/cron.log 2>&1") | crontab -

echo ""
echo "Cron job installed!"
echo ""
echo "  Schedule: Daily at 1:00 AM"
echo "  Script:   $UPDATE_SCRIPT"
echo "  Logs:     $PROJECT_DIR/logs/cron.log"
echo ""
echo "Commands:"
echo "  View cron jobs:  crontab -l"
echo "  Edit cron jobs:  crontab -e"
echo "  Test manually:   $UPDATE_SCRIPT"
