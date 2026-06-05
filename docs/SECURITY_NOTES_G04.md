# GlobalReach V2.0 — Security Hardening Notes (G04)

> **Created**: S082 Session | **Protocol**: v5.0 Go-Live
> **Purpose**: Centralized security reference for operations team

---

## 1. GitHub Secrets Inventory

| Secret | Purpose | Current Value | Status | Action Required |
|--------|---------|---------------|--------|-----------------|
| `PROD_HOST` | Production server IP/domain | Placeholder | 🔴 PLACEHOLDER | Replace with real value when server acquired |
| `PROD_USER` | SSH deploy username | Placeholder | 🔴 PLACEHOLDER | Replace with real value |
| `PROD_SSH_KEY` | SSH private key for deploy | Placeholder | 🔴 PLACEHOLDER | Generate ed25519 key, set via `gh secret set` |
| `SLACK_WEBHOOK_URL` | Alert notification webhook | Not set | 🟡 OPTIONAL | Configure for alert delivery |
| `SLACK_BOT_TOKEN` | Slack bot authentication | Not set | 🟡 OPTIONAL | Required if using bot-based notifications |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions | Auto | ✅ AUTO | No action needed |

### How to Set Secrets (when ready)

```bash
# 1. Authenticate with GitHub CLI
gh auth login

# 2. Set production secrets
gh secret set PROD_HOST --body "<real-ip-or-domain>"
gh secret set PROD_USER --body "<ssh-username>"

# 3. Generate and set SSH key
ssh-keygen -t ed25519 -f ~/.ssh/globalreach-deploy -C "globalreach-deploy"
gh secret set PROD_SSH_KEY --body "$(cat ~/.ssh/globalreach-deploy)"

# 4. Verify
gh secret list
```

---

## 2. Node.js Upgrade Timeline

```
Timeline: Node.js 20 → 22 LTS Migration Plan

Current State (S082):
├── Runtime:    Node.js 20.20.2 (Alpine)
├── CI/CD:      NODE_VERSION='20.x'
├── Dockerfile: node:20-alpine (both stages)
└── EOL Date:   2026-06-16 (11 days from S082)

Migration Steps (execute before EOL):
├── [1] ci-cd.yml:     NODE_VERSION '20.x' → '22.x'
├── [2] Dockerfile:     node:20-alpine → node:22-alpine (both stages)
├── [3] Test:           npm test full suite on Node 22
├── [4] Deploy:         docker compose up -d --build api
├── [5] Monitor:        24h observation period
└── Target Session:     S085 (recommended)

Risk Assessment: LOW — Node 22 is LTS, API-compatible with 20.
Major version jump 20→24 has higher risk, defer to post-Go-Live.
```

---

## 3. Security Checklist (Current Status)

### 3.1 Application Security

| Check | Status | Evidence |
|-------|--------|----------|
| JWT Authentication | ✅ PASS | Bearer Token + Refresh + RBAC |
| CSRF Protection | ✅ PASS | CSRF_SECRET configured |
| Rate Limiting | ✅ PASS | Nginx limit_req (10r/s) + conn_limit |
| CORS Policy | ✅ PASS | Whitelist strategy |
| SQL Injection | ✅ PASS | Sequelize ORM (parameterized) |
| XSS Prevention | ✅ PASS | Helmet + CSP headers |
| Password Hashing | ✅ PASS | bcrypt ( rounds) |
| Input Validation | ✅ PASS | express-validator + Joi |

### 3.2 Infrastructure Security

| Check | Status | Evidence |
|-------|--------|----------|
| SSL/TLS | ✅ A+ | CA-signed *.globalreach.com, TLSv1.3 |
| Security Headers | ✅ 6/6 | HSTS/X-Frame/X-XSS/CSP/CTO/RP |
| Container Non-root | ✅ PASS | Dockerfile USER appuser |
| Multi-stage Build | ✅ PASS | Builder → Production (minimal image) |
| Secrets in Code | ✅ PASS | .gitignore excludes .env/.key |
| Trivy Scan | ✅ PASS | CI/CD job passes (CRITICAL/HIGH) |
| Network Isolation | ✅ PASS | Docker bridge network |

### 3.3 Operational Security

| Check | Status | Notes |
|-------|--------|-------|
| Backup Encryption | ⚠️ PARTIAL | Backups are local plaintext; encrypt before remote |
| Secret Rotation | 🟡 PLANNED | Document rotation procedure |
| Access Control | 🟡 PLANNED | Define who has production access |
| Audit Logging | ✅ PASS | audit_logs table in PostgreSQL |

---

## 4. Known Risks & Mitigations

| ID | Risk | Probability | Impact | Mitigation | Due |
|----|------|-------------|--------|------------|-----|
| R01 | Docker disk full | Medium | High | G01 cleanup done; monitor weekly | Ongoing |
| R02 | Data loss | Low | High | Daily backup + G12 remote backup planned | G12 |
| R03 | Node.js 20 EOL | Certain | Medium | Upgrade path documented; target S085 | 2026-06-16 |
| R04 | Secrets exposure | Low | High | Replace placeholders; rotate quarterly | When deployed |
| R05 | Nginx SPOF | Low | High | Accepted risk; document in runbook | N/A |
| R06 | Internal deploy blocked | Certain | Medium | G11 self-hosted runner | Post-Go-Live |
| R07 | Monitoring gaps | High | Low | ✅ RESOLVED in S081 (exporters deployed) | Done |
| R08 | UAT not signed | Certain | High | G07 execution needed | G07 |

---

## 5. CIS Benchmark Alignment (Key Items)

| CIS Item | Description | Status |
|---------|-------------|--------|
| 4.1 | Image freshness | ✅ Pin to specific tags in CI |
| 4.4 | Non-root container | ✅ USER appuser |
| 4.7 | Read-only root FS | 🟡 Add `read_only: true` to compose |
| 5.1 | Resource limits | ✅ memory/CPU limits set |
| 5.4 | No sensitive data in env | ✅ Secrets via GitHub Secrets |
| 6.2 | TLS everywhere | ✅ TLSv1.3 enforced |

---

*Document maintained as part of Phase G Go-Live Execution*
*Last updated: S082 (2026-06-05)*
