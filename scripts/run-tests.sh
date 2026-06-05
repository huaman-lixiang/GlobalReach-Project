#!/bin/bash

set -e

echo "🚀 GlobalReach V2.0 Test Runner"
echo "================================"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_RESET='\033[0m'

run_tests() {
    local test_type=$1
    local dir=$2
    local cmd=$3
    
    echo ""
    echo -e "${COLOR_YELLOW}▶ Running ${test_type} tests...${COLOR_RESET}"
    
    cd "$dir"
    
    if eval "$cmd"; then
        echo -e "${COLOR_GREEN}✅ ${test_type} tests passed!${COLOR_RESET}"
        return 0
    else
        echo -e "${COLOR_RED}❌ ${test_type} tests failed!${COLOR_RESET}"
        return 1
    fi
}

FAILED=0

echo ""
echo "========================================"
echo "  Test Suite: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

if [ "$1" = "unit" ] || [ -z "$1" ]; then
    run_tests "Frontend Unit" "./frontend" "npm run test:unit" || FAILED=1
fi

if [ "$1" = "integration" ] || [ -z "$1" ]; then
    run_tests "Frontend Integration" "./frontend" "npm run test:integration" || FAILED=1
fi

if [ "$1" = "api" ] || [ -z "$1" ]; then
    run_tests "API Integration" "./api" "npm test" || FAILED=1
fi

if [ "$1" = "e2e" ] || [ "$1" = "all" ]; then
    run_tests "E2E (Playwright)" "./frontend" "npm run test:e2e" || FAILED=1
fi

if [ "$1" = "coverage" ] || [ -z "$1" ]; then
    echo ""
    echo -e "${COLOR_YELLOW}▶ Generating coverage reports...${COLOR_RESET}"
    
    cd "./frontend"
    npm run test:coverage || FAILED=1
    
    echo ""
    echo -e "${COLOR_GREEN}📊 Coverage reports generated in ./coverage/${COLOR_RESET}"
fi

echo ""
echo "========================================"
if [ $FAILED -eq 0 ]; then
    echo -e "${COLOR_GREEN}✨ All tests passed successfully!${COLOR_RESET}"
    exit 0
else
    echo -e "${COLOR_RED}💥 Some tests failed. Please check the output above.${COLOR_RESET}"
    exit 1
fi
