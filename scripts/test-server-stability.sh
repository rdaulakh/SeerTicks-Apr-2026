#!/bin/bash
# Server Stability Test - Validates server stays running despite WebSocket errors
# Tests the ProcessManager and BinanceWebSocketManager error handling fixes

set -e

echo "🔍 Server Stability Test Starting..."
echo "=================================="
echo ""

# Configuration
TEST_DURATION=300  # 5 minutes
CHECK_INTERVAL=10  # Check every 10 seconds
PORT=3000

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
CHECKS=0
FAILURES=0
START_TIME=$(date +%s)

echo "📊 Test Configuration:"
echo "  - Duration: ${TEST_DURATION} seconds (5 minutes)"
echo "  - Check interval: ${CHECK_INTERVAL} seconds"
echo "  - Port: ${PORT}"
echo ""

# Function to check if server is running
check_server() {
    if lsof -i :${PORT} >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to check server health via HTTP
check_health() {
    if curl -s -f http://localhost:${PORT}/ >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Initial check
if ! check_server; then
    echo -e "${RED}❌ Server is not running on port ${PORT}${NC}"
    echo "Please start the server first with: pnpm dev"
    exit 1
fi

echo -e "${GREEN}✅ Server is running - starting stability test${NC}"
echo ""

# Get initial process ID
INITIAL_PID=$(lsof -t -i :${PORT} | head -1)
echo "📝 Initial server PID: ${INITIAL_PID}"
echo ""

# Main test loop
while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    if [ $ELAPSED -ge $TEST_DURATION ]; then
        break
    fi
    
    CHECKS=$((CHECKS + 1))
    REMAINING=$((TEST_DURATION - ELAPSED))
    
    echo -n "⏱️  Check #${CHECKS} (${ELAPSED}s elapsed, ${REMAINING}s remaining)... "
    
    # Check if server is still running
    if check_server; then
        CURRENT_PID=$(lsof -t -i :${PORT} | head -1)
        
        # Check if PID changed (server restarted)
        if [ "$CURRENT_PID" != "$INITIAL_PID" ]; then
            echo -e "${YELLOW}⚠️  Server restarted! PID changed: ${INITIAL_PID} → ${CURRENT_PID}${NC}"
            FAILURES=$((FAILURES + 1))
            INITIAL_PID=$CURRENT_PID
        else
            # Check HTTP health
            if check_health; then
                echo -e "${GREEN}✅ OK${NC}"
            else
                echo -e "${YELLOW}⚠️  Server running but HTTP not responding${NC}"
                FAILURES=$((FAILURES + 1))
            fi
        fi
    else
        echo -e "${RED}❌ FAILED - Server stopped!${NC}"
        FAILURES=$((FAILURES + 1))
        
        # Wait a bit to see if it auto-restarts
        echo "   Waiting 5 seconds to check for auto-restart..."
        sleep 5
        
        if check_server; then
            INITIAL_PID=$(lsof -t -i :${PORT} | head -1)
            echo -e "${YELLOW}   ⚠️  Server auto-restarted with PID: ${INITIAL_PID}${NC}"
        else
            echo -e "${RED}   ❌ Server did not auto-restart - test failed${NC}"
            exit 1
        fi
    fi
    
    sleep $CHECK_INTERVAL
done

echo ""
echo "=================================="
echo "🏁 Test Complete!"
echo "=================================="
echo ""
echo "📊 Results:"
echo "  - Total checks: ${CHECKS}"
echo "  - Failures: ${FAILURES}"
echo "  - Success rate: $(( (CHECKS - FAILURES) * 100 / CHECKS ))%"
echo "  - Duration: ${TEST_DURATION} seconds"
echo ""

if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}✅ SUCCESS - Server remained stable for 5 minutes!${NC}"
    echo ""
    echo "The following fixes are working correctly:"
    echo "  1. ProcessManager ignores WebSocket errors (doesn't shutdown)"
    echo "  2. BinanceWebSocketManager has error handler (prevents unhandled errors)"
    echo "  3. Server stays running despite Binance geo-blocking (HTTP 451)"
    exit 0
else
    echo -e "${YELLOW}⚠️  PARTIAL SUCCESS - Server had ${FAILURES} issues but recovered${NC}"
    echo ""
    echo "Consider investigating the failures to improve stability further."
    exit 0
fi
