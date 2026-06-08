# GlobalReach V2.0 — Production SMTP Migration Guide
# S116/Post-Go-Live: Mailpit (Dev) → Production SMTP Switch
#
# This guide covers switching ALL monitoring alert notification channels
# from the development Mailpit relay to a production-grade SMTP provider.
#
# Affected Components:
#   1. AlertManager (alertmanager.yml / alertmanager.production.yml)
#   2. Grafana (GF_SMTP_* env vars in docker-compose.prod.yml)
#   3. Application (SMTP_HOST/PORT/USER/PASS in .env.production)
#
# Table of Contents:
#   Part 1: Provider Selection Guide
#   Part 2: Amazon SES Configuration
#   Part 3: SendGrid Configuration
#   Part 4: Gmail SMTP Configuration
#   Part 5: Resend Configuration
#   Part 6: Switch Procedure (Step-by-Step)
#   Part 7: Verification Checklist
#   Part 8: Rollback Procedure

---

## Part 1: Provider Selection Guide

| Provider | Free Tier | Cost (Production) | Rate Limit | TLS | Best For |
|----------|-----------|-------------------|------------|-----|----------|
| **Amazon SES** | 62,000/mo (sandbox) | $0.10/1000 emails | High (customizable) | ✅ STARTTLS | Enterprise, AWS users |
| **SendGrid** | 100/day (free) | $14.95/mo (Basic) | 100/day→400/day | ✅ STARTTLS | Startups, easy setup |
| **Gmail SMTP** | 500/day (free) | Free | 500/day, 20/min | ✅ SSL/TLS | Small scale, personal use |
| **Resend** | 3,000/mo (free) | $0.0025/email | No hard limit | ✅ TLS | Developers, modern API |
| **Mailtrap** | 500/test (free) | $15/mo | Test only | N/A | Testing ONLY |

### Recommendation Matrix:

```
IF you are...                    THEN use...
├── AWS user / Enterprise       → Amazon SES (best deliverability, lowest cost)
├── Startup / Quick deploy      → SendGrid (easy onboarding, good docs)
├── Personal project / Low vol  → Gmail SMTP (zero cost, already have account)
├── Developer-first mindset     → Resend (modern DX, generous free tier)
└── Still testing               → Keep Mailpit (don't switch yet!)
```

---

## Part 2: Amazon SES Configuration

### Prerequisites
- AWS Account with SES enabled
- Verified domain (`globalreach.com`) or verified email address
- Out of sandbox mode (OR use sandbox for initial testing)

### Step 1: Get SES SMTP Credentials

```bash
# AWS Console → Simple Email Service → SMTP Settings →
# "Create SMTP Credentials" → Save the output

# You will get:
#   SMTP Username: AKIAIOSFODNN7EXAMPLE    (NOT your AWS access key!)
#   SMTP Password: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

### Step 2: Configure Environment Variables

```bash
# Add to .env.production (or docker-compose.prod.yml environment section):

# --- Amazon SES (us-east-1) ---
ALERTMANAGER_SMTP_SMARTHOST=email-smtp.us-east-1.amazonaws.com:587
ALERTMANAGER_SMTP_USER=AKIAIOSFODNN7EXAMPLE
ALERTMANAGER_SMTP_PASS=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
ALERTMANAGER_SMTP_FROM="GlobalReach Monitor <noreply@globalreach.com>"
ALERTMANAGER_EMAIL_TO=admin@globalreach.com
ALERTMANAGER_SMTP_REQUIRE_TLS=true
ALERTMANAGER_SMTP_HELLO=globalreach.com

# Grafana SMTP (same SES credentials):
GRAFANA_SMTP_HOST=email-smtp.us-east-1.amazonaws.com:587
GRAFANA_SMTP_USER=AKIAIOSFODNN7EXAMPLE
GRAFANA_SMTP_PASSWORD=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
GRAFANA_SMTP_FROM=noreply@globalreach.com

# Application SMTP (for CustomSMTP adapter fallback):
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=AKIAIOSFODNN7EXAMPLE
SMTP_PASS=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

### Step 3: SES-Specific Notes

```yaml
# Important SES constraints:
# - Sandbox mode: Can ONLY send TO verified email addresses
# - Production mode: Request limit increase in AWS Console
# - Bounce/Complaint handling: Enable SNS notifications
# - DKIM: Verify DNS records (CNAME entries provided by AWS)
# - SPF: Include amazonaws.com in your SPF record
# - Sending quota: Default 200 emails/second (request increase if needed)

# DNS Records for SES Domain Verification:
# Type: TXT
# Name: _amazonses.globalreach.com
# Value: "abcdefghijklmnopqrstuvwxyz1234567890"

# DKIM Records (3 CNAME entries from AWS Console):
# Type: CNAME
# Name: abcdefg12345._domainkey.globalreach.com
# Value: abcdefg12345.dkim.amazonses.com
```

