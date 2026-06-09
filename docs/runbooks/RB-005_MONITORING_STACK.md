# RB-005 监控栈运行手册

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **组件**: Prometheus + Grafana + AlertManager + Loki + Promtail + Tempo
> **最后更新**: 2026-06-09

---

## 1. 组件身份卡

### 1.1 Prometheus (globalreach-prometheus)

| 属性 | 值 |
|------|-----|
| 容器名称 | globalreach-prometheus |
| 镜像 | prom/prometheus:v3.12.0 |
| Web UI | http://localhost:9090 |
| 数据目录 | /prometheus (prometheus_data volume) |
| 配置文件 | ./prometheus/prometheus.yml |
| 规则文件 | ./prometheus/rules/ |
| 抓取间隔 | 由各 job 定义 (30s critical, 60s warning) |
| 数据保留 | 默认 15 天 |
| 健康检查 | `wget -q --spider http://localhost:9090/-/healthy` |

### 1.2 Grafana (globalreach-grafana)

| 属性 | 值 |
|------|-----|
| 容器名称 | globalreach-grafana |
| 镜像 | grafana/grafana:13.0.2 |
| Web UI | http://localhost:3002 |
| 管理员 | admin / ${GRAFANA_ADMIN_PASSWORD:-admin123} |
| SMTP | smtp.qq.com:465 (1390885333@qq.com) |
| 健康检查 | `wget -q --spider http://localhost:3000/api/health` |

### 1.3 AlertManager (globalreach-alertmanager)

| 属性 | 值 |
|------|-----|
| 容器名称 | globalreach-alertmanager |
| 镜像 | prom/alertmanager:v0.32.2 |
| Web UI | http://localhost:9093 |
| 通知渠道 | Email (QQ Mail) + Webhook (API) |
| resolve_timeout | 5 分钟 |

### 1.4 Loki (globalreach-loki)

| 属性 | 值 |
|------|-----|
| 镜像 | grafana/loki:3.7.2 |
| HTTP 端口 | 3100 |
| 存储模式 | TSDB (filesystem) |
| 日志保留 | 168h (7天) |
| 最大查询长度 | 721h (~30天) |

### 1.5 Promtail (globalreach-promtail)

| 属性 | 值 |
|------|-----|
| 镜像 | grafana/promtail:3.6.8 |
| 数据源 | Docker 容器日志 (/var/lib/docker/containers) |
| Docker Socket | 只读挂载 (:ro) |
| 目标 | Loki :3100 |

### 1.6 Tempo (globalreach-tempo)

| 属性 | 值 |
|------|-----|
| 镜像 | grafana/tempo:2.5.0 |
| Query UI | http://localhost:3200 |
| OTLP gRPC | :4317 |
| OTLP HTTP | :4318 |

### 导出器

| 组件 | 容器名 | 镜像版本 | 用途 |
|------|--------|---------|------|
| node-exporter | globalreach-node-exporter | v1.11.1 | 主机级指标 |
| postgres-exporter | globalreach-pg-exporter | v0.19.1 | PostgreSQL 指标 |

---

## 2. 快速命令参考

### Prometheus
| 操作 | 命令 |
|------|------|
| Web UI | 打开 http://localhost:9090 |
| 检查 targets | http://localhost:9090/targets |
| 检查 rules | http://localhost:9090/rules |
| 查看告警 | http://localhost:9090/alerts |
| 热重载配置 | `curl -X POST http://localhost:9090/-/reload` |
| 检查健康 | `curl -sf http://localhost:9090/-/healthy` |

### Grafana
| 操作 | 命令 |
|------|------|
| Web UI | 打开 http://localhost:3002 (用户: admin) |
| 数据源管理 | Configuration → Data Sources |
| 仪表盘管理 | Dashboards → Browse |
| 检查健康 | `curl -sf http://localhost:3002/api/health` |

### AlertManager
| 操作 | 命令 |
|------|------|
| Web UI | 打开 http://localhost:9093 |
| 活跃告警 | http://localhost:9093/#/alerts |
| 静默规则 | http://localhost:9093/#/silences |
| 通知历史 | http://localhost:9093/#/notifications |
| 检查健康 | `curl -sf http://localhost:9093/-/healthy` |

### Loki
| 操作 | 命令 |
|------|------|
| 就绪检查 | `curl -sf http://localhost:3100/ready` |
| LogQL 查询 | Grafana Explore → 选择 Loki 数据源 |

### Tempo
| 操作 | 命令 |
|------|------|
| Query UI | 打开 http://localhost:3200 |

---

## 3. Prometheus 查询基础

### 3.1 常用 PromQL

