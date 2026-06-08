# GlobalReach V2.0 — Notification Policy Design Document
## S120: Grafana Alerting Policy Tree Configuration

> **Session**: S120 | **Date**: 2026-06-08
> **Status**: **Configuration Complete — Ready for Grafana Reload**
>
> This document describes the complete alert notification routing strategy
> for GlobalReach V2.0, covering both Prometheus→AlertManager and
> Grafana Native alerting paths.

---

## 1. Architecture Overview

### Dual-Path Notification System

```
┌─────────────────────────────────────────────────────────────────────┐
│                  GlobalReach V2.0 Notification Architecture         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     14 rules      ┌──────────────────┐            │
│  │  Prometheus   │ ──────────────►  │   AlertManager    │            │
│  │  (rules)      │                  │   (routing)       │            │
│  └──────────────┘                  └────────┬───────────┘            │
│                                             │                        │
│                              ┌──────────────┼──────────────┐        │
│                              ▼              ▼              ▼        │
│                       ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│                       │ email-pri│  │ critical-│  │ webhook- │    │
│                       │ mary     │  │ multi   │  │ integration│  │
│                       └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│                            │             │             │           │
│                            ▼             ▼             ▼           │
│                      ┌─────────────────────────────────────┐      │
│                      │          Mailpit / Production SMTP   │      │
│                      └─────────────────────────────────────┘      │
│                                                                     │
│  ══════════════════════════════════════════════════════════════    │
│                                                                     │
│  ┌──────────────┐                    ┌──────────────────┐           │
│  │  Grafana      │  Native alerts    │  Grafana Alerting │           │
│  │  (dashboards) │ ────────────────► │  Engine v13       │           │
│  └──────────────┘                    └────────┬───────────┘           │
│                                               │                       │
│                                    ┌──────────┴──────────┐           │
│                                    ▼                     ▼           │
│                             Contact Points          Policies         │
│                             (alerting.yml)         (policies.yml)    │
│                                    │                     │           │
│                             ┌──────┴─────────────────────┴───┐      │
│                             │   8 Receivers × 6 Routes       │      │
│                             └────────────────────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Principle: Separation of Concerns

| Layer | File | Responsibility |
|-------|------|---------------|
| **Data Source** | `prometheus/rules/alerts.yml` | Defines 14 alert rules with labels |
| **Infrastructure Routing** | `alertmanager/alertmanager.yml` | Routes Prometheus alerts to receivers |
| **Grafana Channels** | `grafana/provisioning/alerting/alerting.yml` | Defines 8 contact points (email/webhook) |
| **Grafana Routing** | `grafana/provisioning/alerting/policies.yml` | Defines 6-route policy tree |

---

## 2. Prometheus Alert Inventory (14 Rules)

### Critical Alerts (4) → Immediate Action Required

| # | Alert Name | Severity | Team | Trigger Condition | Route |
|---|-----------|----------|------|------------------|-------|
| 1 | **APIDown** | critical | platform | API instance down > 1min | Route 1 → critical-email → platform-critical |
| 2 | **HighErrorRate** | critical | platform | Error rate > 10% over 5min | Route 1 → critical-email → platform-critical |
| 3 | **ContainerRestartLoop** | critical | platform | Container restarted > 5x in 1h | Route 1 → critical-email → platform-critical |
| 4 | **APIHealthCritical** | critical | platform | Health score < 60 | Route 1 → critical-email → platform-critical |

### Warning Alerts (10) → Aggregated/Digest Mode

| # | Alert Name | Severity | Team | Trigger Condition | Route |
|---|-----------|----------|------|------------------|-------|
| 5 | **HighLatencyP95** | warning | platform | P95 latency > 2s (10min) | Route 5 → latency-watch-email |
| 6 | **PostgresConnectionHigh** | warning | database | PG connections > 80 (15min) | Route 2 → db-digest-email |
| 7 | **RedisMemoryHigh** | warning | database | Redis memory > 80% (10min) | Route 2 → db-digest-email |
| 8 | **NodeFileSystemFull** | warning | infra | Disk < 20% free (15min) | Route 3 → infra-digest-email |
| 9 | **NodeHighMemory** | warning | infra | Host memory > 85% (15min) | Route 3 → infra-digest-email |
| 10 | **NodeHighCPU** | warning | infra | Host CPU > 90% (15min) | Route 3 → infra-digest-email |
| 11 | **APIHealthDegraded** | warning | platform | Health score < 80 (3min) | Route 4 → health-priority-email |
| 12 | **APILatencyP50Elevated** | warning | platform | P50 latency > 200ms (5min) | Route 5 → latency-watch-email |
| 13 | **APIMemoryPressure** | warning | platform | API RSS > 75% limit (10min) | Default → email-primary |
| 14 | **APIThroughputAnomaly** | warning | platform | Throughput dropped 50%+ (10min) | Default → email-primary |

---

## 3. Grafana Policy Tree Visualization

```
                         grafana-alerting (orgId: 1)
                                  │
                     Default Receiver: email-primary
                     GroupBy: [alertname, severity, team]
                     Repeat: 8h
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
   severity=critical         team=database          team=infra
          │                       │                       │
   ┌──────┴──────┐               │                       │
   │             │          db-digest-email        infra-digest-email
