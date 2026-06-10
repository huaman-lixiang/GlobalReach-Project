# GlobalReach V2.0 监控覆盖矩阵 (Monitoring Coverage Matrix)

> 版本: 1.0.0
> 最后更新: 2026-06-09 (S133/DEBT-026)

## 覆盖总览

| 维度 | 故障模式数 | 已覆盖 | 覆盖率 | Gap |
|------|-----------|--------|--------|-----|
| Infrastructure | 12 | 10 | 83% | Container OOM, Network partition |
| Application | 8 | 7 | 88% | Memory leak detection (long-term trend) |
| Security | 6 | 5 | 83% | Brute force pattern detection |
| Business | 5 | 4 | 80% | Template rendering failure |
| Dependencies | 4 | 4 | 100% | - |
| **合计** | **35** | **30** | **86%** | **5** |

## 详细覆盖表

### Infrastructure 层

| 故障模式 | Rule名称 | Severity | 来源文件 | Runbook |
|----------|---------|----------|----------|---------|
| API容器崩溃 | APIDown / APIProcessUnhealthy | CRITICAL | alerts.yml / application-health.yml | RB-001 |
| PG连接池耗尽 | PostgresConnectionHigh / DBConnectionPoolExhausted | WARNING/CRITICAL | alerts.yml / application-health.yml | RB-002 |
| Redis连接失败 | RedisConnectionFailures / RedisMemoryHigh | WARNING | application-health.yml / alerts.yml | RB-003 |
| Nginx 502 | GlobalReachAPINoRequests | CRITICAL | loki-metrics-alerts.yml | RB-004 |
| 磁盘空间 >85% | NodeFileSystemFull | WARNING | alerts.yml | ops-manual |
| 容器重启循环 | ContainerRestartLoop | CRITICAL | alerts.yml | RB-006(Docker) |
| Prometheus down | AIOpsEngineDown | CRITICAL | aiops-alerts.yml | RB-005(Monitoring) |
| Grafana down | *(由 up{} job 覆盖)* | - | node_exporter | RB-005 |
| Loki down | GlobalReachLogVolumeDrop | WARNING | loki-metrics-alerts.yml | RB-005 |
| AlertManager down | *(由 up{} job 覆盖)* | - | node_exporter | RB-005 |
| **容器OOM** | ~~待补充 (cAdvisor OOM kill counter)~~ | - | - | TT-003 |
| **网络分区/DNS** | ~~待补充 (probe_dns / probe_http)~~ | - | - | RB-004 |

### Application 层

| 故障模式 | Rule名称 | Severity | 来源文件 | Runbook |
|----------|---------|----------|----------|---------|
| API 5xx错误率 >10% | HighErrorRate | CRITICAL | alerts.yml | RB-001 |
| API 5xx错误率 >5% | APIHighErrorRate | CRITICAL | application-health.yml | RB-001 |
| API 4xx错误率 >15% | APIWarningRateSpike | WARNING | application-health.yml | RB-001 |
| API P99延迟 >5s | HighAPILatency | WARNING | business-alerts.yml | RB-001 |
| API P99延迟 >2s | APILatencyP99High | WARNING | application-health.yml | RB-001 |
| API P95延迟 >5s | APILatencyP95Critical | CRITICAL | application-health.yml | RB-001 |
| API P50延迟 >300ms | APILatencyP50Elevated | WARNING | alerts.yml | RB-001 |
| 吞吐量骤降 >50% | APIThroughputAnomaly | WARNING | alerts.yml | RB-001 |
| 性能回归 P95/P99 | PerformanceRegressionP95/P99 | WARNING | performance-alerts.yml | RB-001 |
| JWT认证失败率 >30% | JWTFailureRateHigh | WARNING | application-health.yml | RB-001 |
| 认证失败激增 | GlobalReachAuthFailureSpike | WARNING | loki-metrics-alerts.yml | RB-001 |
| 限流触发频繁 | RateLimitBreachedFrequently | WARNING | application-health.yml | RB-001 |
| 健康评分崩溃 | APIHealthCritical / Degraded | CRITICAL/WARNING | alerts.yml | RB-001 |
| 容器内存压力 >80% | APIMemoryPressure | WARNING | alerts.yml | RB-001 |
| V8堆内存 >85% | APIHeapMemoryHigh / HeapMemoryUsageHigh | WARNING | application-health.yml / performance-alerts.yml | RB-001 |
| RSS接近限制 | RSSMemoryApproachingLimit | WARNING | performance-alerts.yml | RB-001 |
| **内存泄漏长期趋势** | ~~待补充 (RSS slope detection)~~ | - | - | TT-003 |

