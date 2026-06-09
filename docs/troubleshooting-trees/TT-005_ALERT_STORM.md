# TT-005 告警风暴处理决策树

> **文档版本**: v1.0
> **适用场景**: 短时间内收到大量告警通知 (Alert Storm)，信息过载
> **预估排查时间**: 5-30 分钟 (止血) + 30-120 分钟 (根因修复)
> **关联 Runbook**: [RB-005 监控栈运行手册](../runbooks/RB-005_MONITORING_STACK.md) 场景 5
> **关联文档**: [docs/AIOPS_ALERT_DEDUPPLICATION.md](../../docs/AIOPS_ALERT_DEDUPPLICATION.md)

---

## 决策树总览

```
[开始: 收到大量告警通知 (Email + Webhook), 无法逐一处理]
│  典型症状: 5 分钟内收到 > 20 条告警; 手机/邮箱被刷屏
│
├─ ═══════════════════════════════════════════
│  PHASE 1: 止损 (0-5 分钟) — 第一优先级!
│  ═══════════════════════════════════════════
│
├─ Step 1: 创建全局静默 (立即!)
│  │  方法 A: AlertManager Web UI (推荐)
│  │    → 打开 http://localhost:9093/#/silences
│  │    → New Silence → matchers 留空 (匹配所有) → Duration: 30min → Comment: "Storm 止损"
│  │
│  │  方法 B: API (脚本化)
│  │    curl -s -X POST http://localhost:9093/api/v2/silences \
│  │      -H 'Content-Type: application/json' -d '{
│  │        "matchers": [],
│  │        "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
│  │        "endsAt": "'$(date -u -d '+30 minutes' +%Y-%m-%dT%H:%M:%SZ)'",
│  │        "createdBy": "oncall-dutty",
│  │        "comment": "ALERT STORM 止损 - 全局静默 30 分钟"
│  │      }'
│  │
│  │  ✅ 效果: 所有新告警不再发送通知 (但仍记录在 AlertManager 中)
│  │  预估: 1-2 min
│  │
├─ Step 2: 快速评估风暴规模
│  │  命令:
│  │    # 当前 firing 告警数
│  │    curl -sf http://localhost:9093/api/v2/alerts | jq '[.[] | select(.status.state=="firing")] | length'
│  │
│  │    # 按严重度分组
│  │    curl -sf http://localhost:9093/api/v2/alerts | jq '[.[] | select(.status.state=="firing")] | group_by(.labels.severity) | map({severity: .[0].labels.severity, count: length})'
│  │
│  │    # 按告警名分组 (Top 10)
│  │    curl -sf http://localhost:9093/api/v2/alerts | jq '[.[] | select(.status.state=="firing")] | group_by(.labels.alertname) | map({alert: .[0].labels.alertname, count: length}) | sort_by(-.count) | .[:10]'
│  │
│  │    # 按实例分组 (Top 5)
│  │    curl -sf http://localhost:9093/api/v2/alerts | jq '[.[] | select(.status.state=="firing")] | group_by(.labels.instance) | map({instance: .[0].labels.instance, count: length}) | sort_by(-.count) | .[:5]'
│  │  预估: 2 min
│  │
│  ═══════════════════════════════════════════
│  PHASE 2: 根因定位 (5-20 分钟)
│  ═══════════════════════════════════════════
│
├─ Step 3: 识别根因告警 (Root Cause Alert)
│  │
│  │  告警风暴通常遵循以下模式之一:
│  │
│  │  ┌─ 模式 1: 单点故障引发连锁反应 ─────────────────────┐
│  │  │                                                     │
│  │  │  特征: 一个 instance/alertname 占绝大多数             │
│  │  │  典型场景:                                           │
│  │  │    • APIDown → 抑制所有 API 相关告警                  │
│  │  │    • ContainerRestartLoop → 抑制 Memory/CPU 告警      │
│  │  │    • NodeFileSystemFull → 所有写磁盘的服务告警        │
│  │  │                                                     │
│  │  │  判断方法: Top 1 alertname 或 instance 占 > 50%       │
│  │  │  处理: 先修复根因告警, 其余会自动恢复                  │
│  │  │  预估 MTTR: 取决于根因                                │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  │  ┌─ 模式 2: 区域性故障 ────────────────────────────────┐
│  │  │                                                     │
│  │  │  特征: 多个不同组件同时告警, 但集中在同一类资源        │
│  │  │  典型场景:                                           │
│  │  │    • 宿主机 CPU 100% → 所有容器 CPU 告警               │
│  │  │    • 宿主机内存 OOM → 多个容器 OOM                    │
│  │  │    • 网络中断 → 所有 target DOWN                     │
│  │  │                                                     │
│  │  │  判断方法: 不同 alertname 但相同 instance/host        │
│  │  │  处理: 解决基础设施层问题                             │
│  │  │  → FM-CAL-001 / FM-STO-001 / FM-NET-001             │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  │  ┌─ 模式 3: 真正的多点故障 (罕见) ─────────────────────┐
│  │  │                                                     │
│  │  │  特征: 多个独立组件各自独立故障                        │
│  │  │  典型场景: 同时变更导致多个服务出问题                   │
│  │  │                                                     │
│  │  │  判断方法: 各告警之间无明显的抑制/因果关系            │
│  │  │  处理: 并行处理各故障点                               │
│  │  │  预估 MTTR: 较长 (需多人协作)                         │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  根据 Step 2 的统计结果判断属于哪种模式 ↓
│
├─ Step 4: 按模式选择处理策略
│  │
│  ├─ [模式 1: 单点故障连锁] ─────────────────────────↓
│  │  │
│  │  │  4a. 定位根因告警 (通常是第一个触发的 Critical)
│  │  │  4b. 对照以下映射找到对应 Runbook/决策树:
│  │  │
│  │  │  根因告警 → 对应资源:
│  │  │  ├── APIDown → TT-001 (API 慢/不可达) 或 TT-004 (崩溃循环)
│  │  │  ├── HighErrorRate → TT-001 分支 A (应用层错误)
│  │  │  ├── ContainerRestartLoop → TT-004 (崩溃循环)
│  │  │  ├── PostgresConnectionHigh → RB-002 (DB 连接池)
│  │  │  ├── RedisMemoryHigh → RB-003 (Redis 内存)
│  │  │  ├── NodeFileSystemFull → RB-006 + FM-STO-001
│  │  │  ├── NodeHighMemory → TT-003 (主机内存)
│  │  │  └── NodeHighCPU → RB-006 + FM-CAL-001
│  │  │
│  │  │  4c. 修复根因后, 其余告警应自动 resolve
│  │  │
│  │  └─ 额外时间: 取决于根因 (参考对应 Runbook 的 MTTR)
│  │
│  ├─ [模式 2: 区域性故障] ─────────────────────────↓
│  │  │
│  │  │  4a. 确认基础设施层问题
│  │  │  │  CPU: `docker stats --no-stream` 看全局 CPU
│  │  │  │  MEM: `free -h` 或 `docker system df -v`
│  │  │  │  NET: `ping 8.8.8.8` + `docker network inspect`
│  │  │  │  DISK: `df -h`
│  │  │
│  │  │  4b. 按瓶颈类型处理
│  │  │  ├── CPU 瓶颈 → 识别高 CPU 容器 → 限制或迁移
│  │  │  ├── 内存瓶颈 → TT-003 或清理/扩容
│  │  │  ├── 磁盘满 → FM-STO-001 清理流程
│  │  │  └── 网络中断 → FM-NET-001/002 排查
│  │  │
│  │  └─ 额外时间: 15-60 min
│  │
│  └─ [模式 3: 多点独立故障] ─────────────────────────↓
│     │
│     │  4a. 按优先级排序 (Critical > Warning)
│     │  4b. 分配多人并行处理 (如有团队可用)
│     │  4c. 每个故障点独立走对应的 Runbook/TT
│     │
│     └─ 额外时间: 30-120 min (取决于故障数量和复杂度)
│
│  ═══════════════════════════════════════════
│  PHASE 3: 恢复与优化 (20-60 分钟)
│  ═══════════════════════════════════════════
│
├─ Step 5: 解除静默 & 验证恢复
│  │  命令:
│  │    # 查看当前静默列表
│  │    curl -sf http://localhost:9093/api/v2/silences | jq '.[] | select(.status.state=="active") | {id, comment}'
│  │
│  │    # 删除静默 (替换 <silence-id>)
│  │    curl -s -X DELETE http://localhost:9093/api/v2/silences/<id>
│  │
│  │    # 或者等它自动过期
│  │
│  │  验证:
│  │    # 确认 firing 告警数降为 0 或接近 0
│  │    curl -sf http://localhost:9093/api/v2/alerts | jq '[.[] | select(.status.state=="firing")] | length'
│  │
│  │    # 确认 resolved 告警收到了 resolved 通知
│  │    检查 Email/Webhook 是否收到 resolved 消息
│  │
├─ Step 6: 风暴复盘与改进 (事后)
│  │
│  │  6a. 记录风暴事件到知识库
│  │  │  时间、规模、根因、MTTR、处理人
│  │  │
│  │  6b. 检查 Inhibition Rules 是否需要补充
│  │  │  当前 inhibition (见 alertmanager.yml):
│  │  │  ✓ Critical 抑制 Warning
│  │  │  ✓ APIDown 抑制所有 API 告警
│  │  │  ✓ ContainerRestartLoop 抑制 Memory/CPU
│  │  │  ✓ EmailQueueCritical 抑制 Backlog
│  │  │  ? 是否还有新的抑制规则可以添加?
│  │  │
│  │  6c. 评估是否需要 AIOps 智能降噪
│  │  │  → 参考 docs/AIOPS_ALERT_DEDUPPLICATION.md
│  │  │  → 告警聚合 / 去重 / 根因分析 / 自愈动作
│  │  │
│  │  6d. 更新 Runbook 和 FMB
│  │
│  └─→ docs/OPERATIONS_KNOWLEDGE_BASE.md (维护流程)
```

