#!/bin/bash

LOG_FILE="loggingSystem/logs/sales_nav_logs.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Sales Navigator Logs Viewer ===${NC}"

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    echo -e "${RED}Log file not found: $LOG_FILE${NC}"
    echo "The file will be created once the first Sales Nav API call is made."
    exit 1
fi

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  all          - Show all logs"
    echo "  recent       - Show last 10 logs"
    echo "  watch        - Watch logs in real-time"
    echo "  errors       - Show only error logs"
    echo "  help         - Show this help"
}

# Main script logic
case "$1" in
    "all")
        echo -e "${GREEN}Showing all logs:${NC}"
        jq '.' "$LOG_FILE"
        ;;
    "recent")
        echo -e "${GREEN}Showing last 10 logs:${NC}"
        jq '.[-10:]' "$LOG_FILE"
        ;;
    "errors")
        echo -e "${RED}Showing only error logs:${NC}"
        jq '[.[] | select(.step == "error")]' "$LOG_FILE"
        ;;
    "watch")
        echo -e "${GREEN}Watching logs in real-time (Ctrl+C to stop):${NC}"
        tail -f "$LOG_FILE" | jq '.'
        ;;
    "help"|"")
        show_usage
        ;;
    *)
        echo -e "${RED}Unknown option: $1${NC}"
        show_usage
        exit 1
        ;;
esac