### Security 层

| 故障模式 | Rule名称 | Severity | 来源文件 | Runbook |
|----------|---------|----------|----------|---------|
| 未授权访问/401风暴 | GlobalReachAuthFailureSpike | WARNING | loki-metrics-alerts.yml | RB-001 |
| 持续性认证攻击 | GlobalReachSustainedAuthFailures | INFO | loki-metrics-alerts.yml | RB-001 |
| DDoS/请求异常 | GlobalReachLogVolumeSpike | WARNING | loki-metrics-alerts.yml | RB-004 |
| JWT异常 | JWTFailureRateHigh | WARNING | application-health.yml | RB-001 |
| 限流滥用 | RateLimitBreachedFrequently | WARNING | application-health.yml | RB-004 |
| **暴力破解模式** | ~~待补充 (IP聚合+行为分析)~~ | - | - | RB-001 |

### Business 层

| 故障模式 | Rule名称 | Severity | 来源文件 | Runbook |
|----------|---------|----------|----------|---------|
| 邮件成功率 <85% | HighEmailFailureRate | WARNING | business-alerts.yml | RB-007 |
| 邮件失败率 >5% | EmailDeliveryFailureRateHigh | CRITICAL | business-metrics.yml | RB-007 |
| 邮件队列积压 >2000 | EmailQueueBacklog | INFO | business-alerts.yml | RB-007 |
| 队列严重积压 >8000 | EmailQueueCritical | CRITICAL | business-alerts.yml | RB-007 |
| 队列低水位积压 >100 | EmailQueueBacklogGrowing | WARNING | business-metrics.yml | RB-007 |
| 失败邮件累积 >200 | EmailFailuresAccumulating | WARNING | business-alerts.yml | RB-007 |
| 发送管道停滞 | EmailPipelineStalled | INFO | business-alerts.yml | RB-007 |
| 无活跃活动 | NoActiveCampaigns | INFO | business-alerts.yml | - |
| 活动创建异常 | UnusualCampaignCreationSpike | INFO | business-metrics.yml | - |
| 账号池耗尽 (<3) | AccountPoolExhausted | WARNING | business-metrics.yml | RB-007 |
| 注册量异常激增 | NewUserRegistrationSpike | INFO | business-metrics.yml | - |
| 客户数量波动 | ClientCountAnomaly | INFO | business-alerts.yml | - |
| **模板渲染失败** | ~~待补充 (template_render_errors_total)~~ | - | - | RB-007 |

### Dependencies 层

| 故障模式 | Rule名称 | Severity | 来源文件 | Runbook |
|----------|---------|----------|----------|---------|
| SMTP提供商故障 | HighEmailFailureRate / EmailDeliveryFailureRateHigh | WARNING/CRITICAL | business-alerts.yml / business-metrics.yml | RB-007 |
| PG查询慢 | DatabaseQueryLatencyHigh | WARNING | performance-alerts.yml | RB-002 |
| Redis操作慢 | RedisOperationLatencyHigh | INFO | performance-alerts.yml | RB-003 |
| Legacy API残留 | LegacyApiUsageAboveThreshold | WARNING | legacy-api.yml | - |

