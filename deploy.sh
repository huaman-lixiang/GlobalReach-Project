#!/bin/bash

set -e

echo "=========================================="
echo " GlobalReach Production Deployment Script"
echo "=========================================="

if [ -z "$1" ]; then
    echo "Usage: $0 <environment>"
    echo "  environments: dev, staging, production"
    exit 1
fi

ENV=$1
echo "Deploying to $ENV environment..."

echo ""
echo "1. Loading environment variables..."
if [ -f ".env.prod" ]; then
    export $(cat .env.prod | grep -v '^#' | xargs)
    echo "   ✅ Loaded .env.prod"
else
    echo "   ❌ .env.prod not found"
    exit 1
fi

echo ""
echo "2. Pulling latest code..."
git pull origin main
echo "   ✅ Code updated"

echo ""
echo "3. Building Docker images..."
docker-compose -f docker-compose.prod.yml build --no-cache
echo "   ✅ Docker images built"

echo ""
echo "4. Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down
echo "   ✅ Existing containers stopped"

echo ""
echo "5. Starting services..."
docker-compose -f docker-compose.prod.yml up -d
echo "   ✅ Services started"

echo ""
echo "6. Waiting for services to be healthy..."
sleep 30

echo ""
echo "7. Checking service health..."
if curl -f http://localhost/api/v1/health; then
    echo "   ✅ API is healthy"
else
    echo "   ❌ API health check failed"
    docker-compose -f docker-compose.prod.yml logs api
    exit 1
fi

echo ""
echo "=========================================="
echo " Deployment completed successfully!"
echo "=========================================="
echo ""
echo "Service status:"
docker-compose -f docker-compose.prod.yml ps
echo ""
echo "Access URLs:"
echo "  Frontend: https://yourdomain.com"
echo "  API: https://yourdomain.com/api/v1"
echo "  Swagger UI: https://yourdomain.com/api/v1/docs"
echo "  Grafana: https://yourdomain.com/grafana (after configuring proxy)"