---

## Part 3: SendGrid Configuration

### Prerequisites
- SendGrid account (signup: https://sendgrid.com)
- Sender Authentication completed (domain verified)
- API Key generated

### Step 1: Get SendGrid SMTP Credentials

```bash
# SendGrid Dashboard → Settings → API Keys → Create API Key
# OR use the dedicated SMTP credentials:

# SMTP Server: smtp.sendgrid.net
# Port: 587 (STARTTLS) or 465 (SSL/TLS)
# Username: apikey
# Password: SG.your_sendgrid_api_key_here
```

### Step 2: Configure Environment Variables

```bash
# --- SendGrid ---
ALERTMANAGER_SMTP_SMARTHOST=smtp.sendgrid.net:587
ALERTMANAGER_SMTP_USER=apikey
ALERTMANAGER_SMTP_PASS=SG.your_sendgrid_api_key_here
ALERTMANAGER_SMTP_FROM="GlobalReach Monitor <noreply@globalreach.com>"
ALERTMANAGER_EMAIL_TO=admin@globalreach.com
ALERTMANAGER_SMTP_REQUIRE_TLS=true

# Grafana SMTP (same SendGrid credentials):
GRAFANA_SMTP_HOST=smtp.sendgrid.net:587
GRAFANA_SMTP_USER=apikey
GRAFANA_SMTP_PASSWORD=SG.your_sendgrid_api_key_here
GRAFANA_SMTP_FROM=noreply@globalreach.com

# Application SMTP:
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your_sendgrid_api_key_here
```

### Step 3: SendGrid-Specific Notes

```yaml
# SendGrid sender authentication (DNS records required):
# Type: CNAME
# Name: s1._domainkey.globalreach.com
# Value: s1.domainkey.u1234567.wl.sendgrid.net

# Type: CNAME
# Name: s2._domainkey.globalreach.com
# Value: s2.domainkey.u1234567.wl.sendgrid.net

# Type: CNAME
# Name: globalreach.com  (domain verification)
# Value: u1234567.wl.sendgrid.net

# Rate Limits (Free tier):
# - 100 emails/day
# - Basic plan ($14.95/mo): unlimited (fair usage applies)

# IMPORTANT: SendGrid requires username to be literally "apikey"
# and password to be your actual API key string.
```

---

## Part 4: Gmail SMTP Configuration

### Prerequisites
- Gmail account (Google Workspace recommended for higher limits)
- App Password generated (2FA must be enabled first)
- "Less secure apps" OR App Password (recommended)

### Step 1: Generate App Password

```bash
# 1. Go to Google Account → Security → 2-Step Verification → ENABLE
# 2. Go to Security → App passwords → Generate app password
#    - Select "Mail" as app, "Other (custom name)" as device
#    - Name it "GlobalReach-Prod"
#    - Copy the 16-character password: xxxx xxxx xxxx xxxx
```

### Step 2: Configure Environment Variables

```bash
# --- Gmail SMTP ---
ALERTMANAGER_SMTP_SMARTHOST=smtp.gmail.com:587
ALERTMANAGER_SMTP_USER=your-email@gmail.com
ALERTMANAGER_SMTP_PASS=xxxx xxxx xxxx xxxx  # Your 16-char App Password
ALERTMANAGER_SMTP_FROM="GlobalReach Monitor <your-email@gmail.com>"
ALERTMANAGER_EMAIL_TO=admin@globalreach.com
ALERTMANAGER_SMTP_REQUIRE_TLS=true

# Grafana SMTP (same Gmail credentials):
GRAFANA_SMTP_HOST=smtp.gmail.com:587
GRAFANA_SMTP_USER=your-email@gmail.com
GRAFANA_SMTP_PASSWORD=xxxx xxxx xxxx xxxx
GRAFANA_SMTP_FROM=your-email@gmail.com

# Application SMTP:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
EMAIL_FROM="GlobalReach <your-email@gmail.com>"
```

### Step 3: Gmail-Specific Notes

```yaml
# Gmail SMTP Constraints:
# - 500 emails/day (regular Google account)
# - 2000 emails/day (Google Workspace paid plans)
# - 20 emails/minute rate limit (per recipient)
# - 100 total recipients per message
# - May block if detected as automated bulk sending
# - NOT recommended for production marketing campaigns!
# - OK for: alert notifications (<50/day), transactional emails

# For production marketing volume, use SES or SendGrid instead.
# Gmail SMTP is best suited for low-volume internal/dev environments.
```

---

## Part 5: Resend Configuration

### Prerequisites
- Resend account (signup: https://resend.com, free tier: 3000/mo)
- Domain verified (Resend provides DNS records)
- API Key generated

### Step 1: Get Resend SMTP Credentials

```bash
# Resend Dashboard → API Keys → Create API Key
# SMTP settings provided automatically:

# SMTP Server: smtp.resend.com
# Port: 465 (SSL/TLS)
# Username: resend
# Password: re_your_api_key_here
```

### Step 2: Configure Environment Variables

```bash
# --- Resend ---
ALERTMANAGER_SMTP_SMARTHOST=smtp.resend.com:465
ALERTMANAGER_SMTP_USER=resend
ALERTMANAGER_SMTP_PASS=re_your_api_key_here
ALERTMANAGER_SMTP_FROM="GlobalReach Monitor <noreply@globalreach.com>"
ALERTMANAGER_EMAIL_TO=admin@globalreach.com
ALERTMANAGER_SMTP_REQUIRE_TLS=true

# Grafana SMTP:
GRAFANA_SMTP_HOST=smtp.resend.com:465
GRAFANA_SMTP_USER=resend
GRAFANA_SMTP_PASSWORD=re_your_api_key_here
GRAFANA_SMTP_FROM=noreply@globalreach.com

# Application SMTP:
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_your_api_key_here
```

---

## Part 6: Switch Procedure (Step-by-Step)

### Pre-Switch Checklist

- [ ] SMTP provider account created and verified
- [ ] Domain DNS records configured (SPF/DKIM)
- [ ] SMTP credentials obtained and tested
- [ ] Current system snapshot taken (Mailpit working)
- [ ] Backup of current config files

### Step 1: Update .env.production

```bash
# Copy template and fill in your provider's values:
cp .env.production.template .env.production
# Edit .env.production — replace all <CHANGE_ME> placeholders

# Set these variables according to Parts 2-5 above:
#   ALERTMANAGER_SMTP_SMARTHOST=<your_smtp_server>:<port>
#   ALERTMANAGER_SMTP_USER=<username>
#   ALERTMANAGER_SMTP_PASS=<password>
#   ALERTMANAGER_SMTP_FROM="GlobalReach Monitor <noreply@globalreach.com>"
#   ALERTMANAGER_EMAIL_TO=<your_real_email>
#   ALERTMANAGER_SMTP_REQUIRE_TLS=true
#
#   GRAFANA_SMTP_HOST=<your_smtp_server>:<port>
#   GRAFANA_SMTP_USER=<username>
#   GRAFANA_SMTP_PASSWORD=<password>
#   GRAFANA_SMTP_FROM=<from_address>
#
#   SMTP_HOST=<your_smtp_server>
#   SMTP_PORT=<port>
#   SMTP_USER=<username>
#   SMTP_PASS=<password>
```

### Step 2: Update AlertManager Config

```bash
# Option A: Use the production config file (recommended):
cp alertmanager/alertmanager.yml alertmanager/alertmanager.dev.yml         # backup dev
cp alertmanager/alertmanager.production.yml alertmanager/alertmanager.yml   # activate prod

# Option B: Keep using current alertmanager.yml but update smarthost:
# Edit alertmanager.yml:
#   Find:    smarthost: 'mailpit:1025'
#   Replace: smarthost: '<your_smtp_server>:<port>'
#   Add under email_configs:
#     auth_username: '<username>'
#     auth_password: '<password>'
#     require_tls: true
```

### Step 3: Restart Services

```bash
docker compose -f docker-compose.prod.yml up -d alertmanager grafana
sleep 15

# Verify both services started correctly:
docker ps --filter "name=alertmanager" --format "{{.Names}} {{.Status}}"
docker ps --filter "name=grafana" --format "{{.Names}} {{.Status}}"
```

### Step 4: Verify AlertManager SMTP

```bash
# Check AlertManager logs for SMTP connection:
docker logs globalreach-alertmanager --tail 20 2>&1 | grep -i "smtp\|dial\|tls\|auth"

# Expected: NO errors about connection/refused/auth
# If successful: logs show normal operation

# Trigger a test alert (optional — uses existing Prometheus rules):
curl.exe -s http://localhost:9090/api/v1/alerts | findstr firing
```

### Step 5: Verify Grafana SMTP

```bash
# Check Grafana SMTP test (via Grafana UI or API):
# Go to http://localhost:3002 → Administration → SMTP Test
# Or use the provisioning contact point which auto-tests on load

# Check Grafana logs:
docker logs globalreach-grafana --tail 20 2>&1 | grep -i "smtp\|email\|alert"
```

### Step 6: End-to-End Test

```bash
# 1. Force a Prometheus alert to fire (temporarily lower threshold):
#    Edit prometheus/rules/alerts.yml → change a threshold to trigger immediately

# 2. Wait for AlertManager to pick it up (~30s group_wait)

# 3. Check your REAL inbox (not Mailpit!) for the alert email

# 4. Restore original thresholds after verification

# Alternative quick test via Mailpit (if still running):
# Mailpit WebUI: http://localhost:8025
# Should show 0 new messages (emails go to real SMTP now)
```

---

## Part 7: Verification Checklist

After completing the switch, verify each component:

### AlertManager Verification

- [ ] `docker logs globalreach-grafana --tail 30` shows no SMTP errors
- [ ] AlertManager cluster status: `ready`
- [ ] Real email received when alert fires
- [ ] Email contains proper HTML formatting with GlobalReach branding
- [ ] Resolved alerts send follow-up "green" emails

### Grafana Verification

- [ ] Grafana Contact Points show valid configuration
- [ ] SMTP test email received at configured address
- [ ] Native alert rules (when fixed in future Grafana version) can send emails

### Application Verification

- [ ] Business emails (campaign sends) use correct SMTP credentials
- [ ] Email delivery confirmed in external inbox
- [ ] Bounce/complaint handling works (if applicable)

### General

- [ ] All 13 containers still healthy after restart
- [ ] No regression in API health score
- [ ] Prometheus targets still 4/4 UP
- [ ] Git commit captures all config changes

---

## Part 8: Rollback Procedure

If production SMTP fails:

```bash
# 1. Revert AlertManager config:
cp alertmanager/alertmanager.dev.yml alertmanager/alertmanager.yml
# OR manually restore from git:
git checkout HEAD -- alertmanager/alertmanager.yml

# 2. Revert .env.production:
git checkout HEAD -- .env.production

# 3. Restart affected services:
docker compose -f docker-compose.prod.yml restart alertmanager grafana

# 4. Verify Mailpit is still receiving:
curl.exe -s http://localhost:8025/api/v1/messages
# Should show messages flowing again to Mailpit

# 5. Investigate failure cause:
#   - Check SMTP credentials (typo? expired?)
#   - Check network (firewall blocking port 587?)
#   - Check DNS (SMTP hostname resolves?)
#   - Check TLS (certificate issue?)
#   - Check provider status (SES/SendGrid outage?)
```

---

## Quick Reference: Env Var Summary

| Variable | Used By | Example (SES) | Example (SendGrid) | Example (Gmail) |
|----------|---------|---------------|-------------------|-----------------|
| `ALERTMANAGER_SMTP_SMARTHOST` | AlertManager | `email-smtp....:587` | `smtp.sendgrid.net:587` | `smtp.gmail.com:587` |
| `ALERTMANAGER_SMTP_USER` | AlertManager | `AKIAIOSF...` | `apikey` | `user@gmail.com` |
| `ALERTMANAGER_SMTP_PASS` | AlertManager | SMTP cred | `SG.xxxx...` | `app-password` |
| `ALERTMANAGER_SMTP_FROM` | AlertManager | `noreply@global...` | `noreply@global...` | `user@gmail.com` |
| `ALERTMANAGER_EMAIL_TO` | AlertManager | `admin@global...` | `admin@global...` | `admin@global...` |
| `ALERTMANAGER_SMTP_REQUIRE_TLS` | AlertManager | `true` | `true` | `true` |
| `GRAFANA_SMTP_HOST` | Grafana | `email-smtp....:587` | `smtp.sendgrid.net:587` | `smtp.gmail.com:587` |
| `GRAFANA_SMTP_USER` | Grafana | `AKIAIOSF...` | `apikey` | `user@gmail.com` |
| `GRAFANA_SMTP_PASSWORD` | Grafana | SMTP cred | `SG.xxxx...` | `app-password` |
| `GRAFANA_SMTP_FROM` | Grafana | `noreply@global...` | `noreply@global...` | `user@gmail.com` |
| `SMTP_HOST` | Application | `email-smtp....` | `smtp.sendgrid.net` | `smtp.gmail.com` |
| `SMTP_PORT` | Application | `587` | `587` | `587` |
| `SMTP_USER` | Application | `AKIAIOSF...` | `apikey` | `user@gmail.com` |
| `SMTP_PASS` | Application | SMTP cred | `SG.xxxx...` | `app-password` |

---

**Guide Version**: S116-v1.0
**Compatible With**: Phase J Closeout (S115), Protocol v5.0
**Dependencies**: SECRETS_SETUP.md (for GitHub Secrets), DEPLOYMENT_DNS_SSL.md (for domain)