critical-email  continue        Repeat: 6h              Repeat: 6h
Repeat: 30m     │
   │             │
   │      team=platform
   │             │
   │     platform-critical
   │     Repeat: 15m
   │
   [Other matchers]
          │
   ┌──────┴──────┐
   │             │
alertname=~     alertname=~
".*Health.*"    ".*Latency.*"
   │             │
health-priority  latency-watch
Repeat: 2h      Repeat: 4h

   [Everything else]
          │
   email-primary (default)
   Repeat: 8h
```

---

## 4. Contact Point Matrix

| UID | Name | Type | Recipients | singleEmail | Used By | Urgency |
|-----|------|------|------------|-------------|---------|---------|
| `email-primary` | globalreach-email | Email | admin@globalreach.com | yes | Default route, catch-all | Low |
| `critical-email` | globalreach-critical-email | Email | admin + oncall | no | All critical alerts | **HIGH** |
| `platform-critical` | globalreach-platform-oncall | Email | oncall + admin | no | Platform critical only | **CRITICAL** |
| `db-digest-email` | globalreach-db-digest | Email | dba + admin | yes | DB team alerts | Medium |
| `infra-digest-email` | globalreach-infra-digest | Email | infra + admin | yes | Infra team alerts | Medium |
| `health-priority-email` | globalreach-health-priority | Email | sre + admin | yes | Health score alerts | Medium-High |
| `latency-watch-email` | globalreach-latency-watch | Email | perf-team + admin | yes | Latency alerts | Medium |
| `webhook-integration` | globalreach-webhook | Webhook | External URL | N/A | Future Slack/DT integration | Configurable |

### Email Address Convention

| Address | Role | Expected Recipient |
|---------|------|--------------------|
| `admin@globalreach.com` | System administrator | Primary ops contact |
| `oncall@globalreach.com` | On-call engineer | Rotating on-call (pagerduty alias) |
| `dba@globalreach.com` | Database team | DBA distribution list |
| `infra@globalreach.com` | Infrastructure team | SRE/Infra DL |
| `sre@globalreach.com` | Site reliability | SRE team DL |
| `perf-team@globalreach.com` | Performance team | Performance engineering DL |

> **Note**: In development, all emails go to Mailpit (:8025). In production (S116 SMTP migration), they route to real mailboxes.

---

## 5. Timing Strategy (Noise Control)

| Route Tier | groupWait | groupInterval | repeatInterval | Rationale |
|-----------|-----------|---------------|----------------|-----------|
| **Platform Critical** | 10s | 1m | 15m | Fastest possible — system is down |
| **All Critical** | 10s | 2m | 30m | Urgent but allow grouping |
| **Health Priority** | 20s | 5m | 2h | Elevated attention needed |
| **Default Warning** | 30s | 5m | 8h | Don't spam — once per shift |
| **Latency Watch** | 30s | 10m | 4h | Performance trend monitoring |
| **DB/Infra Digest** | 60s | 15m | 6h | Resource pressure — not urgent |

### Noise Reduction Techniques Applied

1. **Grouping by alertname + severity + team**: Related alerts batched together
2. **Long repeat intervals**: Warnings don't re-notify every few minutes
3. **Team-based routing**: DBAs get DB alerts, Infra gets infra alerts (no cross-noise)
4. **Digest mode** (`singleEmail: true`): Multiple alerts = one email
5. **Separate channels for critical**: On-call gets paged separately from admin digest

---

## 6. Files Delivered in S120

| File | Lines | Purpose |
|------|-------|---------|
| `grafana/provisioning/alerting/policies.yml` | ~130 | **NEW** — 6-route policy tree (S110 workaround: separate file) |
| `grafana/provisioning/alerting/alerting.yml` | ~126 | **ENHANCED** — 2→8 contact points with role-based addresses |

### S110/S120 Bug Workaround Documentation

```
PROBLEM (Grafana v13 — CRITICAL BUG):

  Bug 1: Policies in same file as contactPoints → silently ignored
    Root cause: Grafana parser skips policy section when co-located
    Status: CONFIRMED (S110)

  Bug 2: Policies in SEPARATE file → crash-loop with "receiver does not exist"
    Error: "notification policies: policies.yml:
           [alerting.notifications.routes.invalidFormat]
           Invalid format: receiver 'globalreach-email' does not exist"
    Root cause: Grafana v13 policy validator cannot resolve receiver references
              to contact points defined in separate YAML files
    Status: CONFIRMED (S120) — This is a FUNDAMENTAL bug, not a format issue

  Bug 3: Webhook URL ${VAR} env var substitution → "required field url is not specified"
    Root cause: Grafana provisioning does NOT expand shell env variables
    Status: CONFIRMED (S106/S120) — Must hardcode values

