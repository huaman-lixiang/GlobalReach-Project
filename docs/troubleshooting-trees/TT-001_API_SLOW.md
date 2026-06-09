# TT-001 API 响应慢决策树

> **文档版本**: v1.0
> **适用场景**: 用户报告 GlobalReach API 响应变慢
> **预估排查时间**: 5-30 分钟 (简单场景) / 30-120 分钟 (复杂场景)
> **关联 Runbook**: [RB-001 API 服务运行手册](../runbooks/RB-001_API_SERVICE.md)

---

## 决策树总览

```
[开始: 用户/API 客户端报告 API 响应慢]
│  预估时间: 0 min
│
├─ Step 1: 健康检查端点返回什么? (curl -sf http://localhost:3000/api/v1/health)
│  │  命令: curl -sf http://localhost:3000/api/v1/health | jq .
│  │  预估: 1 min
│  │
│  ├─ ❌ 连接被拒 / 超时 ──────────────→ [分支 D: 服务不可达] (见下方)
│  ├─ ⚠️ 502 Bad Gateway ────────────────→ [分支 B: 上游代理层问题]
│  ├─ ⚠️ 503 Service Unavailable ───────→ [分支 C: 依赖服务不可用]
│  ├─ ⚠️ 504 Gateway Timeout ───────────→ [分支 C+: 上游超时]
│  └─ ✅ 200 OK 但 latency 高 ──────────→ [分支 A: 应用层慢] ↓ 继续
│
├─ Step 2: 区分是全局慢还是特定端点慢?
│  │  命令:
│  │    # 查看 P50/P95 延迟趋势
│  │    curl -s 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,
│  │      rate(http_request_duration_seconds_bucket[5m]))' | jq '.data.result[0].value[1]'
│  │
│  │    # 按 path 分组的延迟 Top 10
│  │    curl -s 'http://localhost:9090/api/v1/query?query=topk(10,
│  │      histogram_quantile(0.95, sum by(path)(rate(http_request_duration_seconds_bucket[5m]))))'
│  │  预估: 2 min
│  │
│  ├─ 全局所有端点都慢 ───────────────→ [分支 A1: 系统/基础设施层] ↓
│  └─ 仅特定端点慢 ──────────────────→ [分支 A2: 应用逻辑层] ↓
│
├─ [分支 A1: 全局慢 — 系统层面]
│  │
│  ├─ Step 3: 检查容器资源使用
│  │  │  命令: docker stats --no-stream globalreach-api-prod --format "{{.MemUsage}} {{.MemPerc}} {{.CPUPerc}}"
│  │  │  预估: 1 min
│  │  │
│  │  ├─ CPU > 80% ──────────────────→ [FM-CAL-001 CPU 过载]
│  │  │   │  排查方向: 其他容器争抢? 当前流量突增? Gzip/模板消耗?
│  │  │   │  操作: docker stats 看全局; 检查是否有后台任务占 CPU
│  │  │   │  额外: 2-5 min
│  │  │   └─→ RB-001 场景 6 + FM-CAL-001
│  │  │
│  │  ├─ 内存 RSS > 80% (400MB+) ─────→ [FM-CAL-002/FM-APP-004 内存压力]
│  │  │   │  排查方向: 内存泄漏? V8 堆碎片? 缓存膨胀?
│  │  │   │  命令:
│  │  │   │    # V8 Heap 详情
│  │  │   │    docker exec globalreach-api-prod node -e "
│  │  │   │      const v8 = require('v8');
│  │  │   │      const h = v8.getHeapStatistics();
│  │  │   │      console.log('used:', (h.used_heap_size/1024/1024).toFixed(1), 'MB',
│  │  │   │        'total:', (h.total_heap_size/1024/1024).toFixed(1), 'MB',
│  │  │   │        'limit:', (h.heap_size_limit/1024/1024).toFixed(1), 'MB');"
│  │  │   │  额外: 3-5 min
│  │  │   └─→ RB-001 场景 5 + TT-003 + FM-APP-004
│  │  │
│  │  └─ 资源正常 (< 50% CPU, < 70% MEM) ─→ Step 4 ↓
│  │
│  ├─ Step 4: 检查下游依赖 (DB / Redis)
│  │  │  命令:
│  │  │    # PG 响应测试
│  │  │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
│  │  │      -c "SELECT now(), count(*) FROM users;" 2>&1
│  │  │    # Redis 响应测试
│  │  │    docker exec globalreach-redis redis-cli --latency-history -i 1 -c 3
│  │  │  预估: 2 min
│  │  │
│  │  ├─ DB 查询慢 (>500ms) ───────────→ [FM-STO-002 IO瓶颈 / FM-APP-001 连接池 / FM-APP-005 死锁]
│  │  │   │  命令: 见 RB-002 慢查询 SQL
│  │  │   │  额外: 5-15 min
│  │  │   └─→ RB-002 场景 4 + FM-APP-005 + FM-STO-002
│  │  │
│  │  ├─ Redis 慢 (>10ms P99) ─────────→ [FM-APP-002 Redis超时 / FM-APP-006 缓存雪崩]
│  │  │   │  命令: docker exec globalreach-redis redis-cli SLOWLOG GET 10
│  │  │   │  额外: 3-10 min
│  │  │   └─→ RB-003 场景 3 + FM-APP-002
│  │  │
│  │  └─ DB 和 Redis 都正常 ──────────→ Step 5 ↓
│  │
│  └─ Step 5: 检查外部调用和网络
│     │  命令:
│     │    # 检查 SMTP provider 延迟 (如果有发送操作)
│     │    docker logs --since=5m api 2>&1 | grep -iE "(smtp|send.*duration|timeout)" | tail -10
│     │    # 检查 Nginx → API 的 proxy 延迟
│     │    docker exec globalreach-nginx-prod cat /var/log/nginx/api_access.log | \
│     │      awk '{print $NF}' | sort -n | tail -5
│     │  预估: 3 min
│     │
│     ├─ 外部调用慢 ──────────────────→ 对应的外部依赖 FM 条目
│     │   └─→ RB-007 (如果是邮件) / FM-EXT-001
│     │
│     └─ 一切正常但仍慢 ─────────────→ [罕见: GC Pause / Node.js Event Loop 阻塞]
│        │  命令: 检查 GC 日志频率; 检查是否有同步阻塞操作
│        │  额外: 10-30 min
│        └─→ RB-001 场景 6 (深度分析)
│
├─ [分支 A2: 特定端点慢 — 应用逻辑层]
│  │
│  ├─ Step 6: 定位慢端点及其特征
│  │  │  命令:
│  │  │    # 按 path 分组延迟排序
│  │  │    (Prometheus Query UI 或 curl)
│  │  │  预估: 2 min
│  │  │
│  │  ├─ POST /api/v1/campaigns ──────→ 涉及 DB 写入 + 队列入队 → 检查 DB + Redis
│  │  ├─ GET /api/v1/emails (列表) ────→ 大表查询 → 检查分页/索引
│  │  ├─ POST /api/v1/auth/login ────→ 密码哈希比较 + JWT 签发 → 通常不应慢
│  │  ├─ 文件上传端点 ───────────────→ body parsing + 存储 I/O → 检查 body size
│  │  └─ 其他端点 ───────────────────→ 分析该端点的具体逻辑链路
│  │
│  └─ 通用排查: 查看该端点的最近错误日志
│     │  命令: docker logs --since=15m api 2>&1 | grep -i "<端点路径>" | tail -20
│     └─→ RB-001 对应场景 + RB-002/RB-003
│
├─ [分支 B: 502 Bad Gateway — Nginx → API 不通]
│  │  预估: 5-15 min
│  │
│  ├─ Step B1: API 容器是否运行?
│  │  │  命令: docker ps | grep globalreach-api-prod
│  │  │
│  │  ├─ ❌ 未运行 / Restarting ──────→ [FM-CAL-003 进程崩溃] → TT-004
│  │  └─ ✅ 运行中 ─────────────────→ Step B2 ↓
│  │
│  └─ Step B2: 从 Nginx 内部测试连通性
│     │  命令: docker exec globalreach-nginx-prod wget -qO- http://globalreach-api-prod:3000/api/v1/health
│     │
│     ├─ ❌ 连接失败 ────────────────→ [FM-NET-004 端口冲突 / 网络不通] → RB-004 场景 1
│     └─ ✅ 但仍 502 ───────────────→ Nginx 配置问题 (upstream 名字/超时) → RB-004
│
├─ [分支 C: 503 Service Unavailable — 依赖不可用]
│  │  预估: 5-20 min
│  │
│  ├─ Step C1: 深度健康检查各子系统
│  │  │  命令: curl -sf http://localhost:3000/api/v1/health/ready | jq .
│  │  │
│  │  ├─ database: disconnected ────→ [FM-APP-001 DB连接池] → RB-001 场景 3 + RB-002
│  │  ├─ redis: disconnected ───────→ [FM-APP-002 Redis超时] → RB-001 场景 4 + RB-003
│  │  ├─ engine: offline ───────────→ M7/M8 引擎初始化失败 → RB-001
│  │  └─ email_queue: error ─────────→ [FM-APP-003 队列堵塞] → RB-007
│  │
│  └─ Step C2: 逐个恢复依赖服务后重启 API
│     └─→ 对应 Runbook + RB-001 场景 2
│
├─ [分支 D: 服务完全不可达]
│  │  预估: 5-15 min
│  │
│  ├─ Step D1: 容器状态检查
│  │  │  命令: docker ps -a | grep globalreach-api-prod
│  │  │
│  │  ├─ Exit 状态非 0 ─────────────→ 查看日志定位原因 → TT-004
│  │  ├─ 状态 Created (未启动) ────→ docker compose up -d api
│  │  └─ 状态 Up 但端口不通 ───────→ [FM-NET-004 端口冲突] → netstat 检查
│  │
│  └─ Step D2: 如果容器在 CrashLoop
│     └─→ [TT-004 容器崩溃循环决策树](TT-004_CONTAINER_CRASH_LOOP.md)
```

