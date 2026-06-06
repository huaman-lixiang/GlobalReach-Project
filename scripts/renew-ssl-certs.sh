#!/bin/bash
# ============================================================
# GlobalReach V2.0 — SSL Certificate Auto-Renewal Script
# S101/PhaseH: Let's Encrypt Integration
# ============================================================
#
# USAGE:
#   Manual renew:    ./scripts/renew-ssl-certs.sh
#   Dry-run test:    ./scripts/renew-ssl-certs.sh --dry-run
#   Cron schedule:  0 3 * * * /path/to/scripts/renew-ssl-certs.sh >> /var/log/ssl-renewal.log 2>&1
#
# PREREQUISITES:
#   - Docker Compose with certbot service (--profile ssl)
#   - Nginx running with ACME challenge location configured
#   - Valid DNS A records pointing to this server
#
# ============================================================

set -euo pipefail

# ---- Configuration ----
COMPOSE_FILE="docker-compose.prod.yml"
CERTBOT_PROFILE="ssl"
LOG_PREFIX="[SSL-RENEWAL]"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ---- Functions ----
log_info()  { echo -e "${GREEN}${LOG_PREFIX} [INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}${LOG_PREFIX} [WARN]${NC} $1"; }
log_error() { echo -e "${RED}${LOG_PREFIX} [ERROR]${NC} $1"; }

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    # Check docker compose
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available"
        exit 1
    fi

    # Check compose file exists
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_error "Compose file not found: $COMPOSE_FILE"
        exit 1
    fi

    # Check Nginx is running
    if ! docker ps --format '{{.Names}}' | grep -q 'globalreach-nginx-prod'; then
        log_warn "Nginx container not running — ACME challenges may fail"
    fi

    log_info "Prerequisites check passed ✓"
}

renew_certificates() {
    local dry_run="${1:-false}"

    log_info "Starting certificate renewal process..."

    # Build certbot command
    local cmd="docker compose -f $COMPOSE_FILE --profile $CERTBOT_PROFILE run --rm certbot"

    if [[ "$dry_run" == "true" ]]; then
        cmd="$cmd renew --dry-run"
        log_info "Running in DRY-RUN mode (no actual changes)"
    else
        cmd="$cmd renew --webroot --webroot-path /var/www --quiet"
    fi

    # Execute renewal
    if eval "$cmd"; then
        log_info "Certificate renewal completed successfully ✓"
        return 0
    else
        log_error "Certificate renewal failed"
        return 1
    fi
}

reload_nginx() {
    log_info "Reloading Nginx to apply new certificates..."

    if docker exec globalreach-nginx-prod nginx -t > /dev/null 2>&1; then
        docker exec globalreach-nginx-prod nginx -s reload
        log_info "Nginx reloaded successfully ✓"
    else
        log_error "Nginx config test failed — skipping reload"
        return 1
    fi
}

verify_certificate() {
    local domain="$1"
    local cert_path="./nginx/ssl/letsencrypt/live/globalreach.com/fullchain.pem"

    if [[ ! -f "$cert_path" ]]; then
        log_warn "Certificate file not found at $cert_path"
        return 1
    fi

    local expiry_date=$(openssl x509 -in "$cert_path" -noout -enddate 2>/dev/null | cut -d= -f2)
    local days_until_expiry=$(( ($(date -d "$expiry_date" +%s) - $(date +%s)) / 86400 ))

    if [[ $days_until_expiry -lt 30 ]]; then
        log_warn "Certificate for $domain expires in $days_until_expiry days!"
    else
        log_info "Certificate for $domain valid for $days_until_expiry more days ✓"
    fi
}

notify_status() {
    local subject="GlobalReach SSL Certificate Renewal"
    local message="SSL certificate renewal completed at $TIMESTAMP\nStatus: $1\nServer: $(hostname)"

    # Log to file (if writable)
    echo -e "$message" >> /var/log/ssl-renewal.log 2>/dev/null || true

    # Optional: Send notification (configure as needed)
    # curl -X POST "$WEBHOOK_URL" -d "{\"text\": \"$message\"}"
}

# ---- Main Execution ----
main() {
    local dry_run="false"

    # Parse arguments
    for arg in "$@"; do
        case $arg in
            --dry-run) dry_run="true"; shift ;;
            *) shift ;;
        esac
    done

    echo ""
    echo "============================================="
    echo "  GlobalReach SSL Certificate Renewal"
    echo "  $TIMESTAMP"
    echo "============================================="
    echo ""

    check_prerequisites

    if renew_certificates "$dry_run"; then
        if [[ "$dry_run" != "true" ]]; then
            reload_nginx
            verify_certificate "globalreach.com"
            notify_status "SUCCESS"
        else
            notify_status "DRY-RUN OK"
        fi
        log_info "Renewal process complete ✓"
        exit 0
    else
        notify_status "FAILED"
        log_error "Renewal process failed ✗"
        exit 1
    fi
}

main "$@"
