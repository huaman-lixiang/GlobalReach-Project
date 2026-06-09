# GlobalReach V2.0 告警规则精细化调优指南 (M-B04)

**版本**: v1.0
**日期**: 2026-06-09
**作者**: GlobalReach 告警规则精细化执行者

---

## 📋 目录

1. [调优概述](#调优概述)
2. [基础规则调优详情](#基础规则调优详情)
3. [业务规则调优详情](#业务规则调优详情)
4. [新增告警规则说明](#新增告警规则说明)
5. [AlertManager 路由优化](#alertmanager-路由优化)
6. [误报 vs 真实告警判断指南](#误报-vs-真实告警判断指南)
7. [告警升级策略](#告警升级策略)
8. [告警值班 SOP](#告警值班-sop)
9. [维护窗口静默配置](#维护窗口静默配置)

---

## 调优概述

### 调优目标
- **降低误报率**: 从历史日志分析，APIHealthCritical 曾持续触发造成噪声
- **保留关键告警**: OOM、DB Down、证书过期等关键告警不受影响
- **提升可操作性**: 每条告警都有明确的处理建议和 runbook 链接

### 调优统计
| 类别 | 规则数 | 优化项 | 新增 |
|------|--------|--------|------|
| 基础规则 (alerts.yml) | 14 | 12项调整 | - |
| 业务规则 (business-alerts.yml) | 9 | 6项调整 | +3 |
| AlertManager 配置 | - | 5条抑制规则 | - |
| **总计** | **25** | **23项调整** | **+3** |

---

## 基础规则调优详情

### CRITICAL 级别规则

#### 1. APIDown (API 宕机)
- **原始配置**: `for: 1m`
- **优化后**: `for: 2m`
- **调优理由**:
  - 容器重启（如 K8s 滚动更新）可能导致短暂的 `up == 0`
  - 2分钟窗口可过滤掉正常的重启瞬断
  - 仍能保证在真实宕机时快速响应
- **误报场景**: 容器健康检查失败导致的自动重启
- **真实告警特征**: 持续 >5min 未恢复，伴随 ContainerRestartLoop

#### 2. HighErrorRate (高错误率)
- **原始配置**: 错误率>10%, `for: 5m`
- **优化后**: 保持不变
- **调优理由**: 10%错误率已是严重异常，需立即关注
- **注意事项**: 此阈值不可再提高，否则会漏掉真正的服务降级

#### 3. ContainerRestartLoop (容器重启循环)
- **原始配置**: `for: 5m` (1小时内>5次重启)
- **优化后**: `for: 10m`
- **调优理由**:
  - 5分钟可能包含偶发的 OOM 重启
  - 10分钟窗口更能确认是持续的崩溃循环
  - 与 APIDown 的 2m 形成层级关系
- **关联抑制**: 会抑制同实例的 Memory/CPU 告警

#### 4. APIHealthCritical (健康分严重下降) ⭐ 重点调优
- **原始配置**: `<60`, `for: 2m`
- **优化后**: `<50`, `for: 5m`
- **调优理由**:
  - **历史问题**: 该告警曾持续触发（从 docker logs 可见），造成大量噪声
  - 健康检查逻辑可能对临时波动敏感
  - <50 分表示系统已严重退化，需要立即干预
  - 5分钟持续时间确保不是瞬时的分数波动
- **误报判断**:
  - ❌ 误报: 健康分在 55-65 之间波动（正常负载变化）
  - ✅ 真实告警: 健康分持续 <50 且伴随其他指标异常
- **关联规则**: 会抑制 APIHealthDegraded (<75)

### WARNING 级别规则

#### 5. HighLatencyP95 (P95 延迟过高)
- **原始配置**: `>2s`, `for: 10m`
- **优化后**: `>3s`, `for: 15m`
- **调优理由**:
  - 2秒 P95 在高并发时可能正常触发
  - 3秒才是用户明显感知的延迟门槛
  - 15分钟确保是持续性性能问题，而非瞬时峰值
- **业务影响**: 用户开始感知卡顿的临界点

#### 6. PostgresConnectionHigh (PostgreSQL 连接数过高)
- **原始配置**: `>80`, `for: 15m`
- **优化后**: `>80`, `for: 20m`
- **调优理由**:
  - 连接池突增可能是批量任务导致
  - 20分钟给 DBA 足够时间观察是否自动恢复
- **处理建议**: 检查是否有慢查询或连接泄漏

#### 7. RedisMemoryHigh (Redis 内存使用率过高)
- **原始配置**: `>80%`, `for: 10m`
- **优化后**: `>85%`, `for: 15m`
- **调优理由**:
  - Redis 在 80% 时仍可正常工作（有淘汰策略）
  - 85% 更接近真正需要关注的内存压力点
  - 新增了 RedisHighMemoryUsage (>70%) 作为早期预警
- **分层监控**:
  - Info: >70% (RedisHighMemoryUsage, 新增)
  - Warning: >85% (RedisMemoryHigh, 已有)

#### 8. NodeFileSystemFull (磁盘空间不足)
- **原始配置**: `<20%`, `for: 15m`
- **优化后**: `<15%`, `for: 20m`
- **调优理由**:
  - 20% 剩余空间在日常运维中较常见（日志、备份）
  - 15% 才是需要立即清理的警戒线
  - 20分钟避免因临时大文件写入导致的误报
- **紧急程度**: 磁盘满会导致数据丢失，但 15% 仍有操作时间

#### 9. NodeHighMemory (主机内存使用率高)
- **原始配置**: `>85%`, `for: 15m`
- **优化后**: `>90%`, `for: 20m`
- **调优理由**:
  - Node.js 应用正常运行时 GC 可能导致 85-90% 波动
  - 90% 才是真正接近 OOM 的危险区域
  - Linux 内存管理机制会使用空闲内存做缓存
- **误报场景**: 文件读取、缓存预热导致的瞬时高峰

#### 10. NodeHighCPU (主机 CPU 使用率高)
- **原始配置**: `>90%`, `for: 15m`
- **优化后**: `>90%, for: 20m`
- **调优理由**: 阈值保持不变（90% 已是高负载），仅延长观察时间
- **业务背景**: 短时间 CPU 飙升（如编译、压缩）是正常的

### API-Specific 规则

#### 11. APIHealthDegraded (健康分轻微下降)
- **原始配置**: `<80`, `for: 3m`
- **优化后**: `<75`, `for: 5m`
- **调优理由**:
  - 80 分在正常负载波动范围内
  - 75 分才开始值得关注
  - 被 APIHealthCritical (<50) 抑制，避免重复告警

#### 12. APILatencyP50Elevated (中位数延迟升高)
- **原始配置**: `>200ms`, `for: 5m`
- **优化后**: `>300ms`, `for: 10m`
- **调优理由**:
  - 200ms P50 在网络延迟较高时可能触发
  - 300ms 是用户可感知的延迟门槛
  - 10分钟确保不是单次慢请求导致

#### 13. APIMemoryPressure (容器内存压力)
- **原始配置**: `>75% RSS`, `for: 10m`
- **优化后**: `>80% RSS`, `for: 15m`
- **调优理由**:
  - 75% RSS 在 Node.js 应用中较常见（V8 堆 + 缓冲区）
  - 80% 更接近容器内存限制的危险区
  - 15分钟给 GC 足够时间回收内存

#### 14. APIThroughputAnomaly (吞吐量异常下降)
- **原始配置**: `drop >50%`, `for: 10m`
- **优化后**: `drop >50%`, `for: 15m`
- **调优理由**:
  - 吞吐量下降可能是流量自然波谷（如夜间）
  - 15分钟确认是异常而非周期性波动
- **特殊场景**: 营销活动结束后的正常流量下降

---

## 业务规则调优详情

### Email Delivery Alerts

#### 15. HighEmailFailureRate (邮件发送失败率高)
- **原始配置**: `<90%`, `for: 5m`
- **优化后**: `<85%`, `for: 10m`
- **调优理由**:
  - 90% 成功率在邮件营销中较常见（无效地址、退信）
  - 85% 才是 SMTP 服务商或队列问题的信号
  - 10分钟避免因临时网络抖动导致误报
- **业务影响**: 影响营销活动送达率和客户体验

#### 16. EmailPipelineStalled (邮件管道停滞)
- **原始配置**: 保持不变 (`==0`, `for: 10m`)
- **调优理由**: 10分钟无邮件发送确实是异常，需保持敏感度

### API Performance Alerts

#### 17. HighAPILatency (API P99 延迟过高)
- **原始配置**: `>3000ms`, `for: 5m`
- **优化后**: `>5000ms`, `for: 10m`
- **调优理由**:
  - 3秒 P99 在复杂查询（如报表导出）时可能触发
  - 5秒才是用户无法接受的延迟门槛
  - 与 SustainedHighLatencyP95 (>500ms P95) 形成分层监控
- **分层监控**:
  - Warning: P99 >5s (HighAPILatency)
  - Warning: P95 >500ms (SustainedHighLatencyP95, 新增)

#### 18. HighAPIErrorRate (API 错误率过高)
- **原始配置**: `>5%`, `for: 5m`
- **优化后**: `>10%`, `for: 10m`
- **调优理由**:
  - 5% 错误率可能包含客户端错误（4xx）
  - 10% 才是服务端问题的明确信号
  - 10分钟确认不是偶发请求失败

### Queue Backlog Alerts

#### 19. EmailQueueBacklog (邮件队列积压)
- **原始配置**: `>1000`, `for: 10m`
- **优化后**: `>2000`, `for: 15m`
- **调优理由**:
  - 1000 封邮件在大促期间可能很快积累
  - 2000 才是需要人工干预的积压量级
  - 被 EmailQueueCritical 抑制

#### 20. EmailQueueCritical (邮件队列严重积压)
- **原始配置**: `>5000`, `for: 5m`
- **优化后**: `>8000`, `for: 10m`
- **调优理由**:
  - 5000 可能在大型营销活动中快速达到
  - 8000 是队列接近上限的临界值
  - 10分钟给运维团队扩容时间
- **紧急程度**: Critical 级别，需立即处理

#### 21. EmailFailuresAccumulating (失败邮件累积)
- **原始配置**: `>100`, `for: 15m`
- **优化后**: `>200`, `for: 20m`
- **调优理由**:
  - 100 封失败邮件可能在退信高峰时出现
  - 200 封才需要排查失败原因（SMTP 配置、黑名单等）

### Business Health Alerts

#### 22. NoActiveCampaigns (无活跃营销活动)
- **原始配置**: 保持不变 (`==0`, `for: 30m`)
- **调优理由**: Info 级别，用于业务状态感知，无需调整

#### 23. ClientCountAnomaly (客户数量异常波动)
- **原始配置**: 保持不变
- **调优理由**: Info 级别，数据异常检测，保持敏感度

---

## 新增告警规则说明

### 24. SustainedHighLatencyP95 (API P95 延迟持续偏高)
```yaml
- alert: SustainedHighLatencyP95
  expr: histogram_quantile(0.95, sum(rate(globalreach_api_request_duration_seconds_bucket[5m])) by (le)) > 0.5
  for: 10m
  labels:
    severity: warning
```

**设计目的**:
- 补充 P99 和 P50 之间的监控盲区
- P95 >500ms 表示大部分用户已感知到延迟
- 10分钟持续时间确保是系统性问题

**与现有规则的关系**:
- 比 HighLatencyP95 (>3s) 更早预警
- 比 APILatencyP50Elevated (>300ms) 更严格
- 形成三层延迟监控：P50 → P95 → P99

**适用场景**:
- 数据库慢查询增加
- 缓存命中率下降
- 网络延迟增加

---

### 25. DatabaseConnectionPoolHigh (数据库连接池使用率过高)
```yaml
- alert: DatabaseConnectionPoolHigh
  expr: globalreach_db_connections_active / 20 > 0.8
  for: 5m
  labels:
    severity: warning
```

**设计目的**:
- 监控应用层连接池使用情况（区别于 PostgresConnectionHigh 的数据库层面）
- 80% 使用率意味着即将耗尽连接
- 5分钟快速响应，避免连接池耗尽导致请求阻塞

**关键参数**:
- 连接池大小: 20（根据 application.yml 配置）
- 阈值: 80%（16个活跃连接）

**处理建议**:
1. 检查是否有慢查询占用连接
2. 考虑增加连接池大小
3. 检查连接泄漏（未正确释放）

---

### 26. RedisHighMemoryUsage (Redis 内存使用率偏高)
```yaml
- alert: RedisHighMemoryUsage
  expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.7
  for: 10m
  labels:
    severity: info
```

**设计目的**:
- 早期预警 Redis 内存压力（在 >85% 之前）
- 给运维团队足够时间清理缓存或扩容
- Info 级别避免过度打扰

**与 RedisMemoryHigh 的关系**:
- Info: >70% (早期预警)
- Warning: >85% (需要关注)
- 形成两级内存监控

**常见原因**:
- 缓存数据量增长
- 未设置 TTL 的 key 积累
- 大对象缓存（如完整用户画像）

---

## AlertManager 路由优化

### 路由分组调整
**原始配置**: `group_by: ['alertname', 'severity', 'team']`
**优化后**: `group_by: ['severity', 'alertname', 'team']`

**优化效果**:
- 同一级别的告警会被聚合在一起通知
- 减少通知频率（例如 3 个 warning 合并为 1 封邮件）
- 运维人员可按优先级批量处理

### 抑制规则增强 (M-B04 新增)

#### Rule 1: 全局 Critical → Warning 抑制
```yaml
- source_match: { severity: 'critical' }
  target_match: { severity: 'warning' }
  equal: ['instance']
```
**作用**: 当任何 Critical 告警触发时，同实例的所有 Warning 被抑制
**示例**: APIHealthCritical 触发时，抑制同实例的 HighLatencyP95、APIMemoryPressure

#### Rule 2: APIHealthCritical → APIHealthDegraded
```yaml
- source_match: { alertname: 'APIHealthCritical' }
  target_match: { alertname: 'APIHealthDegraded' }
  equal: ['instance', 'job']
```
**作用**: 避免健康分告警的重复通知
**场景**: 健康分从 80 降到 45 时，只收到 Critical 通知

#### Rule 3: APIDown → 所有 API 相关告警
```yaml
- source_match: { alertname: 'APIDown' }
  target_match_re: { alertname: '.*API.*|.*Latency.*|.*Error.*|.*Throughput.*' }
  equal: ['instance']
```
**作用**: API 宕机时，不需要再通知延迟/错误/吞吐量问题
**降噪效果**: 显著减少宕机期间的告警风暴

#### Rule 4: EmailQueueCritical → EmailQueueBacklog
```yaml
- source_match: { alertname: 'EmailQueueCritical' }
  target_match: { alertname: 'EmailQueueBacklog' }
  equal: ['team']
```
**作用**: 队列严重积压时，不再通知普通积压

#### Rule 5: ContainerRestartLoop → Memory/CPU 告警
```yaml
- source_match: { alertname: 'ContainerRestartLoop' }
  target_match_re: { alertname: '.*Memory.*|.*CPU.*' }
  equal: ['instance']
```
**作用**: 容器崩溃循环时，资源压力告警已无意义

---

## 误报 vs 真实告警判断指南

### 🔴 高频误报场景及识别方法

#### 1. 健康分波动 (APIHealthCritical/Degraded)
**误报特征**:
- 健康分在 50-70 之间快速波动
- 无其他指标异常（延迟、错误率正常）
- 通常发生在流量波峰/波谷

**验证步骤**:
```bash
# 查看 Prometheus 健康分趋势
curl 'http://localhost:9090/api/v1/query?query=globalreach_health_score[1h]'

# 检查子组件状态
curl http://localhost:3000/api/v1/health
```

**处置**: 若确认为误报，考虑进一步放宽阈值至 <40

#### 2. CPU/Memory 瞬时峰值 (NodeHighCPU/NodeHighMemory)
**误报特征**:
- 仅持续 5-10 分钟后自动恢复
- 无对应业务事件（非大促、非批处理）
- 单实例触发，其他实例正常

**验证步骤**:
```bash
# 查看进程级资源使用
docker exec <container> top

# 检查 GC 日志
docker logs <container> 2>&1 | grep GC
```

**处置**: 正常现象，无需干预

#### 3. 延迟偶发尖刺 (HighLatencyP95/APILatencyP50Elevated)
**误报特征**:
- P95/P99 偶发超过阈值，P50 正常
- 仅特定端点触发（如报表导出）
- 无用户投诉

**验证步骤**:
```bash
# 分析慢请求分布
curl 'http://localhost:9090/api/v1/query_range' \
  --data-urlencode 'query=topk(5, rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m]))' \
  --data-urlencode 'start=<1h_ago>' \
  --data-urlencode 'end=now' \
  --data-urlencode 'step=300'
```

**处置**: 对慢端点进行单独优化，或添加端点级别的白名单

#### 4. 邮件队列自然积压 (EmailQueueBacklog)
**误报特征**:
- 发生在大促或定时任务期间
- 处理速度正常（消费速率 > 生产速率）
- 无 failed 队列增长

**验证步骤**:
```bash
# 查看队列处理速率
curl 'http://localhost:9090/api/v1/query?query=rate(globalreach_emails_total{status="success"}[5m])'

# 检查 SendWorker 状态
docker ps | grep sendworker
```

**处置**: 临时调高阈值或添加维护窗口静默

### ✅ 真实告警的特征

#### 必须立即处理的 Critical 告警
1. **APIDown** + 持续 >10min + 无法 SSH 登录
   - 可能原因: 容器崩溃、资源耗尽、网络隔离
   
2. **ContainerRestartLoop** + 1小时重启 >10次
   - 可能原因: OOM、配置错误、依赖服务不可用
   
3. **EmailQueueCritical** + 持续增长 + SendWorker 异常
   - 可能原因: SMTP 服务商封禁、数据库锁死

4. **HighErrorRate** + 5xx 错误占比 >80%
   - 可能原因: 数据库连接失败、第三方 API 超时

#### 需要关注的 Warning 告警
1. **多实例同时触发**同一告警（排除部署批次）
2. **告警自愈后又反复触发**（间隔 <30min）
3. **伴随其他指标异常**（如延迟↑ + 错误率↑ + 吞吐量↓）
4. **业务时间触发**（工作日 9:00-18:00 外的异常更可疑）

---

## 告警升级策略

### Severity 层级定义

| Level | 响应时间 | 通知渠道 | 示例 |
|-------|----------|----------|------|
| **critical** | 立即 (<5min) | 邮件 + Webhook | APIDown, EmailQueueCritical |
| **warning** | 30min 内 | 邮件聚合 | HighLatencyP95, PostgresConnectionHigh |
| **info** | 下个工作日 | 邮件摘要 | NoActiveCampaigns, RedisHighMemoryUsage |

### 自动升级条件 (Warning → Critical)

以下条件满足时，Warning 告警应被视为 Critical 处理:

1. **持续时间超过 2 倍 for 时间**
   - 例: HighLatencyP95 (for: 15m) 持续 >30min

2. **指标持续恶化**
   - 例: P95 延迟从 3s 升至 5s+

3. **影响范围扩大**
   - 例: 单实例 → 多实例触发

4. **业务影响确认**
   - 例: 收到用户投诉或监控系统检测到用户体验下降

### 手动升级流程

当收到 Warning 告警且符合升级条件时:

1. **评估影响范围**
   ```bash
   # 检查受影响实例数量
   curl 'http://localhost:9090/api/v1/alerts' | jq '.data.alerts[] | select(.labels.alertname=="<ALERT_NAME>") | .labels.instance'
   ```

2. **查看趋势图**
   - Grafana Dashboard: http://localhost:3000/d/globalreach-overview
   - 关注最近 1h 和 6h 的趋势

3. **决定升级**
   - 若符合上述任一升级条件，立即按 Critical 流程处理
   - 记录升级原因到值班日志

4. **通知升级**
   - 创建 AlertManager Silence (若需维护)
   - 或发送紧急通知到团队群组

---

## 告警值班 SOP

### 值班职责

#### Primary On-Call (主要值班人)
- **响应时间**: Critical <5min, Warning <30min
- **职责**:
  - 监控 AlertManager 通知（邮件 + Webhook）
  - 初步诊断并记录到值班日志
  - Critical 告警需立即通知 Secondary

#### Secondary On-Call (备选值班人)
- **响应时间**: Primary 无应答 15min 后接手
- **职责**:
  - 支持 Primary 进行复杂故障排查
  - Primary 休息时代为值守

### 标准处理流程

#### Step 1: 接收告警 (0-2 min)
```
✅ 检查邮件/Slack 通知
✅ 记录告警信息到日志:
   - 告警名称、级别、实例
   - 触发时间、当前值
   - 关联告警（同实例的其他告警）
```

#### Step 2: 初步诊断 (2-10 min)
```bash
# 1. 检查服务状态
docker ps -a | grep globalreach

# 2. 查看近期日志
docker logs --since 10m <container> 2>&1 | tail -100

# 3. 检查资源使用
docker stats --no-stream

# 4. 验证 Prometheus 指标
curl 'http://localhost:9090/api/v1/query?query=<expr>'
```

#### Step 3: 分类处置 (10-30 min)

**类别 A: 可自动恢复 (无需干预)**
- CPU/Memory 瞬时峰值
- 延迟偶发尖刺
- 队列暂时性积压

**操作**: 记录到日志，继续监控 30min

**类别 B: 需要人工处理 (Warning 级别)**
- PostgreSQL 连接数持续高位
- Redis 内存使用率 >85%
- 磁盘空间 <15%

**操作**:
1. 按照 runbook 执行标准操作
2. 若 30min 内未恢复，考虑升级为 Critical

**类别 C: 紧急处理 (Critical 级别)**
- API 完全宕机
- 容器崩溃循环
- 队列严重积压 (>8000)

**操作**:
1. 立即通知 Secondary 和 Team Lead
2. 启动事故响应流程 (Incident Response)
3. 创建 War Room (如果需要)

#### Step 4: 恢复验证 (30-60 min)
```bash
# 1. 确认告警已 resolved
curl 'http://localhost:9093/api/v2/alerts/groups' | jq '.[] | select(.labels.status=="resolved")'

# 2. 验证业务功能
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/campaigns/active

# 3. 检查后续 15min 是否再次触发
```

#### Step 5: 事后复盘 (24-48 h)
- 编写事故报告 (Incident Report)
- 更新 runbook (如有新发现)
- 提交 PR 修复根因 (Root Cause)
- 若为误报，提交阈值调整建议

### 值班日志模板

```markdown
## 值班日志 - YYYY-MM-DD

### 告警记录

#### #001 - [HH:MM] APIDown (critical)
- **实例**: api:3000
- **触发值**: up == 0
- **持续时间**: 15min
- **初步诊断**: 容器 OOM 重启
- **处置措施**: 增加 memory limit 至 2Gi
- **恢复时间**: [HH:MM]
- **根因分析**: 批量导入任务导致内存飙升
- **后续行动**: [ ] 优化批量任务内存使用
              [ ] 添加任务队列限流

### 统计
- 总告警数: X
- Critical: X
- Warning: X
- Info: X
- 误报数: X
- 平均响应时间: X min
```

---

## 维护窗口静默配置

### 使用场景
- 计划内维护（版本发布、配置变更）
- 压力测试、容量规划
- 基础设施升级（网络、存储）

### 创建 Silence 方法

#### 方法 1: Web UI (推荐)
1. 访问 AlertManager: http://localhost:9093
2. 点击 "New Silence"
3. 配置匹配条件:
   ```
   Matchers:
     - instance = "api:3000"
     - severity =~ "warning|critical"
   ```
4. 设置时间范围:
   ```
   Start: 2026-06-10T02:00:00+08:00
   End: 2026-06-10T04:00:00+08:00
   Comment: "v2.1.0 版本发布"
   ```
5. 点击 "Create Silence"

#### 方法 2: API (自动化)
```bash
curl -X POST 'http://localhost:9093/api/v2/silences' \
  -H 'Content-Type: application/json' \
  -d '{
    "matchers": [
      {
        "name": "instance",
        "value": "api:3000",
        "isRegex": false
      },
      {
        "name": "severity",
        "value": "warning|critical",
        "isRegex": true
      }
    ],
    "startsAt": "2026-06-10T02:00:00+08:00",
    "endsAt": "2026-06-10T04:00:00+08:00",
    "createdBy": "oncall-team",
    "comment": "Scheduled maintenance: v2.1.0 release"
  }'
```

#### 方法 3: amtool (命令行)
```bash
amtool silence add \
  --author="oncall-team" \
  --start="2026-06-10T02:00:00+08:00" \
  --end="2026-06-10T04:00:00+08:00" \
  --comment="Scheduled maintenance" \
  instance="api:3000" \
  severity=~"warning|critical"
```

### 最佳实践

1. **提前创建**: 维护开始前 15min 创建 Silence
2. **精确匹配**: 只静默受影响的实例/告警类型
3. **设置过期**: 即使忘记删除，Silence 也会自动失效
4. **记录原因**: comment 字段必须填写，便于审计
5. **事后清理**: 维护结束后手动删除 Silence（可选）

### 常用 Silence 模板

#### 发布部署
```yaml
Matchers:
  - instance: "api:3000"
  - alertname: "~.*"
Duration: 30min
Comment: "Deploying v2.1.0"
```

#### 数据库维护
```yaml
Matchers:
  - team: "database"
  - severity: "warning"
Duration: 2h
Comment: "PostgreSQL vacuum full"
```

#### 压力测试
```yaml
Matchers:
  - alertname: "HighLatencyP95|NodeHighCPU|NodeHighMemory"
Duration: 4h
Comment: "Load testing for Black Friday preparation"
```

---

## 附录

### A. 相关文档链接
- Prometheus 官方告警文档: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
- AlertManager 配置参考: https://prometheus.io/docs/alerting/latest/configuration/
- GlobalReach Runbook 索引: https://docs.globalreach.com/runbooks/

### B. 快速参考卡片

#### 常用 Prometheus 查询
```bash
# 当前 firing 告警
curl 'http://localhost:9090/api/v1/rules' | jq '.data.groups[].rules[] | select(.state=="firing")'

# 告警趋势（过去1小时）
curl 'http://localhost:9093/api/v2/alerts/groups'

# 抑制规则生效情况
curl 'http://localhost:9093/api/v2/status' | jq '.data.inhibitionRules'
```

#### 常用 Docker 命令
```bash
# 重启 AlertManager 使配置生效
docker restart globalreach-alertmanager

# 验证配置语法
docker exec globalreach-alertmanager amtool config check /etc/alertmanager/alertmanager.yml

# 查看 AlertManager 日志
docker logs -f globalreach-alertmanager --tail 100
```

### C. 版本历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| v1.0 | 2026-06-09 | 初始版本，M-B04 精细化调优 | Auto-Executor |

---

**文档维护**: 此文档应在每次告警规则变更后同步更新
**反馈渠道**: 如有疑问或建议，请提交 Issue 或联系值班团队
