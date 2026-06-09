#!/bin/bash
# Generate high-entropy secrets for GlobalReach production
# Usage: bash scripts/generate-secrets.sh
set -euo pipefail

echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# Copy to .env.prod and NEVER commit this file"
echo ""
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "CSRF_SECRET=$(openssl rand -hex 32)"
echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '=+/')"
echo "GF_SMTP_PASSWORD=<your-smtp-auth-code>"
echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 16 | tr -d '=+/')"