```promql
# === API 服务健康 ===
up{job="globalreach-api"}
globalreach_health_score

# === 错误率 ===
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# === 延迟 ===
histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))   # P50
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))   # P95

# === 吞吐量 ===
sum(rate(http_requests_total[5m]))                                         # QPS

# === 基础设施 ===
100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)  # CPU%
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100        # 内存%
pg_stat_activity_count                                                        # PG连接数
redis_used_memory / redis_maxmemory                                           # Redis内存%

# === 容器 ===
container_memory_rss{container=~"globalreach-*"}                              # RSS
rate(container_cpu_usage_seconds_total{container=~"globalreach-*"}[5m])       # CPU
changes(container_start_time_seconds[1h])                                     # 重启次数
```

### 3.2 Rule 评估延迟

- `globalreach-critical`: interval=30s
- `globalreach-warning`: interval=60s
- `globalreach-api-specific`: interval=30s

实际触发时间 = 规则评估间隔 + `for` 持续时间。

---

## 4. Grafana 操作指南

### 4.1 仪表盘列表

| 名称 | 用途 | 数据源 |
|------|------|--------|
| GlobalReach API Overview | API 延迟/错误率/吞吐量/健康分数 | Prometheus |
| GlobalReach Health Score | 综合健康评分趋势 | Prometheus |
| Container Resources | 各容器 CPU/内存/网络 I/O | Prometheus |
| PostgreSQL Overview | PG 连接数/QPS/缓存命中率 | Prometheus |
| Redis Overview | Redis 内存/Key 数/命令统计 | Prometheus |
| Loki Logs Explorer | 日志搜索与分析 | Loki |
| Tempo Traces | 分布式追踪可视化 | Tempo |

### 4.2 数据源配置

| 数据源 | 类型 | URL |
|--------|------|-----|
| Prometheus | Prometheus | http://globalreach-prometheus:9090 |
| Loki | Loki | http://globalreach-loki:3100 |
| Tempo | Tempo | http://globalreach-tempo:3200 |

### 4.3 用户权限

| 角色 | 权限 |
|------|------|
| Admin | 全部权限 (默认: admin/admin123) |
| Viewer | 仅查看 |
| Editor | 编辑仪表盘 |

**安全提示**: `GF_USERS_ALLOW_SIGN_UP=false` 已禁用自助注册。

---

## 5. AlertManager 操作指南

### 5.1 路由树解读

```
所有告警
  │
  ├─ [默认] → email-primary (repeat: 8h)
  │
  ├─ severity=critical → critical-multi (email+webhook, repeat: 30m, continue→下)
  ├─ severity=warning → email-primary (repeat: 4h, continue→下)
  ├─ team=platform → critical-multi (repeat: 2h)
  ├─ team=database → email-primary (repeat: 6h)
  └─ team=infra → email-primary (repeat: 6h)
```

### 5.2 Inhibition Rules (抑制规则)

| 规则 | 效果 |
|------|------|
| Critical 抑制 Warning (同 instance) | 减少噪音 |
| APIHealthCritical 抑制 APIHealthDegraded | 同资源不重复通知 |
| APIDown 抑制所有 API 相关告警 | 服务挂了不需要延迟报告 |
| EmailQueueCritical 抑制 EmailQueueBacklog | 根因抑制 |
| ContainerRestartLoop 抑制 Memory/CPU | 崩溃是根因 |

### 5.3 静默管理

```bash
# 创建静默 (静默 2 小时所有 critical 告警)
curl -s -X POST http://localhost:9093/api/v2/silences \
  -H 'Content-Type: application/json' \
  -d '{
    "matchers": [{"name": "severity", "value": "critical", "isRegex": false}],
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "endsAt": "'$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)'",
    "createdBy": "oncall",
    "comment": "计划内维护窗口"
  }'

# 查看活跃静默
curl -s http://localhost:9093/api/v2/silences | jq '.[] | select(.status.state=="active")'

# 删除静默
curl -s -X DELETE http://localhost:9093/api/v2/silences/<silence-id>
```

### 5.4 测试告警

```bash
# 通过 API 发送测试告警
curl -s -X POST http://localhost:9093/api/v1/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {"alertname": "TestAlert", "severity": "warning", "instance": "test", "team": "platform"},
    "annotations": {"summary": "Manual test alert"},
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }]'
```

---

## 6. Loki LogQL 基础

### 6.1 常用 LogQL 查询

```logql
# 所有 API 日志
{container="globalreach-api-prod"}

# 错误日志
{container="globalreach-api-prod"} |= "error" |~ "(?i)(error|exception|fail)"

# Nginx 5xx 错误
{container="globalreach-nginx-prod"} |~ " [5][0-9][0-9] "

# 按时间聚合错误率
sum(rate({container="globalreach-api-prod"} |= `"level":"error"` [5m])) by (container)

# 搜索慢请求
{container="globalreach-api-prod"} |~ "duration.*[0-9]{4,}"
```

### 6.2 日志保留策略

