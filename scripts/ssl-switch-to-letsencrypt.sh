#!/bin/bash
# ============================================================
# GlobalReach V2.0 — SSL Switch Script: Self-Signed → Let's Encrypt
# S119/Post-Go-Live: One-Command Certificate Migration
#
# Usage:
#   ./scripts/ssl-switch-to-letsencrypt.sh          # Full migration
#   ./scripts/ssl-switch-to-letsencrypt.sh --dry-run # Test only
#   ./scripts/ssl-switch-to-letsencrypt.sh --rollback # Revert to self-signed
#
# Prerequisites:
#   - DNS records configured (see DEPLOYMENT_DNS_SSL.md Part 1)
#   - Server accessible on ports 80 and 443
#   - Docker Compose stack running
# ============================================================

set -euo pipefail

# ─── Configuration ──────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.prod.yml"
NGINX_CONF_DEV="${PROJECT_DIR}/nginx/conf.d/production.conf"
NGINX_CONF_LE="${PROJECT_DIR}/nginx/conf.d/ssl-le-production.conf"
BACKUP_DIR="${PROJECT_DIR}/nginx/ssl/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DOMAIN="globalreach.com"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── Pre-flight Checks ──────────────────────────────────
preflight_checks() {
    log_info "Running pre-flight checks..."

    if [[ ! -f "${COMPOSE_FILE}" ]]; then
        log_err "docker-compose.prod.yml not found at ${COMPOSE_FILE}"
        exit 1
    fi
    log_ok "docker-compose.prod.yml found"

    if ! command -v docker &>/dev/null; then
        log_err "Docker not found in PATH"
        exit 1
    fi
    log_ok "Docker available: $(docker --version)"

    if ! docker ps &>/dev/null; then
        log_err "Docker daemon not running or no permission"
        exit 1
    fi
    log_ok "Docker daemon running"

    if ! docker compose -f "${COMPOSE_FILE}" ps --format "{{.Names}}" 2>/dev/null | grep -q "nginx"; then
        log_warn "Nginx container not running. Starting stack..."
        docker compose -f "${COMPOSE_FILE}" up -d nginx
    fi
    log_ok "Nginx container running"

    # Check DNS resolution (basic)
    if dig +short api.${DOMAIN} &>/dev/null || nslookup api.${DOMAIN} &>/dev/null; then
        log_ok "DNS resolves for api.${DOMAIN}"
    else
        log_warn "DNS for api.${DOMAIN} may not be configured yet"
        log_warn "Let's Encrypt issuance will fail without valid DNS!"
    fi

    echo ""
}

# ─── Step 1: Backup Current State ───────────────────────
backup_current() {
    log_info "Step 1: Backing up current configuration..."
    mkdir -p "${BACKUP_DIR}"

    # Backup current nginx config
    cp "${NGINX_CONF_DEV}" "${BACKUP_DIR}/production.conf.${TIMESTAMP}.bak"
    log_ok "Backed up production.conf"

    # Backup SSL directory
    cp -r "${PROJECT_DIR}/nginx/ssl/globalreach" "${BACKUP_DIR}/globalreach.${TIMESTAMP}.bak/"
    log_ok "Backed up self-signed certificates"

    echo ""
}

# ─── Step 2: Issue Let's Encrypt Certificates ────────────
issue_certificates() {
    log_info "Step 2: Issuing Let's Encrypt certificates..."

    # Create ACME webroot directory
    mkdir -p "${PROJECT_DIR}/nginx/acme-challenge"

    # Run certbot via Docker
    log_info "Running certbot (this may take 1-2 minutes)..."
    docker compose -f "${COMPOSE_FILE}" run --rm \
        -e CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN}}" \
        certbot \
        certonly \
        --webroot \
        -w /var/www/acme-challenge \
        -d "api.${DOMAIN}" \
        -d "app.${DOMAIN}" \
        -d "monitor.${DOMAIN}" \
        -d "grafana.${DOMAIN}" \
        --email "${CERTBOT_EMAIL:-admin@${DOMAIN}}" \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        2>&1

    local exit_code=$?
    if [[ ${exit_code} -eq 0 ]]; then
        log_ok "Certificates issued successfully!"

        # Verify certificate files exist
        local le_dir="${PROJECT_DIR}/nginx/ssl/letsencrypt/live/${DOMAIN}"
        if [[ -f "${le_dir}/fullchain.pem" && -f "${le_dir}/privkey.pem" ]]; then
            log_ok "Certificate files verified:"
            ls -la "${le_dir}/"*.pem
        else
            log_err "Certificate files not found at expected path: ${le_dir}"
            exit 1
        fi
    else
        log_err "Certbot failed with exit code ${exit_code}"
        log_err "Check DNS records and port 80 accessibility"
        exit 1
    fi

    echo ""
}

