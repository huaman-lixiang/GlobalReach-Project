# GlobalReach V2.0 告警调优手册 (Alert Tuning Playbook)

> 版本: 1.0.0
> 最后更新: 2026-06-09 (S133/DEBT-027)
> 状态: Active

## 目录

1. [告警分级体系](#1-告警分级体系)
2. [Inhibition Rule 审计与修复](#2-inhibition-rule-审计与修复)
3. [Runbook 集成规范](#3-runbook-集成规范)
4. [Ownership 元数据规范](#4-ownership-元数据规范)
5. [Postmortem 流程](#5-postmortem-流程)
6. [变更日志](#6-变更日志)

---

## 1. 告警分级体系

### 1.1 Severity 定义

| Level | 响应时间 | 影响范围 | 示例 | AlertManager Route |
|-------|---------|----------|------|-------------------|
| **P0-CRITICAL** | <5min | 服务不可用 | API down, PG crash, Redis fail, EmailQueueCritical | Route 1 (critical-multi, 30m repeat) |
| **P1-HIGH** | <15min | 功能降级 | High error rate (>10%), Latency spike, Disk >90% | Route 1 + Route 3 |
| **P2-MEDIUM** | <1h | 性能偏离 | Cache hit ratio drop, Queue backlog, DB pool high | Route 2 (email-primary, 4h repeat) |
| **P3-LOW** | <4h | 信息通知 | Certificate expiring soon, Capacity trend, NoActiveCampaigns | Route 2 / Route 7 (24h repeat) |

### 1.2 repeat_interval 推荐公式

```
repeat_interval = max(MTTR × 1.5, 30min)
```

**MTTR (Mean Time To Resolve) 参考值：**

| 类别 | MTTR 范围 | 推荐 repeat_interval | 说明 |
|------|----------|---------------------|------|
| 即时行动类 (P0) | 5-15min | **30min - 1h** | 快速提醒直到修复，但避免告警疲劳 |
| 需调查类 (P1) | 30min-2h | **2h - 4h** | 给团队调查时间，不需要反复催促 |
| 渐进式 (P2) | 2-8h | **4h - 8h** | 不需要频繁打扰，定期提醒即可 |
| 信息类 (P3) | N/A (计划性) | **24h - 72h** | 每日/每周摘要即可 |

### 1.3 当前规则调优建议表

#### 核心告警 (alerts.yml — globalreach-critical group)

| 规则名 | Severity | 当前 for | 建议 repeat | 理由 | 当前状态 |
|--------|----------|---------|-------------|------|---------|
| APIDown | critical | 2m | **1h** | API崩溃需要调查定位根因而非反复重启。30m repeat 导致未resolved时48次/天通知 | ⚠️ 需优化 |
| HighErrorRate | critical | 5m | **2h** | 开发团队需要时间定位问题代码。频繁通知无助于加速修复 | ⚠️ 需优化 |
| ContainerRestartLoop | critical | 10m | **15min** | ✅ 保持高频—容器重启循环是紧急的，需立即介入 | ✅ 合理 |
| APIHealthCritical | critical | 5m | **1h** | 与APIDown类似，健康分<50需要深度排查 | ⚠️ 需优化 |

#### 基础设施告警 (alerts.yml — globalreach-warning group)

| 规则名 | Severity | 当前 for | 建议 repeat | 理由 | 当前状态 |
|--------|----------|---------|-------------|------|---------|
| HighLatencyP95 | warning | 15m | **4h** | 延迟问题通常需要性能分析，非即时可修 | ⚠️ 缺runbook |
| PostgresConnectionHigh | warning | 20m | **4h** | DB连接数高需要分析慢查询或调整池配置 | ⚠️ 缺runbook |
| RedisMemoryHigh | warning | 15m | **4h** | Redis内存清理需要规划，不能立即解决 | ⚠️ 缺runbook |
| NodeFileSystemFull | warning | 20m | **2h** | 磁盘清理需要时间但不可忽视 | ⚠️ 缺runbook |
| NodeHighMemory | warning | 20m | **4h** | 内存泄漏排查耗时较长 | ⚠️ 缺runbook |
| NodeHighCPU | warning | 20m | **4h** | CPU高通常是暂时的或需长期优化 | ⚠️ 缺runbook |

#### API专用告警 (alerts.yml — globalreach-api-specific group)

| 规则名 | Severity | 当前 for | 建议 repeat | 理由 | 当前状态 |
|--------|----------|---------|-------------|------|---------|
| APIHealthDegraded | warning | 5m | **4h** | 渐进式退化，给团队观察窗口 | ⚠️ 缺runbook |
| APILatencyP50Elevated | warning | 10m | **4h** | P50升高是早期信号，不需高频提醒 | ⚠️ 缺runbook |
| APIMemoryPressure | warning | 15m | **4h** | 内存压力需要监控趋势 | ⚠️ 缺runbook |
| APIThroughputAnomaly | warning | 15m | **2h** | 吞吐量骤降可能影响业务 | ⚠️ 缺runbook |

#### 业务告警 (business-alerts.yml)

| 规则名 | Severity | 当前 for | 建议 repeat | 理由 | 当前状态 |
|--------|----------|---------|-------------|------|---------|
| HighEmailFailureRate | warning | 10m | **4h** | 邮件失败率需要检查SMTP和队列 | 有runbook_url |
| EmailPipelineStalled | info | 10m | **8h** | 管道停滞可能是计划性的 | ⚠️ 缺runbook |
| HighAPILatency | warning | 10m | **4h** | 与HighLatencyP95重复覆盖 | ⚠️ 缺runbook |
| HighAPIErrorRate | warning | 10m | **4h** | 与HighErrorRate重复覆盖 | ⚠️ 缺runbook |
| EmailQueueBacklog | info | 15m | **8h** | 低水位积压信息类 | ⚠️ 缺runbook |
| EmailQueueCritical | critical | 10m | **30min** | 高水位积压需快速响应 | ⚠️ 缺runbook |
| EmailFailuresAccumulating | warning | 20m | **4h** | 失败累积需要排查原因 | ⚠️ 缺runbook |
| NoActiveCampaigns | info | 30m | **24h** | 业务空闲信息，日级别即可 | ⚠️ 缺runbook |
| ClientCountAnomaly | info | 5m | **24h** | 数据异常检测，低频即可 | ⚠️ 缺runbook |
| SustainedHighLatencyP95 | warning | 10m | **4h** | P95持续偏高需关注 | ⚠️ 缺runbook |
| DatabaseConnectionPoolHigh | warning | 5m | **2h** | 连接池接近上限需较快响应 | ⚠️ 缺runbook |
| RedisHighMemoryUsage | info | 10m | **8h** | 低阈值内存预警 | ⚠️ 缺runbook |

#### Legacy API 告警 (legacy-api.yml)

| 规则名 | Severity | 当前 for | 建议 repeat | 理由 | 当前状态 |
|--------|----------|---------|-------------|------|---------|
| LegacyApiUsageAboveThreshold | warning | 24h | **72h** | 废弃API使用量极低频监控 | ⚠️ 缺runbook |
| LegacyApiApproachingSunset | critical | N/A | **7d** | 日落倒计时，周级别即可 | ⚠️ 缺runbook |

#### AIOps 告警 (aiops-alerts.yml)

| 规则名 | Severity | 建议 repeat | 备注 |
|--------|----------|------------|------|
| AlertStormDetected | critical | **30min** | 风暴期间需要高频跟进 |
| CascadeFailureSuspected | warning | **2h** | 级联故障需要调查时间 |
| RootCauseCandidate | info | **4h** | 信息性标记 |
| FlappingAlert | warning | **8h** | 抖动告警需要调整规则而非频繁通知 |
| MaintenanceWindowViolation | info | **24h** | 合规性信息 |
| AutoHealingTriggered | info | **4h** | 审计追踪用 |
| AIOpsEngineDown | critical | **15min** | AIOps引擎宕机是紧急的 |
| 其余AIOps告警 | warning/info | **4-8h** | 已有完整runbook_url ✅ |

### 1.4 AlertManager Route 层面调优建议

当前 `alertmanager.yml` 的 Route 1 配置：

```yaml
# Route 1: CRITICAL → Immediate multi-channel (email+webhook, 30m repeat)
- matchers:
    - severity = "critical"
  receiver: 'critical-multi'
  group_by: ['alertname', 'instance']
  group_wait: 10s
  group_interval: 2m
  repeat_interval: 30m   # ← 问题所在
```

**问题**: `repeat_interval=30m` 对所有 critical 告警统一适用，但不同 critical 告警的 MTTR 差异很大：
- `ContainerRestartLoop` → MTTR ~15min → 30m repeat 合理 ✅
- `APIDown` → MTTR ~30-60min → 30m repeat 太频繁（48次/天）⚠️
- `EmailQueueCritical` → MTTR ~15-30min → 30m repeat 合理 ✅
- `APIHealthCritical` → MTTR ~30-60min → 30m repeat 太频繁 ⚠️

**推荐方案**: 将 Route 1 的 `repeat_interval` 从 `30m` 提升到 `1h`，并为真正需要高频的个别告警（如 ContainerRestartLoop）创建专属子路由。

---

## 2. Inhibition Rule 审计与修复

### 2.1 当前 Inhibition Rules 分析

从 `alertmanager/alertmanager.yml` 提取的 8 条抑制规则：

| Rule # | Source Alert | Target Pattern | equal: | 目的 | 风险评估 |
|--------|-------------|---------------|--------|------|---------|
| 1 | severity=critical | severity=warning | instance | Critical suppresses warnings on same host | ✅ 安全 |
| 2 | APIHealthCritical | APIHealthDegraded | instance, job | Critical health suppresses degraded | ✅ 安全 |
| **3** | **APIDown** | **\*API.\*\*\*.Latency.\*\*\*.Error.\*\*\*.Throughput.\*** | **instance** | **API down suppresses all API alerts** | **⚠️ 有风险** |
| 4 | EmailQueueCritical | EmailQueueBacklog | team | Critical queue suppresses backlog | ✅ 安全 |
| 5 | ContainerRestartLoop | .*Memory.*\|.*CPU.* | instance | Restart loop suppresses resource alerts | ✅ 安全 |
| 6 | AlertStormDetected | .+ (warning only) | team | Storm suppresses individual warnings | ✅ 安全 |
| 7 | RootCauseCandidate | .*Error.*\|.*Latency.*\|.*Degraded.*\|.*Health.* | instance | Root cause suppresses symptoms | ✅ 安全 |
| 8 | AutoHealingTriggered | severity=warning | instance | Auto-heal suppresses duplicate warnings | ✅ 安全 |

### 2.2 Rule 3 详细风险分析

```yaml
# Rule 3: APIDown suppresses all other API-related alerts on same instance
- source_match:
    alertname: 'APIDown'
  target_match_re:
    alertname: '.*API.*|.*Latency.*|.*Error.*|.*Throughput.*'
  equal: ['instance']
```

**场景示例 — 为什么有风险：**

```
时间线:
T+00m  APIDown 触发 (因为 latency 升高导致健康检查超时)
        → Rule 3 生效，开始抑制:
          - HighErrorRate (被抑制 ❌)
          - HighLatencyP95 (被抑制 ❌)
          - APILatencyP50Elevated (被抑制 ❌)
          - APIThroughputAnomaly (被抑制 ❌)
T+05m  运维收到 APIDown 告警，开始排查
T+15m  发现 API 其实没 down，只是 latency 过高导致 probe timeout
        → 但此时所有 latency/error 相关告警都被抑制了！
        → 运维失去了诊断 latency 问题的线索
```

**根本原因**: APIDown 可能因多种原因触发（网络分区、进程crash、latency导致probe超时），而 Rule 3 不区分触发原因就盲目抑制所有 API 相关告警。

### 2.3 改进方案

#### 方案 A: 收窄 Rule 3 的 target 范围（推荐）

仅抑制"确实由 APIDown 直接导致的症状"，保留独立的性能告警：

```yaml
# 改进后的 Rule 3: 仅抑制直接依赖 API 可用的告警
- source_match:
    alertname: 'APIDown'
  target_match_re:
    alertname: 'APIHealthDegraded|APIHealthCritical'  # 收窄范围
  equal: ['instance', 'job']
```

**不再抑制的告警（保留独立通知）：**
- `HighErrorRate` — 错误率可能因其他原因升高（DB问题、外部依赖）
- `HighLatencyP95` / `APILatencyP50Elevated` — 延迟可能正是 APIDown 的根因！
- `APIThroughputAnomaly` — 吞吐量异常可能有独立原因

#### 方案 B: 增加 status 条件判断

如果未来为 APIDown 增加 `status` label（down vs degraded），可以条件性抑制：

```yaml
# 未来方案: 仅在 status=down 时抑制（排除 status=degraded）
- source_match:
    alertname: 'APIDown'
    status: 'down'              # 新增条件
  target_match_re:
    alertname: '.*API.*|.*Latency.*|.*Error.*|.*Throughput.*'
  equal: ['instance']
```

#### 方案 C: 新增维护窗口抑制规则

```yaml
# 新增 Rule 9: 维护窗口期间抑制非critical告警
- source_match:
    maintenance_window: 'active'
  target_match:
    severity: 'warning'
  equal: ['team']
```

**实施要求:** 在 Prometheus 规则为维护期间的告警添加 `maintenance_window: "active"` label。

---

## 3. Runbook 集成规范

### 3.1 每个 Alert 必须含有的 annotation 字段

```yaml
annotations:
  summary: "...人类可读摘要..."           # 必须 — 一句话描述
  description: "...详细描述+可能的根因..." # 必须 — 含 {{ $value }} 模板变量
  runbook: "RB-XXX.md#anchor"             # 必须！指向具体Runbook章节
  escalation: "oncall-primary"            # 推荐 — 升级路径
  dashboard: "grafana/dash/X"             # 推荐 — 相关Grafana面板URL
```

**字段说明：**

| 字段 | 必填 | 格式要求 | 示例 |
|------|------|---------|------|
| summary | ✅ | 人类可读，<80字符 | `"GlobalReach API is DOWN"` |
| description | ✅ | 含模板变量，解释影响 | `"Instance {{ $labels.instance }} has been down for more than 2 minutes."` |
| runbook | ✅ | RB-ID格式或完整URL | `"RB-001_API_SERVICE.md#Crash-Recovery"` 或 `"https://docs.globalreach.com/runbooks/api-down"` |
| escalation | 🔶 | 团队/角色名 | `"oncall-platform"`, `"team-database"` |
| dashboard | 🔶 | Grafana dashboard路径 | `"grafana/dash/api-overview"` |

### 3.2 自动生成 Runbook Link 映射

以下列出 GlobalReach V2.0 所有现有 alert 及其对应 runbook 链接。

#### 已有 runbook_url/runbook 的告警 ✅

| Alert 名称 | 文件 | runbook 引用 |
|-----------|------|-------------|
| APIDown | alerts.yml | `https://docs.globalreach.com/runbooks/api-down` |
| HighErrorRate | alerts.yml | `https://docs.globalreach.com/runbooks/high-error-rate` |
| APIHealthCritical | alerts.yml | `https://docs.globalreach.com/runbooks/health-critical` |
| AlertStormDetected | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/aiops-alert-storm` |
| CascadeFailureSuspected | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/cascade-failure` |
| RootCauseCandidate | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/root-cause-analysis` |
| FlappingAlert | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/flapping-alert` |
| MaintenanceWindowViolation | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/maintenance-window` |
| AutoHealingTriggered | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/auto-healing` |
| AIOpsCorrelationLatencyHigh | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/aiops-latency` |
| AIOpsDedupRateDropped | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/dedup-rate` |
| AIOpsActiveClustersHigh | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/cluster-management` |
| AIOpsEngineDown | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/aiops-engine-down` |
| AIOpsMetricsMissing | aiops-alerts.yml | `https://docs.globalreach.com/runbooks/aiops-metrics-missing` |
| PerformanceRegressionP95 | performance-alerts.yml | `https://docs.globalreach.com/runbooks/p95-regression` |
| PerformanceRegressionP99 | performance-alerts.yml | `https://docs.globalreach.com/runbooks/p99-regression` |
| PerformanceErrorRateSpike | performance-alerts.yml | `https://docs.globalreach.com/runbooks/error-spike` |
| PerformanceErrorRateDoubling | performance-alerts.yml | `https://docs.globalreach.com/runbooks/error-trend` |
| PerformanceThroughputDrop | performance-alerts.yml | `https://docs.globalreach.com/runbooks/throughput-drop` |
| DatabaseQueryLatencyHigh | performance-alerts.yml | `https://docs.globalreach.com/runbooks/db-slow-query` |
| DatabaseConnectionPoolExhaustion | performance-alerts.yml | `https://docs.globalreach.com/runbooks/db-pool-exhaustion` |
| RedisOperationLatencyHigh | performance-alerts.yml | `https://docs.globalreach.com/runbooks/redis-latency` |
| HeapMemoryUsageHigh | performance-alerts.yml | `https://docs.globalreach.com/runbooks/high-memory` |
| RSSMemoryApproachingLimit | performance-alerts.yml | `https://docs.globalreach.com/runbooks/rss-high` |
| K6BenchmarkThresholdBreached | performance-alerts.yml | `https://docs.globalreach.com/runbooks/benchmark-fail` |
| GlobalReachAPIHighErrorRate | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/api-error-rate` |
| GlobalReachAPINoRequests | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/api-down` |
| GlobalReachHighSlowRequestRate | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/slow-requests` |
| GlobalReachLogVolumeDrop | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/log-volume-drop` |
| GlobalReachAuthFailureSpike | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/auth-spike` |
| GlobalReachSustainedAuthFailures | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/sustained-auth` |
| GlobalReachHighErrorLogVolume | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/error-log-volume` |
| GlobalReachLogVolumeSpike | loki-metrics-alerts.yml | `https://docs.globalreach.com/runbooks/log-spike` |
| HighEmailFailureRate | business-alerts.yml | `https://docs.globalreach.com/runbooks/email-failure-rate` |
| APIHighErrorRate | application-health.yml | `RB-001_API_SERVICE.md#Error-Rate` |
| APIProcessUnhealthy | application-health.yml | `RB-001_API_SERVICE.md#Crash-Recovery` |
| DBConnectionPoolExhausted | application-health.yml | `RB-002_POSTGRES.md#Pool-Exhaustion` |
| EmailDeliveryFailureRateHigh | business-metrics.yml | `RB-007_EMAIL_PIPELINE.md#Delivery-Failure` |

#### 缺少 runbook 的告警 — 本次补全目标 ⚠️

| Alert 名称 | 文件 | Severity | 建议Runbook ID |
|-----------|------|----------|---------------|
| ContainerRestartLoop | alerts.yml | critical | `RB-003_CONTAINER.md#Restart-Loop` |
| HighLatencyP95 | alerts.yml | warning | `RB-001_API_SERVICE.md#Latency-P95` |
| PostgresConnectionHigh | alerts.yml | warning | `RB-002_POSTGRES.md#Connections` |
| RedisMemoryHigh | alerts.yml | warning | `RB-004_REDIS.md#Memory` |
| NodeFileSystemFull | alerts.yml | warning | `RB-005_INFRA.md#Disk` |
| NodeHighMemory | alerts.yml | warning | `RB-005_INFRA.md#Memory` |
| NodeHighCPU | alerts.yml | warning | `RB-005_INFRA.md#CPU` |
| APIHealthDegraded | alerts.yml | warning | `RB-001_API_SERVICE.md#Health-Score` |
| APILatencyP50Elevated | alerts.yml | warning | `RB-001_API_SERVICE.md#Latency-P50` |
| APIMemoryPressure | alerts.yml | warning | `RB-003_CONTAINER.md#Memory-Pressure` |
| APIThroughputAnomaly | alerts.yml | warning | `RB-001_API_SERVICE.md#Throughput` |
| LegacyApiUsageAboveThreshold | legacy-api.yml | warning | `RB-006_LEGACY-API.md#Usage` |
| LegacyApiApproachingSunset | legacy-api.yml | critical | `RB-006_LEGACY-API.md#Sunset` |
| EmailPipelineStalled | business-alerts.yml | info | `RB-007_EMAIL_PIPELINE.md#Stalled` |
| HighAPILatency | business-alerts.yml | warning | `RB-001_API_SERVICE.md#Latency-P99` |
| HighAPIErrorRate | business-alerts.yml | warning | `RB-001_API_SERVICE.md#Error-Rate` |
| EmailQueueBacklog | business-alerts.yml | info | `RB-007_EMAIL_PIPELINE.md#Backlog` |
| EmailQueueCritical | business-alerts.yml | critical | `RB-007_EMAIL_PIPELINE.md#Critical` |
| EmailFailuresAccumulating | business-alerts.yml | warning | `RB-007_EMAIL_PIPELINE.md#Failures` |
| NoActiveCampaigns | business-alerts.yml | info | `RB-008_BUSINESS.md#Campaigns` |
| ClientCountAnomaly | business-alerts.yml | info | `RB-008_BUSINESS.md#Clients` |
| SustainedHighLatencyP95 | business-alerts.yml | warning | `RB-001_API_SERVICE.md#Latency-P95-Sustained` |
| DatabaseConnectionPoolHigh | business-alerts.yml | warning | `RB-002_POSTGRES.md#Pool-High` |
| RedisHighMemoryUsage | business-alerts.yml | info | `RB-004_REDIS.md#Memory-Warn` |
| APIWarningRateSpike | application-health.yml | warning | `RB-001_API_SERVICE.md#Warning-Rate` |
| APILatencyP99High | application-health.yml | warning | `RB-001_API_SERVICE.md#Latency-P99` |
| APILatencyP95Critical | application-health.yml | critical | `RB-001_API_SERVICE.md#Latency-P95-Critical` |
| JWTFailureRateHigh | application-health.yml | warning | `RB-009_SECURITY.md#JWT` |
| RateLimitBreachedFrequently | application-health.yml | warning | `RB-001_API_SERVICE.md#Rate-Limit` |
| APIHeapMemoryHigh | application-health.yml | warning | `RB-003_CONTAINER.md#Heap-Memory` |
| RedisConnectionFailures | application-health.yml | warning | `RB-004_REDIS.md#Connections` |
| EmailQueueBacklogGrowing | business-metrics.yml | warning | `RB-007_EMAIL_PIPELINE.md#Backlog-Growing` |
| AccountPoolExhausted | business-metrics.yml | warning | `RB-010_ACCOUNT_POOL.md#Exhausted` |
| UnusualCampaignCreationSpike | business-metrics.yml | info | `RB-008_BUSINESS.md#Campaign-Spike` |
| NewUserRegistrationSpike | business-metrics.yml | info | `RB-009_SECURITY.md#Registration-Spike` |

---

## 4. Ownership 元数据规范

### 4.1 Label 要求

每个 alert rule **必须**包含以下 labels：

```yaml
labels:
  severity: critical|warning|info     # 必须 — 告警等级
  team: platform|database|infra|security|operations|business  # 必须 — 团队归属
  service: api|postgres|redis|nginx|email|globalreach  # 推荐 — 所属服务
  runbook: "RB-XXX"                   # 推荐 — Runbook ID (与annotation.runbook对应)
```

### 4.2 Team 分工矩阵

| Team | 负责服务 | 主要告警类别 | On-call 轮换 |
|------|---------|-------------|-------------|
| platform | globalreach-api, containers | API可用性、延迟、错误率、容器健康 | ✅ 有 |
| database | postgresql, redis | DB连接池、Redis内存、查询延迟 | ✅ 有 |
| infra | node_exporter, filesystem | 磁盘、CPU、内存、网络 | ✅ 有 |
| security | auth, JWT, rate-limiting | 认证失败、异常注册 | ✅ 有 |
| operations | email queue, campaigns | 邮件管道、队列积压 | ✅ 有 |
| business | clients, campaigns | 业务指标异常 | 📋 待建立 |

### 4.3 当前 Ownership 覆盖率统计

| 维度 | 总数 | 已标注 | 覆盖率 |
|------|-----|-------|-------|
| severity label | ~50 | ~50 | **100%** ✅ |
| team label | ~50 | ~45 | **90%** ⚠️ |
| service label | ~50 | 0 | **0%** ❌ |
| runbook annotation | ~50 | ~28 | **56%** ❌ |
| escalation annotation | ~50 | 0 | **0%** ❌ |
| dashboard annotation | ~50 | 0 | **0%** ❌ |

**改进优先级:**
1. 🔴 补全 runbook annotation (44% 缺失) — **本次 DEBT-027 重点**
2. 🟡 为所有 alert 添加 service label
3. 🟢 为 critical/warning alert 添加 escalation annotation
4. 🟢 为关键 alert 添加 dashboard annotation

---

## 5. Postmortem 流程

### 5.1 Alert 质量评估周期

```
┌─────────────────────────────────────────────────────┐
│                  Alert 质量持续改进循环                │
│                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │ 每周回顾  │───▶│ 每月调整  │───▶│ 每季度审查 │      │
│  │          │    │          │    │          │      │
│  │ • FP数量 │    │ • 阈值 tuning│  │ • 覆盖率  │      │
│  │ • FN数量 │    │ • repeat 调整│  │ • 新需求  │      │
│  │ • MTTD   │    │ • 规则增删  │  │ • 架构变更 │      │
│  │ • 噪音投诉 │    │ • inhibition │  │ • SLA对齐 │      │
│  └──────────┘    └──────────┘    └──────────┘      │
│       ▲                              │              │
│       └──────────────────────────────┘              │
│                  记分卡驱动改进                       │
└─────────────────────────────────────────────────────┘
```

#### 每周回顾 (Weekly — 周一 Standup)

- 统计上周 False Positive 数量和原因分类
- 识别 Top 3 噪音最大的告警
- 确认是否有新告警需要创建
- 输出: 周报 → Slack #alert-review channel

#### 每月调整 (Monthly — 第二个周二)

- 基于 FP/FN 数据调整阈值
- 评估并调整 repeat_interval
- 审查 inhibition rules 是否误抑制
- 更新 runbook 链接有效性
- 输出: 月度 Alert Quality Report

#### 每季度审查 (Quarterly — 季度初)

- 全量规则覆盖率审计 (故障模式 vs 告警规则)
- 评估新架构组件是否缺少监控
- SLA 对齐检查 (MTTD 是否满足各 severity 的响应时间要求)
- 团队 ownership 变更同步
- 输出: 季度 Alert Maturity Report

### 5.2 Alert 质量记分卡

| 维度 | 权重 | 评分方法 | 数据来源 | 目标值 |
|------|------|---------|---------|-------|
| **Actionability** | 30% | 收到后能否立即采取明确行动? | 运维问卷 | ≥4.0/5.0 |
| **Accuracy** | 25% | FP率是否 <20%? | AlertManager resolved-without-action / total | ≤20% |
| **Timeliness** | 20% | MTTD是否符合severity要求? | fired_at - first_detected | P0≤5min, P1≤15min |
| **Completeness** | 15% | annotation是否完整(5字段)? | 自动扫描 | 100% |
| **Coverage** | 10% | 故障模式是否有对应规则? | 故障模式矩阵对比 | ≥90% |

**评分计算公式：**

```
AlertQualityScore =
  Actionability × 0.30 +
  Accuracy     × 0.25 +
  Timeliness   × 0.20 +
  Completeness × 0.15 +
  Coverage     × 0.10
```

**评级标准：**

| Score | Grade | 行动 |
|-------|-------|------|
| ≥4.5 | A | 维持现状，季度审查 |
| 4.0-4.4 | B | 小幅优化，月度跟踪 |
| 3.5-3.9 | C | 需要重点改进 |
| <3.5 | D | 重新设计告警策略 |

### 5.3 False Positive 分类法

当确认一个 False Positive 时，按以下分类记录：

| FP 类别 | 典型场景 | 处理方式 |
|---------|---------|---------|
| **阈值过敏感** | 正常波动触碰阈值 | 提高 threshold 或增加 for duration |
| **维护窗口噪音** | 部署/升级期间触发 | 配合 maintenance label 或 time filter |
| **级联告警** | 上游故障引发下游大量告警 | 加强 inhibition rules |
| **测试环境泄露** | staging/prod 指标混入 | 添加 environment label 过滤 |
| **已知限制** | 暂无法修复的基础设施问题 | 静默(silence)或降级为info |

### 5.4 告警生命周期管理

```
新建(Proposed) → 评审(Review) → 试运行(Pilot, 2w) → 正式(Active) → 定期评估(Reviewed)
                                                                             ↓
                                                                    退役(Deprecated)
```

- **试运行期**: 新告警先以 `severity: info` 运行 2 周，仅发送 digest，验证准确率后再提升
- **正式发布**: 通过试运行后提升至目标 severity
- **退役标准**: 连续 90 天未触发且无业务价值 → 标记 deprecated → 30天后删除

---

## 6. 变更日志

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0.0 | 2026-06-09 | Initial playbook — S133/DEBT-027: 告警分级体系、Inhibition Rule审计、Runbook映射表、Ownership规范、Postmortem流程、质量记分卡 | S133 Agent |

---

## 附录 A: 快速参考 — 告警修改 Checklist

在修改任何告警规则前，确认以下项目：

- [ ] **Severity 选择合理?** — 对照 1.1 定义表
- [ ] **for duration 适当?** — 避免瞬时毛刺触发
- [ ] **repeat_interval 匹配 MTTR?** — 使用 1.2 公式计算
- [ ] **summary < 80字符?** — 便于手机/IM 显示
- [ ] **description 含 $value/$labels?** — 提供上下文
- [ ] **runbook 链接有效?** — 指向具体章节锚点
- [ ] **team label 正确?** — 确保 on-call 能收到
- [ ] **service label 已添加?** — 支持按服务过滤
- [ ] **escalation path 明确?** — 出问题时知道找谁
- [ ] **dashboard URL 可访问?** — Grafana 面板存在
- [ ] **inhibition rules 无冲突?** — 不会被错误抑制
- [ ] **无重复规则?** — 检查已有规则覆盖
- [ ] **已在 CHANGELOG 记录?** — 可追溯变更
