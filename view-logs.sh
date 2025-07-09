#!/bin/bash

LOG_FILE="loggingSystem/logs/payment_logs.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Payment Logs Viewer ===${NC}"

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    echo -e "${RED}Log file not found: $LOG_FILE${NC}"
    exit 1
fi

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  all          - Show all logs"
    echo "  recent       - Show last 10 logs"
    echo "  user USERID  - Show logs for specific user"
    echo "  domain       - Show only domain purchases"
    echo "  email        - Show only email creations"
    echo "  failed       - Show only failed operations"
    echo "  today        - Show today's logs"
    echo "  stats        - Show log statistics"
    echo "  watch        - Watch logs in real-time"
    echo "  help         - Show this help"
}

# Function to show statistics
show_stats() {
    echo -e "${YELLOW}=== Log Statistics ===${NC}"
    
    total_logs=$(jq 'length' "$LOG_FILE" 2>/dev/null || echo "0")
    echo "Total logs: $total_logs"
    
    domain_purchases=$(jq '[.[] | select(.type == "domain_purchase")] | length' "$LOG_FILE" 2>/dev/null || echo "0")
    echo "Domain purchases: $domain_purchases"
    
    email_creations=$(jq '[.[] | select(.type == "email_creation")] | length' "$LOG_FILE" 2>/dev/null || echo "0")
    echo "Email creations: $email_creations"
    
    failed_ops=$(jq '[.[] | select(.status == "failed")] | length' "$LOG_FILE" 2>/dev/null || echo "0")
    echo "Failed operations: $failed_ops"
    
    file_size=$(du -h "$LOG_FILE" | cut -f1)
    echo "File size: $file_size"
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
    "user")
        if [ -z "$2" ]; then
            echo -e "${RED}Please provide a user ID${NC}"
            exit 1
        fi
        echo -e "${GREEN}Showing logs for user: $2${NC}"
        jq "[.[] | select(.userId == \"$2\")]" "$LOG_FILE"
        ;;
    "domain")
        echo -e "${GREEN}Showing domain purchases:${NC}"
        jq '[.[] | select(.type == "domain_purchase")]' "$LOG_FILE"
        ;;
    "email")
        echo -e "${GREEN}Showing email creations:${NC}"
        jq '[.[] | select(.type == "email_creation")]' "$LOG_FILE"
        ;;
    "failed")
        echo -e "${RED}Showing failed operations:${NC}"
        jq '[.[] | select(.status == "failed")]' "$LOG_FILE"
        ;;
    "today")
        today=$(date +%Y-%m-%d)
        echo -e "${GREEN}Showing today's logs ($today):${NC}"
        jq "[.[] | select(.timestamp | startswith(\"$today\"))]" "$LOG_FILE"
        ;;
    "stats")
        show_stats
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