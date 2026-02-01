#!/bin/bash
# Setup launchd for daily updates (Mac native scheduler)
# This is the recommended approach for macOS

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.liquidityhunter.dailyupdate.plist"
PLIST_FILE="$PROJECT_DIR/$PLIST_NAME"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

echo "Setting up LaunchAgent for daily updates..."
echo ""

# Make update script executable
chmod +x "$PROJECT_DIR/scripts/daily_update.sh"

# Create LaunchAgents directory if not exists
mkdir -p "$LAUNCH_AGENTS"

# Check if already loaded
if launchctl list 2>/dev/null | grep -q "liquidityhunter.dailyupdate"; then
    echo "LaunchAgent already loaded. Unloading first..."
    launchctl unload "$LAUNCH_AGENTS/$PLIST_NAME" 2>/dev/null || true
fi

# Copy plist
cp "$PLIST_FILE" "$LAUNCH_AGENTS/"

# Load the job
launchctl load "$LAUNCH_AGENTS/$PLIST_NAME"

echo ""
echo "LaunchAgent installed!"
echo ""
echo "  Schedule: Daily at 1:00 AM"
echo "  Script:   $PROJECT_DIR/scripts/daily_update.sh"
echo "  Logs:     $PROJECT_DIR/logs/launchd.log"
echo "  Errors:   $PROJECT_DIR/logs/launchd_error.log"
echo ""
echo "Commands:"
echo "  Check status:  launchctl list | grep liquidityhunter"
echo "  View logs:     tail -f $PROJECT_DIR/logs/launchd.log"
echo "  Test now:      $PROJECT_DIR/scripts/daily_update.sh"
echo "  Unload:        launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
