# GlobalReach SSL Migration Guide: Self-Signed → Let's Encrypt
# ============================================================
# S101/PhaseH | Production Deployment Instructions
# ============================================================

## Overview

This guide covers migrating from self-signed certificates to **Let's Encrypt**
publicly-trusted certificates. The infrastructure is already in place (certbot
service, ACME challenge location, renewal scripts). This document covers the
final production deployment steps.

## Prerequisites Checklist

- [ ] **Public DNS**: A records for all domains point to server's public IP:
  ```
  api.globalreach.com      → <SERVER_PUBLIC_IP>
  app.globalreach.com      → <SERVER_PUBLIC_IP>
  monitor.globalreach.com  → <SERVER_PUBLIC_IP>
  grafana.globalreach.com  → <SERVER_PUBLIC_IP>
  ```
- [ ] **Port 80 open**: HTTP must be accessible from internet (ACME challenge)
- [ ] **Port 443 open**: HTTPS traffic
- [ ] **Docker Compose running**: All services up via `docker compose -f docker-compose.prod.yml up -d`
- [ ] **Email configured**: Set `LETSENCRYPT_EMAIL` env var or use default

## Step-by-Step Deployment

### Step 1: Issue Certificates (First Time)

```bash
# Option A: Using certbot Docker service (recommended)
docker compose -f docker-compose.prod.yml --profile ssl up certbot

# Option B: Manual certbot command with custom options
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot \
  -w /var/www/certbot \
  -d api.globalreach.com \
  -d app.globalreach.com \
  -d monitor.globalreach.com \
  -d grafana.globalreach.com \
  --email admin@yourdomain.com \
  --agree-tos \
  --no-eff-email
```

**Expected output**:
```
Successfully received certificate.
Certificate saved at: /etc/letsencrypt/live/globalreach.com/fullchain.pem
Key saved at: /etc/letsencrypt/live/globalreach.com/privkey.pem
```

### Step 2: Verify Issued Certificates

```bash
# Check certificate details
openssl x509 -in ./nginx/ssl/letsencrypt/live/globalreach.com/fullchain.pem \
  -noout -subject -issuer -dates

# Expected: Issuer = Let's Encrypt E1 (not GlobalReach CA)
```

### Step 3: Switch Nginx to LE Certificates

Edit `nginx/conf.d/production.conf` — change all `ssl_certificate` and
`ssl_certificate_key` paths:

```nginx
# BEFORE (self-signed):
ssl_certificate /etc/nginx/ssl/globalreach/globalreach.crt;
ssl_certificate_key /etc/nginx/ssl/globalreach/globalreach.key;

# AFTER (Let's Encrypt):
ssl_certificate /etc/nginx/ssl/le/live/globalreach.com/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/le/live/globalreach.com/privkey.pem;
```

Apply to ALL server blocks (api, app, monitor).

### Step 4: Reload Nginx

```bash
# Test config first
docker exec globalreach-nginx-prod nginx -t

# Reload (zero-downtime)
docker exec globalreach-nginx-prod nginx -s reload
```

### Step 5: Verify in Browser

```
https://api.globalreach.com/api/v1/health
→ Should show 🔒 padlock (no browser warning)
→ Certificate: Let's Encrypt E1, valid 90 days
```

### Step 6: Test Renewal Pipeline

```bash
# Dry-run (validates renewal works without actual changes)
.\scripts\renew-ssl-certs.ps1 -DryRun

# Or Linux:
./scripts/renew-ssl-certs.sh --dry-run
```

### Step 7: Install Auto-Renewal Scheduled Task

```powershell
# Windows (runs daily at 03:00):
.\scripts\renew-ssl-certs.ps1 -InstallTask

# Verify task installed:
Get-ScheduledTask | Where-Object {$_.TaskName -like "*GlobalReach*"}
```

## Wildcard Certificate (Optional Advanced)

For wildcard `*.globalreach.com`, use DNS-01 challenge instead of HTTP-01:

```bash
# Requires DNS provider API key (Cloudflare, Route53, etc.)
docker compose run --rm certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /secrets/cloudflare.ini \
  -d "globalreach.com" -d "*.globalreach.com" \
  --email admin@globalreach.com \
  --agree-tos
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `urn:acme:error:unauthorized` | DNS not pointing to this server | Check A records, wait for propagation |
| `too many certificates already issued` | Rate limit hit | Use `--staging` for testing |
| `Connection refused` on port 80 | Firewall blocking HTTP | Open port 80 for ACME challenge |
| `Nginx config test failed` | Cert file path wrong | Verify `/etc/nginx/ssl/le/live/...` path exists |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Internet (HTTPS :443)                     │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Nginx Reverse Proxy                    │    │
│  │  ssl_certificate: /etc/nginx/ssl/le/.../fullchain   │    │
│  │  [ACME: /.well-known/acme-challenge/ → port 80]     │    │
│  └──────┬──────────┬──────────┬──────────┬─────────────┘    │
│         │          │          │          │                   │
│    API(3000)   Frontend   Grafana   Prometheus              │
│         │          │       (3002)    (9090)                  │
│  ┌──────┴──────────┴──────────┴──────────┴─────────────┐    │
│  │              Docker Network                          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Certbot Container (--profile ssl)          │    │
│  │  Volumes: letsencrypt/ + acme-challenge/             │    │
│  │  Command: certonly --webroot -w /var/www/certbot     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │        Auto-Renewal (Scheduled Task / Cron)          │    │
│  │  Daily 03:00 → renew → nginx reload                 │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Rollback Plan

If LE certs cause issues, revert to self-signed:

```bash
# Revert nginx/conf.d/production.conf paths back to:
#   ssl_certificate /etc/nginx/ssl/globalreach/globalreach.crt;
#   ssl_certificate_key /etc/nginx/ssl/globalreach/globalreach.key;

docker exec globalreach-nginx-prod nginx -s reload
```

---

**Document Version**: S101/v1.0
**Last Updated**: 2026-06-06
**Session**: S101 — SSL/TLS Certificate Upgrade
