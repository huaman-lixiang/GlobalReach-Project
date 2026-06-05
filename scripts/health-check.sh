#!/bin/bash

set -e

echo "=============================================="
echo "        GlobalReach Health Check"
echo "=============================================="

ERROR_COUNT=0

check_service() {
    local service_name=$1
    local url=$2
    local expected_code=${3:-200}
    
    echo ""
    echo "Checking $service_name..."
    
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
    
    if [ "$response_code" -eq "$expected_code" ]; then
        echo "✓ $service_name is healthy (HTTP $response_code)"
    else
        echo "✗ $service_name is unhealthy (HTTP $response_code)"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
}

echo ""
echo "[1/5] Checking API health..."
check_service "API" "http://localhost/api/v1/health"

echo ""
echo "[2/5] Checking Database connection..."
check_service "Database" "http://localhost:5432" 000

echo ""
echo "[3/5] Checking Redis..."
check_service "Redis" "http://localhost:6379" 000

echo ""
echo "[4/5] Checking Prometheus..."
check_service "Prometheus" "http://localhost:9090/-/healthy"

echo ""
echo "[5/5] Checking Grafana..."
check_service "Grafana" "http://localhost:3000/api/health"

echo ""
echo "=============================================="

if [ "$ERROR_COUNT" -eq 0 ]; then
    echo "✅ All services are healthy!"
    exit 0
else
    echo "❌ $ERROR_COUNT service(s) are unhealthy"
    exit 1
fi