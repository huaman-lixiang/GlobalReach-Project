# GlobalReach V2.0 Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.0.0] - Steady State Evolution (S129–S134)

### S134 (2025-06-11) — Batch 5: Quick Wins
#### Fixed
- **DEBT-006** (P3): Pinned `certbot/certbot:latest` → `v2.11.0` in `docker-compose.prod.yml`
- **DEBT-010** (P2): Replaced 8 hardcoded `1390885333@qq.com` in `docker-compose.ha.yml` with env vars (`${SMTP_QQ_USER}`, `${SMTP_QQ_FROM}`, `${GF_SMTP_USER}`, `${GF_SMTP_PASSWORD}`, `${GF_SMTP_FROM_ADDRESS}`)
- **Bug**: Fixed `cacheService.setex()` call in `api/services/tenantService.js:404` → changed to `cacheService.set(key, val, { EX: ttl })` matching actual cacheService API
- **Bug**: Annotated 2 N+1 query patterns in `api/services/emailService.js` (lines ~546, ~668) with `[PERF]` markers and batch-query TODO references
- **DEBT-020** (P3): Cleaned stale TODOs in `api/routes/capacity.js` (replaced with NOTE + DEBT-028 reference) and `api/services/accountService.js` (replaced with clarification comment)
#### Added
- **DEBT-016** (P3): Created `frontend/.env.cdn.example` template for CDN deployment (VITE_CDN_BASE_URL configuration)
#### Documentation
- Updated `README.md`: version badge, tech stack versions (Node 24 / PG15 / Redis7), current project statistics (90 tests, 13 containers, 11 tables, 60.7% debt repayment)
- Created this `CHANGELOG.md`

### S133 (2025-06-10) — Batch 4: Large-Scale Debt Repayment
#### Fixed (16 debts repaid)
- **DEBT-002** (P1): Docker Compose production hardening (healthchecks, restart policies, resource limits)
- **DEBT-004** (P1): PostgreSQL 15 tuning (shared_buffers, work_mem, pg_stat_statements)
- **DEBT-007–009** (P1): Security baseline (CSP nonces, HSTS preloading, CORS strict whitelist)
- **DEBT-011–013** (P2): Secrets management (.env.prod migration, Docker secrets pattern, .gitignore enforcement)
- **DEBT-015** (P2): Email deduplication (composite unique index, upsert logic)
- **DEBT-023–025** (P2): Performance (Redis pipeline, connection pool audit, query analysis)
- **DEBT-026–027** (P2): Monitoring (Prometheus rule tuning, Alertmanager routing)
#### Infrastructure
- Prometheus alert rules tuned for production (repeat_interval, severity labels)
- Nginx CDN optimizations and upstream HA configs added
- HA docker-compose (`docker-compose.ha.yml`) created

### S132 (2025-06-09) — Batch 3: Security & Observability
- Security headers hardened across all routes
- Docker secrets architecture implemented
- Alertmanager QQ Mail SMTP integration completed
- Runbooks RB-005 (Monitoring Stack) and RB-008 (Backup & Recovery) finalized

### S131 (2025-06-09) — Batch 2: Production Readiness
- Gmail→QQ Mail SMTP migration (Gmail App Password invalid, pivoted successfully)
- Grafana alerting pipeline end-to-end verified
- All alerts routing to `1390885333@qq.com` confirmed received

### S130 (2025-06-09) — Batch 1: Bug Fix Sprint
- 6 known bugs fixed: email dedup race condition, UTC+8 timezone handling, template preview XSS, capacity planner division-by-zero, analytics N+1 query, webhook retry idempotency

### S129 (2025-06-09) — Post-O Baseline
- Established steady-state operational baseline
- Full-stack monitoring stack validated (13 containers)
- Technical debt register initialized at v1.0.0

---

## [v1.0.0] - Initial Release
- Core email campaign CRUD operations
- Multi-platform account support (Gmail, Outlook, custom SMTP)
- Basic authentication (JWT)
- React frontend scaffold
- Docker Compose development environment
- Initial test suite
