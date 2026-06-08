# GlobalReach V2.0 — SSL Migration Complete Guide
## S119/Post-Go-Live: Self-Signed → Let's Encrypt Production SSL

> **Session**: S119 | **Date**: 2026-06-08
> **Status**: **Configuration Ready — Awaiting DNS + Public Server**
>
> This guide provides everything needed to switch from development
> self-signed certificates to production Let's Encrypt TLS certificates.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Architecture Overview](#2-architecture-overview)
3. [Pre-Migration Checklist](#3-pre-migration-checklist)
4. [Migration Procedure (Step-by-Step)](#4-migration-procedure)
5. [One-Click Migration Script](#5-one-click-migration-script)
6. [Post-Migration Verification](#6-post-migration-verification)
7. [Automatic Renewal Setup](#7-automatic-renewal-setup)
8. [Rollback Procedure](#8-rollback-procedure)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Current State Analysis

### Before Migration (Current)

```
┌─────────────────────────────────────────────────────┐
│              CURRENT: Self-Signed Certificates       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Certificate Type:   CA-signed (self-generated)     │
│  Issuer:             GlobalReach CA (dev)           │
│  Validity:           365 days (manual renewal)      │
│  Browser Trust:      ❌ Untrusted (red warning)     │
│  OCSP Stapling:      Not available                 │
│  HSTS Preload:      ⚠️ Cannot submit to preload    │
│                                                     │
│  File Locations:                             │
│    globalreach.crt  → /etc/nginx/ssl/globalreach/  │
│    globalreach.key  → /etc/nginx/ssl/globalreach/  │
│    dhparam.pem      → /etc/nginx/ssl/dhparam.pem   │
│                                                     │
│  Nginx Config:        production.conf               │
│  Server Blocks:       3 (api/app/monitor)           │
│  Security Grade:      A++ config / B- trust         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### After Migration (Target)

```
┌─────────────────────────────────────────────────────┐
│            TARGET: Let's Encrypt Certificates        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Certificate Type:   DV TLS Certificate (LE)        │
│  Issuer:             Let's Encrypt E1 (ISRG Root X2)│
│  Validity:           90 days (auto-renewed)         │
│  Browser Trust:      ✅ Trusted by all browsers     │
│  OCSP Stapling:      ✅ Enabled                     │
│  HSTS Preload:      ✅ Can submit to hstspreload.org│
│                                                     │
│  File Locations:                              │
│    fullchain.pem    → /etc/nginx/ssl/le/live/g..c/ │
│    privkey.pem     → /etc/nginx/ssl/le/live/g..c/ │
│    chain.pem       → /etc/nginx/ssl/le/live/g..c/ │
│    dhparam.pem     → /etc/nginx/ssl/dhparam.pem    │
│                                                     │
│  Nginx Config:        ssl-le-production.conf        │
│  Server Blocks:       3 (same domains)              │
│  Security Grade:      A++ config / A+ trust         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

### SSL Certificate Flow

```
                    ┌──────────────────┐
                    │  Let's Encrypt   │
                    │  ACME Server     │
                    └────────┬─────────┘
                             │ HTTPS (port 443)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                   PRODUCTION SERVER                           │
│                                                              │
│  ┌─────────┐    ┌─────────────┐    ┌──────────────────┐     │
│  │  Nginx   │◄───│  Certbot    │◄───│ ACME Challenge   │     │
│  │ :80/:443 │    │ Container   │    │ /.well-known/    │     │
│  └────┬─────┘    └──────┬──────┘    └──────────────────┘     │
│       │                │                                     │
│       │  LE certs      │ writes certs                        │
│       ▼                ▼                                     │
│  ┌─────────────────────────────────┐                         │
│  │ ./nginx/ssl/letsencrypt/live/   │                         │
│  │   ├── fullchain.pem  (cert+chain)                       │
│  │   ├── privkey.pem    (private key)                      │
│  │   ├── chain.pem      (intermediate)                     │
│  │   └── cert.pem       (leaf only)                        │
│  └─────────────────────────────────┘                         │
│                                                              │
│  Volume mount: letsencrypt:/etc/nginx/ssl/le:ro              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Files Delivered in S119

| File | Purpose |
|------|---------|
| `nginx/conf.d/ssl-le-production.conf` | Drop-in replacement for `production.conf` with LE paths + OCSP stapling |
| `scripts/ssl-switch-to-letsencrypt.sh` | One-click migration script (backup → issue → switch → verify) |
| `docker-compose.prod.yml` (updated) | Enhanced Certbot service with deploy hook for auto-reload |

---

## 3. Pre-Migration Checklist

Complete ALL items before running migration:

### Infrastructure Prerequisites

- [ ] **Public server** with static IP address
- [ ] **Domain ownership**: `globalreach.com` (or your actual domain)
- [ ] **DNS records configured** (see DEPLOYMENT_DNS_SSL.md Part 1):
  - [ ] A record: `@` → SERVER_IP
  - [ ] A record: `api` → SERVER_IP
  - [ ] A record: `app` → SERVER_IP
  - [ ] A record: `monitor` → SERVER_IP
  - [ ] A record: `grafana` → SERVER_IP
  - [ ] CNAME: `www` → `globalreach.com`
- [ ] **DNS propagation complete** (`dig +short api.globalreach.com` returns IP)
- [ ] **Firewall open**: ports 80 (HTTP) and 443 (HTTPS)
- [ ] **Docker Compose stack running** on server

### Application Prerequisites

- [ ] `nginx/ssl/letsencrypt/` directory exists (empty is OK)
- [ ] `nginx/acme-challenge/` directory exists (created by script)
- [ ] Nginx container running with ACME location configured
- [ ] Current self-signed certs working (HTTPS loads, albeit untrusted)

### Verification Commands

```bash
# Test DNS resolution:
dig +short api.globalreach.com
dig +short app.globalreach.com

# Test HTTP port 80:
curl -I http://YOUR_SERVER_IP/.well-known/acme-challenge/test
# Expected: 404 (location exists but no challenge file yet)

# Test current HTTPS:
curl -kI https://YOUR_SERVER_IP/api/v1/health
# Expected: 200 OK (with -k to ignore self-signed cert warning)

# Check Nginx ACME location:
docker exec globalreach-nginx ls -la /var/www/acme-challenge/
# Expected: directory exists (may be empty)
```

---

## 4. Migration Procedure (Step-by-Step)

### Option A: Automated (Recommended)

```bash
# Clone/deploy project to production server:
cd /opt/GlobalReach-Project

# Run one-click migration:
chmod +x scripts/ssl-switch-to-letsencrypt.sh
./scripts/ssl-switch-to-letsencrypt.sh

# Or test first without making changes:
./scripts/ssl-switch-to-letsencrypt.sh --dry-run
```

The script handles:
1. ✅ Pre-flight checks (Docker, DNS, Nginx)
2. ✅ Backup of current config + certs
3. ✅ Certbot certificate issuance (4 domains)
4. ✅ Nginx config switch (production.conf → LE version)
5. ✅ Nginx reload + verification

### Option B: Manual (Full Control)

#### Step 1: Create directories

```bash
mkdir -p nginx/ssl/letsencrypt
mkdir -p nginx/acme-challenge
mkdir -p nginx/ssl/backups
```

#### Step 2: Issue certificates

```bash
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot
```

Expected output:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/globalreach.com/fullchain.pem
Key file is saved at:         /etc/letsencrypt/live/globalreach.com/privkey.pem
```

#### Step 3: Switch Nginx configuration

```bash
# Backup current config:
cp nginx/conf.d/production.conf nginx/ssl/backups/production.conf.$(date +%s).bak

# Activate LE config:
cp nginx/conf.d/ssl-le-production.conf nginx/conf.d/production.conf

# Test config syntax:
docker compose -f docker-compose.prod.yml exec nginx nginx -t

# Reload Nginx:
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

#### Step 4: Verify

```bash
# Check certificate details:
openssl s_client -connect api.globalreach.com:443 -servername api.globalreach.com </dev/null | \
  openssl x509 -noout -subject -issuer -dates

# Expected output:
# subject=CN = api.globalreach.com
# issuer=C = US, O = Let's Encrypt, CN = R11
# notBefore=Jun  8 00:00:00 2026 GMT
# notAfter=Sep  6 23:59:59 2026 GMT  ← 90-day validity

# Test HTTPS without -k (should work now!):
curl -I https://api.globalreach.com/api/v1/health
# Expected: 200 OK (no certificate warnings!)
```

---

## 5. One-Click Migration Script

See [`scripts/ssl-switch-to-letsencrypt.sh`](../scripts/ssl-switch-to-letsencrypt.sh)

**Features:**
- Pre-flight validation (Docker, DNS, Nginx health)
- Automatic backup of existing config + certs
- Certbot issuance with webroot challenge
- Atomic config switch (with rollback on error)
- Post-migration verification
- `--dry-run` mode for testing
- `--rollback` mode for emergency revert

**Usage:**
```bash
./scripts/ssl-switch-to-letsencrypt.sh          # Full migration
./scripts/ssl-switch-to-letsencrypt.sh --dry-run # Preview only
./scripts/ssl-switch-to-letsencrypt.sh --rollback # Revert
CERTBOT_EMAIL=you@company.com ./scripts/ssl-switch-to-letsencrypt.sh  # Custom email
```

---

## 6. Post-Migration Verification

### Browser Testing

1. Open `https://api.globalreach.com` in browser
2. ✅ No security warning (padlock icon visible)
3. ✅ Click padlock → "Connection is secure"
4. ✅ Certificate shows "Let's Encrypt" as issuer

### Command-Line Testing

```bash
# 1. Certificate chain completeness:
openssl s_client -connect api.globalreach.com:443 -showcerts </dev/null | \
  grep -E "s:|i:|depth"

# 2. TLS protocol negotiation:
openssl s_client -connect api.globalreach.com:443 -tls1_2 </dev/null | \
  grep "Protocol"
openssl s_client -connect api.globalreach.com:443 -tls1_3 </dev/null | \
  grep "Protocol"

# 3. OCSP stapling status:
openssl s_client -connect api.globalreach.com:443 -status </dev/null | \
  grep -A4 "OCSP Response Status"

# 4. HSTS header:
curl -sI https://api.globalreach.com/ | grep -i strict-transport
# Expected: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

# 5. All security headers:
curl -sI https://api.globalreach.com/ | grep -iE "^x-|^content-security|^strict|^referrer|^permissions"

# 6. SSL Labs grade (run this, wait ~2 min):
echo "Visit: https://www.ssllabs.com/ssltest/analyze.html?d=api.globalreach.com"
```

### Monitoring Integration

After migration, verify monitoring still works:

```bash
# Prometheus targets:
curl -s http://localhost:9090/api/v1/targets | findstr "health"

# Grafana accessible via HTTPS:
curl -skI https://monitor.globalreach.com/

# AlertManager reachable:
curl -skI https://monitor.globalreach.com/
```

---

## 7. Automatic Renewal Setup

Let's Encrypt certificates are valid for **90 days**. Set up auto-renewal:

### Option A: Systemd Timer (Recommended for Linux)

Create `/etc/systemd/system/certbot-renewal.service`:

```ini
[Unit]
Description=GlobalReach Let's Encrypt Certificate Renewal
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/GlobalReach-Project
ExecStartPre=/usr/bin/docker compose -f docker-compose.prod.yml ps nginx --format "{{.Names}}" > /dev/null
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --quiet --deploy-hook "docker exec globalreach-nginx nginx -s reload"
ExecStartPost=/usr/bin/logger -t certbot-renewal "GlobalReach SSL certificates renewed"
```

Create `/etc/systemd/system/certbot-renewal.timer`:

```ini
[Unit]
Description=Daily Certbot Renewal Check

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable certbot-renewal.timer
sudo systemctl start certbot-renewal.timer
sudo systemctl list-timers | grep certbot
```

### Option B: Cron Job (Simple)

```bash
# Edit root crontab:
sudo crontab -e

# Add line (daily at 03:00 UTC):
0 3 * * * cd /opt/GlobalReach-Project && docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --quiet --deploy-hook "docker exec globalreach-nginx nginx -s reload" >> /var/log/certbot.log 2>&1
```

### Option C: Docker Native (No Systemd/Cron)

Use a dedicated renewal container that runs periodically:

```yaml
# Add to docker-compose.prod.yml:
  certbot-renewer:
    image: certbot/certbot:latest
    container_name: globalreach-certbot-renewer
    profiles: ["ssl"]
    volumes:
      - ./nginx/ssl/letsencrypt:/etc/letsencrypt
      - /var/run/docker.sock:/var/run/docker.sock
    entrypoint: ["sh", "-c"]
    command: |
      while true; do
        sleep 86400  # Wait 24 hours
        certbot renew --quiet \
          --deploy-hook "docker exec globalreach-nginx nginx -s reload" || true
      done
    restart: unless-stopped
```

### Test Renewal (Dry Run)

```bash
# Verify renewal works without actually renewing:
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --dry-run

# Expected: "Congratulations, all renewals succeeded"
```

---

## 8. Rollback Procedure

If anything goes wrong after switching to LE:

### Quick Rollback (Script)

```bash
./scripts/ssl-switch-to-letsencrypt.sh --rollback
```

### Manual Rollback

```bash
# 1. Find latest backup:
ls -lt nginx/ssl/backups/production.conf.*.bak | head -1

# 2. Restore original config:
cp nginx/ssl/backups/production.conf.<timestamp>.bak nginx/conf.d/production.conf

# 3. Test and reload:
docker compose -f docker-compose.prod.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

# 4. Verify self-signed cert is back:
curl -kI https://api.globalreach.com/api/v1/health
# Should return 200 with self-signed cert
```

### Common Rollback Scenarios

| Scenario | Symptom | Fix |
|----------|---------|-----|
| Certbot failed | "Failed authorization procedure" | Check DNS + port 80 firewall |
| Nginx won't start | "certificate not found" | Rollback to self-signed |
| Mixed content errors | Some resources over HTTP | Check CSP + HSTS headers |
| LE rate limit hit | "Too many certificates issued" | Use staging, wait 7 days |
| Domain changed | New domain needs new cert | Re-run certbot with `-d new.domain.com` |

---

## 9. Troubleshooting

### Problem: "Failed authorization procedure"

**Cause**: DNS not propagated or port 80 blocked.

**Fix**:
```bash
# 1. Check DNS:
dig +short api.globalreach.com
# Must return YOUR_SERVER_IP

# 2. Check port 80 from outside:
curl http://YOUR_SERVER_IP/.well-known/acme-challenge/test
# Must return 404 (not connection refused)

# 3. Check firewall:
sudo ufw status
sudo ufw allow 80/tcp
```

### Problem: "Too many certificates already issued"

**Cause**: Let's Encrypt rate limit (50 certs/domain/week).

**Fix**:
```bash
# Use staging environment for testing:
docker compose -f docker-compose.prod.yml run --rm --profile ssl \
  certbot certonly --webroot -w /var/www/acme-challenge \
  -d api.globalreach.com \
  --staging \
  --email admin@globalreach.com --agree-tos --no-eff-email

# For production: wait 7 days or contact LE support
```

### Problem: Certificate expired after renewal

**Cause**: Nginx not reloaded after renewal.

**Fix**: The deploy hook should handle this automatically. If not:
```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### Problem: "Invalid path for ssl_certificate"

**Cause**: LE certs not at expected path after volume mount.

**Fix**:
```bash
# Check where certs actually are:
docker exec globalreach-nginx ls -la /etc/nginx/ssl/le/live/
# If empty, check host side:
ls -la nginx/ssl/letsencrypt/live/globalreach.com/
```

---

## Appendix: Configuration Comparison

| Feature | Self-Signed (Before) | Let's Encrypt (After) |
|---------|---------------------|----------------------|
| **Certificate Path** | `/etc/nginx/ssl/globalreach/*.crt,.key` | `/etc/nginx/ssl/le/live/globalreach.com/fullchain.pem,privkey.pem` |
| **OCSP Stapling** | ❌ Not possible | ✅ Enabled |
| **HSTS max-age** | 15768000 (6 months) | 31536000 (12 months) + preload |
| **Browser Trust** | ❌ Manual exception needed | ✅ Trusted globally |
| **Validity Period** | 365 days (manual) | 90 days (auto-renewed) |
| **Renewal Method** | Manual re-generate | Certbot auto-renewal |
| **Cost** | Free | Free |
| **SSL Labs Target** | A- (config) / F (trust) | **A+ (config + trust)** |
| **HSTS Preload Eligible** | ❌ No | ✅ Yes |

---

**Guide End**

*Generated as part of S119 — SSL Production Migration*
*Dependencies*: DEPLOYMENT_DNS_SSL.md (DNS setup), scripts/ssl-switch-to-letsencrypt.sh (automation), docker-compose.prod.yml (certbot service)*