# ─── Step 3: Switch Nginx Configuration ─────────────────
switch_nginx_config() {
    log_info "Step 3: Switching Nginx to Let's Encrypt certificates..."

    # Replace production.conf with LE version
    cp "${NGINX_CONF_LE}" "${NGINX_CONF_DEV}"
    log_ok "Nginx config updated to use LE certificates"

    # Reload Nginx
    log_info "Reloading Nginx..."
    docker compose -f "${COMPOSE_FILE}" exec nginx nginx -t 2>&1
    if [[ $? -eq 0 ]]; then
        docker compose -f "${COMPOSE_FILE}" exec nginx nginx -s reload
        log_ok "Nginx reloaded successfully"
    else
        log_err "Nginx config test failed! Rolling back..."
        rollback
        exit 1
    fi

    echo ""
}

# ─── Step 4: Verify HTTPS ───────────────────────────────
verify_ssl() {
    log_info "Step 4: Verifying HTTPS configuration..."

    sleep 3  # Wait for reload

    # Check certificate details
    echo "--- Certificate Info ---"
    openssl s_client -connect api.${DOMAIN}:443 -servername api.${DOMAIN} </dev/null 2>/dev/null | \
        openssl x509 -noout -subject -issuer -dates 2>/dev/null || \
        log_warn "Could not verify certificate (server may not be public)"

    echo ""
    log_info "Testing SSL Labs grade (manual):"
    log_info "  Visit: https://www.ssllabs.com/ssltest/analyze.html?d=api.${DOMAIN}"
    log_info "  Expected: A+ (with OCSP stapling + HSTS preload)"

    echo ""
    log_ok "=== SSL Migration Complete ==="
    log_info "Your site is now using Let's Encrypt certificates!"
    log_info "Auto-renewal is set up via cron/systemd timer."
}

# ─── Rollback ───────────────────────────────────────────
rollback() {
    log_warn "Rolling back to self-signed certificates..."

    local latest_backup=$(ls -t "${BACKUP_DIR}"/production.conf.*.bak 2>/dev/null | head -1)
    if [[ -n "${latest_backup}" ]]; then
        cp "${latest_backup}" "${NGINX_CONF_DEV}"
        log_ok "Restored production.conf from backup"
    else
        log_err "No backup found! Manual intervention required."
        exit 1
    fi

    docker compose -f "${COMPOSE_FILE}" exec nginx nginx -t 2>&1 && \
        docker compose -f "${COMPOSE_FILE}" exec nginx nginx -s reload
    log_ok "Nginx reloaded with self-signed certificates"
}

# ─── Dry Run Mode ───────────────────────────────────────
dry_run() {
    log_info "=== DRY RUN MODE — No changes will be made ==="
    echo ""

    preflight_checks
    log_info "Would do:"
    log_info "  1. Backup current config to ${BACKUP_DIR}/"
    log_info "  2. Issue LE certs for: api/app/monitor/grafana.${DOMAIN}"
    log_info "  3. Switch ${NGINX_CONF_DEV} → LE version"
    log_info "  4. Reload Nginx"
    log_info "  5. Verify HTTPS"
    echo ""
    log_ok "Dry run complete. Remove --dry-run to execute."
}

# ─── Main ──────────────────────────────────────────────
main() {
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  GlobalReach V2.0 — SSL Migration                  ║"
    echo "║  Self-Signed → Let's Encrypt                       ║"
    echo "║  S119 | $(date '+%Y-%m-%d %H:%M:%S')                            ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo ""

    case "${1:-}" in
        --dry-run|-n)
            dry_run
            ;;
        --rollback|-r)
            rollback
            ;;
        --help|-h|*)
            echo "Usage: $0 [option]"
            echo ""
            echo "Options:"
            echo "  (none)      Full migration: issue certs + switch + verify"
            echo "  --dry-run   Show what would happen without making changes"
            echo "  --rollback  Revert to self-signed certificates"
            echo "  --help      Show this help"
            echo ""
            echo "Environment variables:"
            echo "  CERTBOT_EMAIL  Email for LE registration (default: admin@globalreach.com)"
            ;;
    esac

    # If no argument or explicit run
    if [[ "${1:-}" != "--dry-run" && "${1:-}" != "--rollback" && "${1:-}" != "--help" && "${1:-}" != "-h" && -n "${1:-}" ]]; then
        preflight_checks
        backup_current
        issue_certificates
        switch_nginx_config
        verify_ssl
    elif [[ -z "${1:-}" ]]; then
        preflight_checks
        backup_current
        issue_certificates
        switch_nginx_config
        verify_ssl
    fi
}

main "$@"