---

## 叶子节点索引 (→ 指向的资源)

| 叶子节点 | 指向 | 额外时间 |
|---------|------|---------|
| FM-CAL-001 CPU 过载 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-cal-001-cpu-过载) | 2-5 min |
| FM-CAL-002/FM-APP-004 内存压力 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-cal-002oomkilled-内存不足被杀) + [TT-003](TT-003_HIGH_MEMORY_USAGE.md) | 3-10 min |
| FM-APP-001 DB 连接池 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-app-001数据库连接池耗尽) + [RB-002](../runbooks/RB-002_POSTGRES.md) | 5-15 min |
| FM-APP-002 Redis 超时 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-app-002redis-连接超时) + [RB-003](../runbooks/RB-003_REDIS.md) | 3-10 min |
| FM-APP-005 死锁 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-app-005数据库死锁) + [RB-002](../runbooks/RB-002_POSTGRES.md) | 5-15 min |
| FM-APP-006 缓存雪崩 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-app-006缓存雪崩) | 15-60 min |
| FM-EXT-001 SMTP 问题 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-ext-001smtp-提供商宕机限流) + [RB-007](../runbooks/RB-007_EMAIL_PIPELINE.md) | 10-30 min |
| FM-CAL-003 崩溃 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-cal-003进程崩溃非-oom) + [TT-004](TT-004_CONTAINER_CRASH_LOOP.md) | 10-60 min |
| FM-NET-004 端口冲突 | [FMB 条目](../failure-modes/FailureModeBase.md#fm-net-004端口冲突) + [RB-006](../runbooks/RB-006_DOCKER.md) | 5-20 min |

---

## 最佳实践

1. **始终从健康检查开始** — 30 秒内确定问题是"服务挂了"还是"服务慢了"
2. **PromQL 优先** — 用 Prometheus 数据定位比翻日志快得多
3. **自顶向下** — 先排除基础设施 (CPU/内存/网络)，再深入应用层
4. **并行诊断** — 同时检查 DB 和 Redis，不要串行等
5. **记录根因** — 每次排查后将发现更新到 FMB，积累团队知识