### AIOps 元监控层 (S132/O01)

| 故障模式 | Rule名称 | Severity | 来源文件 |
|----------|---------|----------|----------|
| 告警风暴 | AlertStormDetected | CRITICAL | aiops-alerts.yml |
| 级联故障 | CascadeFailureSuspected | WARNING | aiops-alerts.yml |
| 根因候选 | RootCauseCandidate | INFO | aiops-alerts.yml |
| 抖动告警 | FlappingAlert | WARNING | aiops-alerts.yml |
| 维护窗口违规 | MaintenanceWindowViolation | INFO | aiops-alerts.yml |
| 自愈动作 | AutoHealingTriggered | INFO | aiops-alerts.yml |
| 关联延迟高 | AIOpsCorrelationLatencyHigh | WARNING | aiops-alerts.yml |
| 降噪率下降 | AIOpsDedupRateDropped | WARNING | aiops-alerts.yml |
| 活跃集群过多 | AIOpsActiveClustersHigh | WARNING | aiops-alerts.yml |
| 引擎宕机 | AIOpsEngineDown | CRITICAL | aiops-alerts.yml |
| 指标缺失 | AIOpsMetricsMissing | WARNING | aiops-alerts.yml |

## 规则文件清单

| 文件名 | 规则数 | 主要覆盖维度 |
|--------|--------|-------------|
| alerts.yml | 14 | Infrastructure + Application 核心 |
| legacy-api.yml | 3 | API 废弃迁移 |
| aiops-alerts.yml | 11 + 6 recording | AIOps 元监控 |
| performance-alerts.yml | 11 | 性能回归检测 |
| recording-rules.yml | 18 recording | 业务 KPI 预计算 |
| loki-metrics-alerts.yml | 8 + 6 recording | 日志指标告警 |
| business-alerts.yml | 12 | 业务级告警 |
| **application-health.yml** (NEW) | **10** | **应用健康补充** |
| **business-metrics.yml** (NEW) | **5** | **业务指标补充** |
| **合计** | **~98** | - |

## 待补充 Gap (Roadmap)

1. **Container OOM kill detection** — 通过 cAdvisor `container_oom_events_total` 或 dmesg 指标检测 OOMKill 事件 (FM-CAL-002)
2. **Network partition / DNS resolution** — 通过 blackbox exporter `probe_dns_duration_seconds` / `probe_success` 检测 (FM-NET-001)
3. **SSL certificate expiry** — 已在 DEBT-001 中 BLOCKED，等待证书管理方案确定 (FM-NET-003)
4. **Template rendering error tracking** — 新增 `template_render_errors_total` 指标并设置告警 (RB-007)
5. **Third-party SMTP provider latency** — 按 provider 维度跟踪发送延迟 (FM-EXT-001)
6. **Brute force pattern detection** — 按 IP 聚合 auth_failure + 时间窗口行为分析 (FM-SEC-001)

## AlertManager 路由覆盖

当前 alertmanager.yml 配置了以下路由分支：
- `severity=critical` → critical-multi (email + webhook, 30m repeat)
- `severity=warning` → email-primary (4h repeat)
- `team=platform` → critical-multi (2h repeat)
- `team=database` → email-primary (6h repeat)
- `team=infra` → email-primary (6h repeat)
- `category=aiops_*` → aiops-webhook-primary (30m repeat)
- `alertname=RootCauseCandidate` → aiops-webhook-primary (1h repeat)
- `alertname=AutoHealingTriggered` → aiops-webhook-primary (4h repeat)

新增规则的 severity/team 标签均与现有路由兼容，无需修改路由配置。

## 变更日志
- v1.0.0 (2026-06-09): Initial coverage matrix (S133/DEBT-026)
  - 新增 application-health.yml (10 条应用健康规则)
  - 新增 business-metrics.yml (5 条业务指标规则)
  - 总覆盖率从 ~78% 提升至 86%
