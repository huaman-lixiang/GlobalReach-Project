# GlobalReach V2.0 — DNS & SSL Deployment Guide
# S114/PhaseI: BL-001 Production DNS + Let's Encrypt Setup
#
# PREREQUISITE: A production server with public IP and domain ownership

# ════════════════════════════════════════════════════════════════════
# PART 1: DNS CONFIGURATION
# ════════════════════════════════════════════════════════════════════

## Domain Architecture

Your DNS provider needs these records configured for globalreach.com:

┌─────────────────────────┬──────────┬──────────────────────────────┐
│ Record Type             │ Name     │ Value                       │
├─────────────────────────┼──────────┼──────────────────────────────┤
│ A                       │ @        │ YOUR_SERVER_IP              │
│ A                       │ api      │ YOUR_SERVER_IP              │
│ A                       │ app      │ YOUR_SERVER_IP              │
│ A                       │ monitor  │ YOUR_SERVER_IP              │
│ A                       │ grafana  │ YOUR_SERVER_IP              │
│ CNAME                   │ www      │ globalreach.com             │
└─────────────────────────┴──────────┴──────────────────────────────┘

Example for Cloudflare/AWS Route53/Google Cloud DNS:

  Type  Name     Content/TARGET           TTL
  ────  ───────  ────────────────────────  ────
  A     @        203.0.113.50              3600
  A     api      203.0.113.50              3600
  A     app      203.0.113.50              3600
  A     monitor  203.0.113.50              3600
  A     grafana  203.0.113.50              3600
  CNAME www      globalreach.com           3600

## Verification

After DNS propagation (usually 5-30 minutes):

```bash
# Verify all domains resolve correctly:
dig +short api.globalreach.com
dig +short app.globalreach.com
dig +short monitor.globalreach.com
dig +short grafana.globalreach.com

# Expected: Each should return YOUR_SERVER_IP
```

# ════════════════════════════════════════════════════════════════════
# PART 2: LET'S ENCRYPT CERTIFICATE ISSUANCE
# ════════════════════════════════════════════════════════════════════

## Prerequisites

✅ Server accessible on ports 80 (HTTP) and 443 (HTTPS)
✅ Firewall allows inbound 80/443
✅ DNS records pointing to server IP
✅ Docker Compose stack running (`docker compose -f docker-compose.prod.yml up -d`)
✅ Nginx running with ACME challenge location configured

## Initial Certificate Issuance

```bash
cd /path/to/GlobalReach-Project

# Issue certificates for all 5 subdomains using certbot service:
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot
```

This runs the command defined in docker-compose.prod.yml:
```bash
certbot certonly --webroot -w /var/www \
  -d api.globalreach.com \
  -d app.globalreach.com \
  -d monitor.globalreach.com \
  -d grafana.globalreach.com \
  --email admin@globalreach.com \
  --agree-tos --no-eff-email --force-renewal
```

## What This Does

1. Certbot connects to Let's Encrypt servers
2. Creates ACME challenge files in `./nginx/acme-challenge/`
3. Let's Encrypt verifies domain ownership via HTTP (port 80)
4. Certificates saved to `./nginx/ssl/letsencrypt/live/`
5. Nginx already configured to use these certificate paths

## Post-Issuance Verification

```bash
# Check certificates exist:
ls -la nginx/ssl/letsencrypt/live/api.globalreach.com/

# Should show: fullchain.pem  privkey.pem  chain.pem  cert.pem

# Test HTTPS connectivity:
curl -vI https://api.globalreach.com 2>&1 | grep -E "SSL|subject|expire"

# Check certificate expiry:
openssl s_client -connect api.globalreach.com:443 -servername api.globalreach.com </dev/null 2>/dev/null | openssl x509 -noout -dates
```

# ════════════════════════════════════════════════════════════════════
# PART 3: AUTOMATIC RENEWAL
# ════════════════════════════════════════════════════════════════════

Let's Encrypt certificates are valid for 90 days. Set up auto-renewal.

## Option A: Systemd Timer (Recommended for Linux)

Create `/etc/systemd/system/certbot-renewal.service`:

```ini
[Unit]
Description=GlobalReach Certbot Certificate Renewal
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/GlobalReach-Project
ExecStart=/usr/local/bin/docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew
```

Create `/etc/systemd/system/certbot-renewal.timer`:

```ini
[Unit]
Description=Daily Certbot Renewal Check

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:
```bash
sudo systemctl enable certbot-renewal.timer
sudo systemctl start certbot-renewal.timer
```

## Option B: Cron Job (Simple)

```bash
# Edit crontab:
crontab -e

# Add line (runs daily at 03:00):
0 3 * * * cd /opt/GlobalReach-Project && /usr/local/bin/docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --quiet && /usr/local/bin/docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

## Test Renewal (Dry Run)

```bash
# Test without actually renewing:
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --dry-run

# Expected: "Congratulations, all renewals succeeded"
```

# ════════════════════════════════════════════════════════════════════
# PART 4: FIREWALL REQUIREMENTS
# ════════════════════════════════════════════════════════════════════

Ensure these ports are open on your production server:

┌──────┬────────────────────────────┬──────────┬──────────────┐
│ Port │ Service                  │ Source   │ Purpose      │
├──────┼────────────────────────────┼──────────┼──────────────┤
│ 80   │ HTTP (Nginx)              │ 0.0.0.0/0│ ACME+Redirect│
│ 443  │ HTTPS (Nginx/TLS)         │ 0.0.0.0/0│ Application  │
│ 3002 │ Grafana UI               │ VPN/IP  │ Monitoring   │
│ 9090 │ Prometheus Web UI         │ VPN/IP  │ Metrics     │
│ 9093 │ AlertManager Web UI       │ VPN/IP  │ Alerts      │
│ 8025 │ Mailpit Web UI            │ localhost│ Dev only     │
│ 22   │ SSH                      │ Admin IP│ Management  │
└──────┴────────────────────────────┴──────────┴──────────────┘

ufw example:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from YOUR_ADMIN_IP to any port 22
sudo ufw allow from YOUR_VPN_SUBNET to any port 3002
sudo ufw allow from YOUR_VPN_SUBNET to any port 9090
sudo ufw allow from YOUR_VPN_SUBNET to any port 9093
sudo ufw enable
```

# ════════════════════════════════════════════════════════════════════
# TROUBLESHOOTING
# ════════════════════════════════════════════════════════════════════

## Problem: "Failed authorization procedure"
Cause: DNS not propagated or port 80 blocked
Fix:
  1. `dig +short api.globalreach.com` — must return server IP
  2. `curl http://YOUR_SERVER_IP/.well-known/acme-challenge/test` — must return 404
  3. Check firewall: `sudo ufw status`

## Problem: "Too many certificates already issued"
Cause: Let's Encrypt rate limit (50 certs/domain/week)
Fix: Use `--staging` flag for testing; wait 7 days for reset

## Problem: Certificate expired after renewal
Fix: Reload nginx after renewal: `docker compose exec nginx nginx -s reload`