---

## 告警风暴常见场景速查

| 场景 | 根因告警 | 连带告警 | 处理路径 | 预估 MTTR |
|------|---------|---------|---------|----------|
| API 挂了 | APIDown | HighErrorRate, Latency*, HealthDegraded*, Throughput* | TT-001 → TT-004 | 10-30 min |
| API 崩溃循环 | ContainerRestartLoop | APIMemoryPressure, APILatency*, HighCPU* | TT-004 → TT-003 | 15-60 min |
| 磁盘满了 | NodeFileSystemFull | PG/Redis/Prometheus/Loki 写入失败 | FM-STO-001 | 15-60 min |
| 主机 OOM | NodeHighMemory | 多个容器 OOMKilled | TT-003 | 15-30 min |
| Redis 挂了 | Redis down (自定义) | API 503, Cache miss 风暴 | RB-003 | 5-15 min |
| PG 挂了 | PG down (自定义) | API 503, 所有 DB 错误 | RB-002 | 5-15 min |
| 网络中断 | 多个 Target DOWN | 全部 API/infra 告警 | FM-NET-001 | 5-30 min |
| 变更事故 | 多种 Critical | 取决于变更范围 | 对应 Runbook | 30-120 min |

*注: 带 * 的告警可能被 Inhibition Rule 抑制