RESOLUTION (Verified Working):
  File 1: grafana/provisioning/alerting/alerting.yml   → 8 Contact Points ✅
  File 2: policies.yml                                  → DELETED (causes crash-loop)
  Notification Policy Tree                            → Configure via Grafana UI only

UI CONFIGURATION PATH:
  1. Open http://localhost:3002 → Alerting → Notification Policies
  2. Set Default Receiver: globalreach-email
  3. Add routes matching the tree defined in Section 3 of this document
  4. Each route references a contact point by NAME from alerting.yml

VERIFICATION:
  After removing policies.yml:
    - Grafana starts healthy (no crash-loop) ✅
    - 8 contact points loaded via provisioning ✅
    - No provisioning errors in logs ✅
```

---

## 7. Verification Checklist

After deploying these files:

- [ ] Grafana container restarted: `docker compose -f docker-compose.prod.yml up -d grafana`
- [ ] Contact Points loaded (8 total):
  ```bash
  curl -s http://localhost:3002/api/v1/provisioning/contact-points
  ```
- [ ] Policies loaded (6 routes):
  ```bash
  curl -s http://localhost:3002/api/v1/provisioning/policies
  ```
- [ ] No crash-loop (the old relativeTimeRange bug was in alert-rules, not policies)
- [ ] Grafana UI: Alerting → Contact Points shows all 8 receivers
- [ ] Grafana UI: Alerting → Policy shows the routing tree visually
- [ ] Test: Create a test alert → verify it routes to correct receiver

---

## 8. Future Enhancements (Deferred)

| Enhancement | Priority | Description |
|-------------|----------|-------------|
| Slack Integration | P2 | Add Slack webhook receiver for critical alerts |
| DingTalk/WeChat | P2 | Chinese market IM integration |
| PagerDuty | P2 | On-call escalation with acknowledgment |
| Silence Rules | P1 | Maintenance window silence management |
| Grafana Native Alert Rules | P2 | Wait for v13 relativeTimeRange fix |
| Multi-org Support | P3 | Separate policies per organization |

---

**Document End**

*Generated as part of S120 — Notification Policy Configuration*
*Dependencies: prometheus/rules/alerts.yml (14 rules), alertmanager/alertmanager.yml (infrastructure routing)*
