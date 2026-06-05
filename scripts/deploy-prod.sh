#!/bin/bash

set -e

echo "=============================================="
echo "        GlobalReach Production Deployment"
echo "=============================================="

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$PROJECT_DIR"

echo ""
echo "[1/6] Checking environment..."
if [ -z "$ENV_FILE" ]; then
    ENV_FILE=".env.prod"
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Production environment file not found: $ENV_FILE"
    exit 1
fi

echo "✓ Environment file exists: $ENV_FILE"

echo ""
echo "[2/6] Validating environment variables..."
REQUIRED_VARS=(
    "DB_NAME"
    "DB_USER"
    "DB_PASSWORD"
    "DB_HOST"
    "JWT_SECRET"
    "CSRF_SECRET"
    "SENDGRID_API_KEY"
)

for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=" "$ENV_FILE"; then
        echo "ERROR: Missing required environment variable: $var"
        exit 1
    fi
done

echo "✓ All required environment variables present"

echo ""
echo "[3/6] Building Docker images..."
docker-compose -f docker-compose.prod.yml build --no-cache

echo "✓ Docker images built successfully"

echo ""
echo "[4/6] Starting services..."
docker-compose -f docker-compose.prod.yml up -d

echo "✓ Services started"

echo ""
echo "[5/6] Waiting for services to be ready..."
sleep 30

echo ""
echo "[6/6] Running health checks..."

API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/health)
if [ "$API_HEALTH" -ne 200 ]; then
    echo "ERROR: API health check failed (HTTP $API_HEALTH)"
    docker-compose -f docker-compose.prod.yml logs api
    exit 1
fi

echo "✓ API health check passed"

echo ""
echo "=============================================="
echo "      Deployment Completed Successfully!"
echo "=============================================="
echo ""
echo "Services running:"
docker-compose -f docker-compose.prod.yml ps
echo ""
echo "Access URLs:"
echo "  Frontend: https://api.globalreach.com"
echo "  API: https://api.globalreach.com/api/v1"
echo "  Swagger UI: https://api.globalreach.com/api/v1/docs"
echo "  Prometheus: http://localhost:9090"
echo "  Grafana: http://localhost:3000"
echo ""
echo "Use 'docker-compose -f docker-compose.prod.yml logs -f' to monitor logs"
echo ""