# S100/PhaseH: Loki LogQL Alert Rules Reference
# ===================================================
# These alert rules use LogQL (Loki Query Language) syntax.
# They CANNOT be loaded into Prometheus (PromQL only).
#
# USAGE OPTIONS:
# ──────────────
# Option A: Import into Grafana Alerting UI
#   → Grafana → Alerting → New alert rule → Loki datasource
#   → Copy-paste each expr below
#
# Option B: Use Grafana Alerting Provisioning (file-based)
#   → Create YAML files under grafana/provisioning/alerting/
#   → Reference: https://grafana.com/docs/grafana/latest/alerting/configure-provisioning-alert-rules/
#
# Option C: Use loki-adapter for Prometheus compatibility
#   → Deploy grafana/loki-adapter as Prometheus remote_read source
#   → Then these become valid PromQL via the adapter
#
# ===================================================

groups:
  - name: globalreach-log-alerts
    interval: 60s
    rules:
      # ── ALERT 1: API Error Rate Spike ──
      # Triggers when ERROR-level logs exceed 5% of total API logs
      # Indicates application-level exceptions or unhandled errors
      - alert: LogErrorRateSpike
        expr: |
          (
            sum by (container_name) (rate({container_name="globalreach-api-prod"} |= `"level":"ERROR"` [5m]))
            /
            sum by (container_name) (rate({container_name="globalreach-api-prod"} [5m]))
          ) > 0.05
        for: 5m
        labels:
          severity: warning
          team: platform
          runbook_url: "https://docs.globalreach.com/runbooks/log-error-spike"
        annotations:
          summary: "Log Error Rate Spike (>5%)"
          description: |
            Error logs = {{ $value | humanizePercentage }} of total API logs.
            Check Grafana Explore: {container_name="globalreach-api-prod"} |= `ERROR`
          logql_debug: '{container_name="globalreach-api-prod"} |= `"level":"ERROR"`'

      # ── ALERT 2: Nginx 5xx Error Rate ──
      # Triggers when Nginx returns >1% 5xx responses
      # Indicates upstream API failures or misconfigurations
      - alert: NginxHighErrorRate
        expr: |
          (
            sum by (container_name) (rate({container_name="globalreach-nginx-prod"} |~ `"status":"5.."` [5m]))
            /
            sum by (container_name) (rate({container_name="globalreach-nginx-prod"} [5m]))
          ) > 0.01
        for: 10m
        labels:
          severity: warning
          team: infra
          runbook_url: "https://docs.globalreach.com/runbooks/nginx-errors"
        annotations:
          summary: "Nginx 5xx Error Rate >1%"
          description: "Nginx returning {{ $value | humanizePercentage }} 5xx responses."
          logql_debug: '{container_name="globalreach-nginx-prod"} |~ `"status":"5.."`'

      # ── ALERT 3: PostgreSQL FATAL/PANIC ──
      # Triggers on any FATAL, PANIC, or connection-refused log lines
      # CRITICAL — indicates database corruption or resource exhaustion
      - alert: PostgresLogErrors
        expr: |
          sum by (container_name) (rate({container_name="globalreach-postgres"} |= `FATAL|PANIC|connection rejected|could not connect` [15m])) > 0
        for: 5m
        labels:
          severity: critical
          team: database
          runbook_url: "https://docs.globalreach.com/runbooks/pg-fatal"
        annotations:
          summary: "PostgreSQL FATAL/PANIC Logs Detected"
          description: "{{ $value }} FATAL-level PG logs per second."
          logql_debug: '{container_name="globalreach-postgres"} |= `FATAL|PANIC`'

      # ── ALERT 4: Log Volume Anomaly ──
      # Triggers when log throughput drops >70% from baseline
      # May indicate hung process, deadlocked service, or logging pipeline failure
      - alert: LogVolumeAnomaly
        expr: |
          (
            sum by (container_name) (rate({container_name=~"globalreach-(api|nginx)-.*"} [5m]))
            /
            sum by (container_name) (rate({container_name=~"globalreach-(api|nginx)-.*"} [30m] offset 25m))
          ) < 0.3
        for: 15m
        labels:
          severity: warning
          team: platform
          runbook_url: "https://docs.globalreach.com/runbooks/log-volume-drop"
        annotations:
          summary: "Log Volume Dropped >70%"
          description: |
            Container {{ $labels.container_name }} log throughput dropped to {{ $value | humanizePercentage }} of baseline.
            Possible causes: hung process, deadlock, or Promtail disconnection.

# ===================================================
# QUICK REFERENCE: Common LogQL Patterns for GlobalReach
# ===================================================
#
# All API error logs (last hour):
#   {container_name="globalreach-api-prod"} |= `"status":4` or `"status":5`
#
# Slow requests (>500ms):
#   {container_name="globalreach-api-prod"} |~ `"responseTimeMs":\\d{3,}`
#
# Auth failures:
#   {container_name="globalreach-api-prod"} |= `401|403|unauthorized`
#
# Nginx 4xx client errors:
#   {container_name="globalreach-nginx-prod"} |~ `"status":"4.."`
#
# Redis warnings/errors:
#   {container_name="globalreach-redis"} |= `warning|error`
#
# Cross-container correlation (traceId):
#   {traceId="253e4b0c-4fa6-4903-af68-39727912a58c"}
#
# ===================================================