| 配置项 | 值 | 说明 |
|--------|-----|------|
| reject_old_samples_max_age | 168h (7天) | 拒绝超过 7 天的日志 |
| max_query_length | 721h (~30天) | 最大查询时间跨度 |
| index period | 24h | 索引按天分割 |

### 6.3 Promtail Pipeline 调试

```bash
# 查看 Promtail 运行状态
docker logs --tail=20 globalreach-promtail

# 检查 position 文件 (确认哪些日志已读取)
docker exec globalreach-promtail cat /tmp/positions.yaml | head -20
```

---

## 7. Tempo 追踪查询基础

API 服务已在 `api/otel.js` 中集成 OpenTelemetry SDK（作为首个 import），自动检测 Express/HTTP/PostgreSQL/Redis 库。

| 协议 | 端口 | 用途 |
|------|------|------|
| OTLP gRPC | 4317 | gRPC 格式 trace 数据 |
| OTLP HTTP | 4318 | HTTP 格式 trace 数据 |

查询方式:
1. Tempo Web UI (http://localhost:3200): 按 Trace ID 搜索
2. Grafana Explore: 选择 Tempo 数据源，支持按 Tag/Duration/Service 搜索

---

## 8. 架构关系图

```
数据采集层:
[node-exporter :9100] ──┐
[pg-exporter :9187] ───┤
[API :3000 /metrics] ──┤──→ [Prometheus :9090]
[cAdvisor/容器指标] ───┘        │
                                ↓
[Docker Containers 日志] → [Promtail] ──→ [Loki :3100] ─┐
                                                          │
[API otel] ──OTLP──→ [Tempo :3200] ──────────────────────┤
                                                          ↓
                                              [Grafana :3002]
                                                  │    ↑
告警: [Prometheus Rules] → [AlertManager :9093] ──┬→ [Email: QQ Mail]
                                                    └→ [Webhook: API :3000]
```

---

## 9. 健康检查清单

- [ ] **Prometheus**: `curl -sf http://localhost:9090/-/healthy` → healthy
- [ ] **Grafana**: `curl -sf http://localhost:3002/api/health` → ok
- [ ] **AlertManager**: `curl -sf http://localhost:9093/-/healthy` → healthy
- [ ] **Loki**: `curl -sf http://localhost:3100/ready` → ready
- [ ] **Promtail**: 容器运行中，日志持续输出
- [ ] **Tempo**: 容器运行中，Query UI 可访问
- [ ] **node-exporter**: 容器运行中
- [ ] **pg-exporter**: 容器运行中
- [ ] **Targets**: Prometheus 所有 target 为 UP (http://localhost:9090/targets)
- [ ] **Rules**: 所有 rule groups OK (http://localhost:9090/rules)

---

## 10. 故障排查场景

### 场景 1: Prometheus Target DOWN

**症状**: Web UI 显示某个 target 为 DOWN

**诊断步骤**:
```bash
# 1. 在 Prometheus Web UI 点击 DOWN target 查看 Last Error
# 2. 手动测试端点
curl -sf http://localhost:3000/api/v1/metrics | head -5       # API
docker exec globalreach-node-exporter wget -qO- http://localhost:9100/metrics | head -5  # node-exp
docker exec globalreach-pg-exporter wget -qO- http://localhost:9187/metrics | head -5     # pg-exp
# 3. 从 Prometheus 容器内测试网络
docker exec globalreach-prometheus wget -qO- http://globalreach-api-prod:3000/api/v1/metrics
```

**解决方案**: 确保目标容器运行且端口可达，检查 prometheus.yml 中的目标地址。

---

### 场景 2: 告警未触发或不发送

**症状**: 有问题但告警没发出

**诊断步骤**:
```bash
# 1. 检查 Prometheus 告警状态 (pending/firing/inactive) — http://localhost:9090/alerts
# 2. 手动验证 PromQL 表达式值
# 3. 检查 AlertManager 告警状态 — http://localhost:9093/#/alerts
# 4. 检查是否有活跃静默 — http://localhost:9093/#/silences
# 5. 检查 AM 日志中的通知记录
docker logs --tail=50 globalreach-alertmanager | grep -iE "(notify|dispatch|error)"
# 6. 发送测试告警验证通道
```

**解决方案**: 参考 [docs/ALERT_TUNING_GUIDE.md](../ALERT_TUNING_GUIDE.md) 详细流程。

---

### 场景 3: Grafana 仪表盘无数据

**症状**: 面板显示 No Data 或空白

**诊断步骤**:
```bash
# 1. Grafana → Configuration → Data Sources → 检查 Last Tested 状态
# 2. 在 Explore 中手动执行查询验证
# 3. 检查 Prometheus 是否有数据
curl -sf 'http://localhost:9090/api/v1/query?query=up' | jq '.data.result'
# 4. 检查 Loki 是否有数据
curl -sf 'http://localhost:3100/loki/api/v1/query_range?query={}&limit=10' | head -c 500
```

---

### 场景 4: Loki 日志缺失

**症状**: Grafana 查询不到某时段日志

**诊断步骤**:
```bash
# 1. Promtail 状态
docker logs --tail=20 globalreach-promtail
# 2. 检查 positions 文件
docker exec globalreach-promtail cat /tmp/positions.yaml | head -20
# 3. Loki 存储和就绪
curl -sf http://localhost:3100/ready && docker exec globalreach-loki du -sh /loki/
# 4. 产生测试日志后查询验证
docker exec globalreach-api-prod echo "test-log-$(date)" >&2
```

---

### 场景 5: 告警风暴

**症状**: 短时间收到大量告警通知

**处理步骤**:
1. **立即止损**: 创建全局静默 (`severity=""` 匹配所有，30分钟)
2. **定位根因**: 通常是最早触发的 Critical 告警
3. **修复根因**: 参考对应 Runbook
4. **完善降噪**: 更新 inhibition rules

详见 [TT-005 告警风暴决策树](../troubleshooting-trees/TT-005_ALERT_STORM.md) 和 [docs/AIOPS_ALERT_DEDUPPLICATION.md](../AIOPS_ALERT_DEDUPPLICATION.md)。

---

### 场景 6: Prometheus 存储增长过快

**症状**: 磁盘被 TSDB 占满

**诊断步骤**:
```bash
# TSDB 大小
docker exec globalreach-prometheus du -sh /prometheus/

# Top 高基数指标
curl -sf 'http://localhost:9090/api/v1/label/__name__/values' | jq -r '.data[]' | while read m; do
  c=$(curl -sf "http://localhost:9090/api/v1/series?match[]=$m" | jq '.data | length')
  echo "$c $m"
done | sort -rn | head -10
```

**解决方案**: 减少高基数 label，降低 retention time，启用压缩。

---

### 场景 7: Tempo Trace 缺失

**症状**: Grafana Tempo 面板无 Trace 数据

**诊断步骤**:
```bash
# 1. Tempo 状态和日志
docker logs --tail=20 globalreach-tempo
# 2. API otel 初始化检查
head -3 api/otel.js  # 应为 require('@opentelemetry/api')
# 3. Tempo 接收检查
curl -sf http://localhost:3200/api/search?limit=10
```

---

### 场景 8: Exporter 数据缺失

**症状**: 主机/PG 指标面板无数据

**诊断步骤**:
```bash
# 1. 容器状态
docker ps | grep -E "(node-exporter|pg-exporter)"
# 2. 直接访问 metrics
docker exec globalreach-node-exporter wget -qO- http://localhost:9100/metrics | head -3
docker exec globalreach-pg-exporter wget -qO- http://localhost:9187/metrics | head -3
# 3. Prometheus targets 页面确认 scrape 正常
```

---

## 11. 关键指标基线

| 组件 | 指标 | 正常范围 | 警告阈值 | 严重阈值 |
|------|------|---------|---------|---------|
| Prometheus | Target UP 率 | 100% | < 90% | < 80% |
| Prometheus | TSDB 大小 | < 10GB | > 20GB | > 50GB |
| Grafana | HTTP 响应 | < 500ms | > 2s | > 5s |
| AlertManager | 通知延迟 | < 30s | > 2min | > 5min |
| Loki | 日志摄入率 | 基线 | ±3x | ±10x |
| Loki | 查询延迟 | < 5s | > 15s | > 30s |
| Promtail | 发送成功率 | > 99% | < 95% | < 90% |

---

## 12. 相关资源

### 关联 Runbook
- [RB-001 API 服务运行手册](RB-001_API_SERVICE.md) — API 指标解读
- [RB-002 PostgreSQL 运行手册](RB-002_POSTGRES.md) — PG 指标解读
- [RB-006 Docker Compose 运行手册](RB-006_DOCKER.md) — 容器编排

### 关联文档
- [告警调优指南](../ALERT_TUNING_GUIDE.md)
- [LogQL 查询参考](../LOKI_LOGQL_QUERIES.md)
- [AIOps 告警去重](../AIOPS_ALERT_DEDUPPLICATION.md)

### 配置文件
- `prometheus/prometheus.yml` — 抓取配置
- `prometheus/rules/alerts.yml` — 14 条告警规则
- `alertmanager/alertmanager.yml` — 路由/接收器/抑制规则
- `loki/loki-config.yml` — Loki 存储/限制配置
- `loki/promtail-config.yml` — 日志采集 pipeline
- `tempo/tempo-config.yml` — Trace 存储
- `grafana/grafana.ini` — Grafana 主配置
- `grafana/provisioning/` — 数据源/仪表盘/告警预配置
