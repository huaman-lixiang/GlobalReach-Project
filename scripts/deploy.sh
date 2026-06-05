#!/bin/bash

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  🚀 GlobalReach V2.0 - Production Deployment Script          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_RESET='\033[0m'

log_info() { echo -e "${COLOR_BLUE}[INFO]${COLOR_RESET} $1"; }
log_success() { echo -e "${COLOR_GREEN}[✓]${COLOR_RESET} $1"; }
log_warn() { echo -e "${COLOR_YELLOW}[!]${COLOR_RESET} $1"; }
log_error() { echo -e "${COLOR_RED}[✗]${COLOR_RESET} $1"; }

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    log_success "Docker is installed: $(docker --version)"
    
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed."
        exit 1
    fi
    log_success "Docker Compose is ready"
    
    if [ ! -f ".env.production" ]; then
        log_warn ".env.production not found, copying from template..."
        cp .env.example .env.production
        log_warn "Please edit .env.production with your production values!"
        read -p "Press Enter to continue or Ctrl+C to abort..."
    fi
    
    log_success "Prerequisites check passed!"
}

build_frontend() {
    log_info "Building frontend for production..."
    
    cd frontend
    npm ci --silent
    npm run build
    
    if [ $? -eq 0 ]; then
        log_success "Frontend build completed!"
        
        mkdir -p ../frontend-dist
        rm -rf ../frontend-dist/*
        cp -r dist/* ../frontend-dist/
        
        cd ..
        log_success "Frontend assets copied to frontend-dist/"
    else
        log_error "Frontend build failed!"
        exit 1
    fi
}

deploy_infrastructure() {
    log_info "Deploying infrastructure with Docker Compose..."
    
    docker-compose -f docker-compose.prod.yml down --remove-orphans
    docker-compose -f docker-compose.prod.yml pull || true
    docker-compose -f docker-compose.prod.yml up -d --build --force-recreate
    
    if [ $? -eq 0 ]; then
        log_success "Infrastructure deployed successfully!"
    else
        log_error "Deployment failed! Check logs with: docker-compose -f docker-compose.prod.yml logs"
        exit 1
    fi
}

wait_for_healthy() {
    log_info "Waiting for services to become healthy..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -sf http://localhost:${API_PORT:-3000}/api/health > /dev/null 2>&1; then
            log_success "API is healthy after ${attempt} attempts!"
            return 0
        fi
        
        log_info "Attempt $attempt/$max_attempts - Waiting for API..."
        sleep 5
        ((attempt++))
    done
    
    log_error "API did not become healthy in time!"
    return 1
}

show_status() {
    echo ""
    log_info "Deployment Status:"
    echo "─────────────────────────────────────────────"
    docker-compose -f docker-compose.prod.yml ps
    echo ""
    log_info "Service URLs:"
    echo "  └─ API: http://localhost:${API_PORT:-3000}"
    echo "  └─ Health Check: http://localhost:${API_PORT:-3000}/api/health"
    echo "  └─ Metrics: http://localhost:${API_PORT:-3000}/metrics"
    echo "  └─ Nginx (HTTP): http://localhost:${NGINX_HTTP_PORT:-80}"
    echo "  └─ Nginx (HTTPS): https://localhost:${NGINX_HTTPS_PORT:-443}"
    echo ""
}

cleanup_old_data() {
    log_info "Cleaning up old Docker resources..."
    docker system prune -f --volumes
    log_success "Cleanup completed!"
}

case "${1:-deploy}" in
    prereqs)
        check_prerequisites
        ;;
    build)
        build_frontend
        ;;
    deploy)
        check_prerequisites
        build_frontend
        deploy_infrastructure
        wait_for_healthy
        show_status
        ;;
    status)
        docker-compose -f docker-compose.prod.yml ps
        docker-compose -f docker-compose.prod.yml logs --tail=50
        ;;
    logs)
        docker-compose -f docker-compose.prod logs -f ${2:-}
        ;;
    stop)
        docker-compose -f docker-compose.prod.yml down
        log_success "Services stopped!"
        ;;
    restart)
        docker-compose -f docker-compose.prod.yml restart
        wait_for_healthy
        show_status
        ;;
    cleanup)
        cleanup_old_data
        ;;
    *)
        echo "Usage: $0 {prereqs|build|deploy|status|logs|stop|restart|cleanup}"
        exit 1
        ;;
esac

echo ""
log_success "✨ Operation completed successfully!"
