# RB-001 API 服务运行手册

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **组件**: api-prod (globalreach-api-prod)
> **最后更新**: 2026-06-09

---

## 1. 组件身份卡

| 属性 | 值 |
|------|-----|
| 容器名称 | globalreach-api-prod |
| 镜像 | globalreach-project-api:${IMAGE_TAG:-latest} |
| 技术栈 | Express.js + Node.js (V8), Sequelize ORM |
| Node 版本 | 24 (Dockerfile 指定) |
| 监听端口 | 3000 (容器内部) / ${API_PORT:-3000} (宿主机映射) |
| 内存限制 | 512MB (硬限制) / 256MB (预留) |
| CPU 限制 | 1.0 核 |
| V8 堆上限 | 384MB (--max-old-space-size=384) |
| 健康检查 | `curl -f http://localhost:3000/api/v1/health` (30s间隔, 10s超时, 3次重试) |
| 启动等待期 | 60s (start_period) |
| 日志驱动 | json-file (10MB × 3 个文件轮转) |

### 核心依赖

| 依赖服务 | 用途 | 连接方式 |
|---------|------|---------|
| PostgreSQL 15 (postgres:5432) | 主数据存储 | Sequelize pool (max:10, min:2) |
| Redis 7 (redis:6379) | 缓存/会话/限流计数器 | ioredis/redis client |
| Nginx (反向代理) | TLS 终端 / 流量入口 | upstream proxy_pass |

### 关键子系统

- **M7/M8 引擎**: 邮件账户池管理 + 格式化/故障转移
- **D03 邮件流水线**: EmailQueue → SendWorker → TemplateEngine
- **D15 Prometheus**: 自定义指标采集 (18个自定义指标)
- **M-C04 三层限流**: Nginx L1(50r/s) → Express L2(全局) → L3(端点粒度)

---

## 2. 快速命令参考

| 操作 | 命令 |
|------|------|
| 查看状态 | `docker compose -f docker-compose.prod.yml ps api` |
| 查看日志（实时） | `docker compose -f docker-compose.prod.yml logs -f --tail=100 api` |
| 重启服务 | `docker compose -f docker-compose.prod.yml restart api` |
| 停止服务 | `docker compose -f docker-compose.prod.yml stop api` |
| 启动服务 | `docker compose -f docker-compose.prod.yml up -d api` |
| 进入容器 | `docker exec -it globalreach-api-prod sh` |
| 健康检查 | `curl -sf http://localhost:3000/api/v1/health \| jq .` |
| 深度健康检查 | `curl -sf http://localhost:3000/api/v1/health/ready` |
| 存活探针 | `curl -sf http://localhost:3000/api/v1/health/live` |
| 查看 metrics | `curl -sf http://localhost:3000/api/v1/metrics` |
| 强制 GC | `docker exec globalreach-api-prod node -e "global.gc && console.log('GC done')"` |
| 查看资源使用 | `docker stats globalreach-api-prod --no-stream` |

---

## 3. 架构关系图

```
                    ┌─────────────┐
                    │   Nginx     │ ← TLSv1.3 终端, L1限流(50r/s)
                    │  (443/80)   │
                    └──────┬──────┘
                           │ proxy_pass :3000
                           ▼
┌──────────┐    ┌─────────────────────┐    ┌──────────┐
│PostgreSQL│◄───│   API Service       │◄───│  Redis   │
│  (:5432) │    │   (Express.js :3000)│    │  (:6379) │
└──────────┘    └─────────────────────┘    └──────────┘
      │                   │                        │
      │  Sequelize Pool   │  CacheService          │  会话/限流
      │  (max:10,min:2)   │  (TTL缓存)             │  (计数器)
      ▼                   ▼                        ▼
  业务数据              中间件栈                  缓存层
  (11张表)         [Helmet→CORS→CSRF→           [用户会话]
                    RateLimit→Logger→            [API限流计数]
                    Compression→Routes]          [邮件队列状态]

API 内部流水线:
Campaign 创建 → EmailQueue 入队 → SendWorker 消费 → TemplateEngine 渲染
→ emailService.send() → SMTP Provider (QQ Mail / Gmail / Outlook / Custom)
```

**中间件执行顺序**（按 server.js 注册顺序）：
1. Helmet (安全头/CSP/HSTS)
2. Gzip/Brotli 压缩
3. i18n 国际化
4. CORS 配置
5. SameSite Cookie 强制
6. Request ID + Trace ID 生成
7. Body Parsing (JSON 10mb limit)
8. XSS 预防 (sanitizeBody)
9. API Version 检测
10. Prometheus 自动埋点
11. 结构化日志记录
12. 全局限流 (L2)
13. 端点粒度限流 (L3)
14. 路由分发
15. CSRF 保护
16. 错误处理 (404 → errorHandler)

---

## 4. 健康检查清单

- [ ] **容器运行状态**: `docker ps \| grep globalreach-api-prod` — 状态应为 Up
- [ ] **HTTP 健康端点**: `curl -sf http://localhost:3000/api/v1/health` — 返回 200 + JSON
- [ ] **就绪探针**: `curl -sf http://localhost:3000/api/v1/health/ready` — DB/Redis/引擎均 OK
- [ ] **存活探针**: `curl -sf http://localhost:3000/api/v1/health/live` — 进程存活
- [ ] **数据库连接**: health JSON 中 `database: "connected"`
- [ ] **Redis 连接**: health JSON 中 Redis 子系统状态正常
- [ ] **内存使用**: RSS < 409MB (80% of 512MB limit)
- [ ] **错误率**: 5xx 错误率 < 1% (5分钟窗口)
- [ ] **P95 延迟**: < 3秒 (5分钟窗口)
- [ ] **邮件队列积压**: pending jobs < 100 (正常业务量下)
- [ ] **根端点可访问**: `curl -sf http://localhost:3000/` — 返回 service info JSON
- [ ] **Metrics 端点**: `curl -sf http://localhost:3000/api/v1/metrics` — 返回 Prometheus 格式

---

## 5. 故障排查场景

### 场景 1: API 返回 502 Bad Gateway

**症状**: 通过 Nginx 访问 API 时返回 502，直接访问 localhost:3000 正常或不可达

**可能原因**:
1. API 容器未启动或崩溃重启中
2. API 容器内进程未监听 3000 端口
3. Docker 网络 globalreach-network 不通
4. Nginx 的 upstream 名称不匹配

**诊断步骤**:
```bash
# 1. 检查容器状态
docker ps -a | grep globalreach-api-prod

# 2. 查看容器最近日志（关注 crash/error）
docker logs --tail=50 globalreach-api-prod

# 3. 从 nginx 容器内测试连通性
docker exec globalreach-nginx-prod wget -qO- http://globalreach-api-prod:3000/api/v1/health

# 4. 检查 Docker 网络
docker network inspect globalreach-project_globalreach-network | grep -A5 globalreach-api

# 5. 检查端口绑定
docker port globalreach-api-prod
```

**解决方案**:
- 容器未运行 → `docker compose -f docker-compose.prod.yml up -d api`
- 容器崩溃循环 → 见 TT-004 决策树
- 网络问题 → `docker network prune` 后重建（谨慎操作）
- 进程未监听 → 检查启动日志中的端口绑定错误

**预防措施**: 确保 healthcheck 配置正确，设置合理的 restart policy (`unless-stopped`)

---

### 场景 2: API 返回 503 Service Unavailable

**症状**: API 可达但返回 503，通常伴随上游依赖不可用

**可能原因**:
1. 数据库连接池耗尽
2. Redis 连接断开
3. M7/M8 引擎初始化失败
4. 启动阶段尚未完成 (start_period 60s 内)

**诊断步骤**:
```bash
# 1. 深度健康检查（查看各子系统状态）
curl -sf http://localhost:3000/api/v1/health/ready | jq .

# 2. 检查 DB 连接
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod

# 3. 检查 Redis 连接
docker exec globalreach-redis redis-cli ping

# 4. 查看 API 日志中的连接错误
docker logs --tail=100 globalreach-api-prod 2>&1 | grep -iE "(ECONNREFUSED|timeout|pool|connect)"

# 5. 检查 PG 活跃连接数
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "SELECT count(*) FROM pg_stat_activity;"
```

**解决方案**:
- DB 不可用 → 先恢复 PostgreSQL (RB-002)，再重启 API
- Redis 不可用 → 先恢复 Redis (RB-003)，API 可降级运行（无缓存模式）
- 连接池耗尽 → 增大 `DB_POOL_MAX` 或排查慢查询导致连接泄漏
- 引擎失败 → 检查 accountService 初始化日志，API 在 DB-only 模式下仍可运行

**预防措施**: 设置合理的连接池参数，配置依赖服务的 healthcheck

---

### 场景 3: 数据库连接失败

**症状**: API 日志大量出现 `ECONNREFUSED` / `connection refused` / `SequelizeConnectionError`

**可能原因**:
1. PostgreSQL 容器未启动或正在重启
2. 数据库凭据错误 (.env 中的 DB_PASSWORD 变更)
3. 网络隔离导致容器间不通
4. PG 达到 max_connections 上限
5. 连接池配置不合理 (acquire timeout 过短)

**诊断步骤**:
```bash
# 1. 验证 PG 容器状态和健康检查
docker ps | grep globalreach-postgres
docker inspect --format='{{.State.Health.Status}}' globalreach-postgres

# 2. 从 API 容器测试 PG 连通性
docker exec globalreach-api-prod wget -qO- postgres:5432 || echo "PG unreachable"

# 3. 检查 PG 连接数
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"

# 4. 检查 PG max_connections 设置
docker exec globalreach-postgres psql -U globalreach_user -c "SHOW max_connections;"

# 5. 验证环境变量
docker exec globalreach-api-prod env | grep -E "(DB_|DATABASE_URL)"
```

**解决方案**:
- PG 未启动 → 启动 postgres 服务后 API 会自动重连（Sequelize 有重试机制）
- 凭据错误 → 更正 .env 中的密码，重启 API 容器
- 连接数满 → 排查是否有连接泄漏（长事务、未释放的连接），必要时增大 PG max_connections
- 网络问题 → 检查两个容器是否在同一 Docker network 中

**预防措施**: 定期监控 `pg_stat_activity_count` (告警阈值 >80)，合理设置连接池大小

---

### 场景 4: Redis 连接超时

**症状**: API 响应变慢，日志中出现 Redis 超时警告，缓存命中率下降

**可能原因**:
1. Redis 容器 OOM 或被 kill
2. Redis 执行耗时命令 (KEYS *, FLUSHDB 等)
3. 网络延迟/丢包
4. Redis 内存达到 maxmemory 触发驱逐
5. 单线程阻塞 (big key 操作)

**诊断步骤**:
```bash
# 1. 检查 Redis 容器状态和资源使用
docker stats --no-stream globalreach-redis

# 2. 测试 Redis 响应延迟
docker exec globalreach-redis redis-cli --latency-history -i 1

# 3. 检查 Redis 内存使用
docker exec globalreach-redis redis-cli INFO memory | grep -E "(used_memory_human|maxmemory_human)"

# 4. 检查慢查询日志
docker exec globalreach-redis redis-cli SLOWLOG GET 10

# 5. 检查连接数
docker exec globalreach-redis redis-cli INFO clients

# 6. 查看 API 日志中的 Redis 相关错误
docker logs --tail=200 globalreach-api-prod 2>&1 | grep -iE "(redis|ioredis|cache)"
```

**解决方案**:
- Redis OOM → 增大容器内存限制或清理不必要的 key
- 大 key 阻塞 → 使用 SCAN 替代 KEYS，拆分 big key
- 内存满 → 检查 eviction policy 和 key TTL 设置
- 网络问题 → 检查 Docker 网络和 DNS 解析

**注意**: API 在 Redis 不可用时可以**降级运行**（无缓存模式），不会完全宕机。

**预防措施**: 设置 Redis 内存告警 (>85%)，禁止在生产使用 KEYS/FLUSHDB

---

### 场景 5: 内存泄漏迹象

**症状**: 容器 RSS 持续增长，最终触发 OOM 或频繁 GC

**可能原因**:
1. 闭包引用未释放的大对象
2. 事件监听器未移除 (EventEmitter leak)
3. 数据库查询结果集过大未流式处理
4. 缓存无限增长 (无 TTL/无上限)
5. V8 堆碎片化

**诊断步骤**:
```bash
# 1. 观察 RSS 趋势 (Prometheus: container_memory_rss)
curl -s 'http://localhost:9090/api/v1/query?query=container_memory_rss{container="globalreach-api-prod"}' | jq '.data.result[0].value[1]'

# 2. 查看容器内存使用趋势
docker stats globalreach-api-prod --no-stream --format "table {{.MemUsage}} {{.MemPerc}}"

# 3. 检查 V8 堆状态 (需要进入容器)
docker exec globalreach-api-prod node -e "
const v8 = require('v8');
const heap = v8.getHeapStatistics();
console.log('Heap Used:', (heap.used_heap_size/1024/1024).toFixed(1), 'MB');
console.log('Heap Total:', (heap.total_heap_size/1024/1024).toFixed(1), 'MB');
console.log('Heap Limit:', (heap.heap_size_limit/1024/1024).toFixed(1), 'MB');
"

# 4. 检查是否有 EventEmitter 警告
docker logs globalreach-api-prod 2>&1 | grep -i "(MaxListenersExceeded|leak)"

# 5. Prometheus 告警: APIMemoryPressure (>80% RSS, 持续15分钟)
```

**解决方案**:
- 短期: 重启 API 容器释放内存
- 中期: 使用 `--expose-gc` + 定期 `global.gc()` (已配置每60秒一次)
- 长期: 排查具体泄漏点，添加 heap snapshot 分析

**预防措施**:
- 已启用定期 GC (60s interval)
- V8 堆上限设为 384MB (75% of container limit)
- Prometheus APIMemoryPressure 告警 (>80% RSS, 15min)

---

### 场景 6: 请求延迟突增

**症状**: P50/P95 延迟突然升高，用户体验明显下降

**可能原因**:
1. 数据库慢查询 (缺失索引 / 全表扫描)
2. Redis 缓存未命中（冷启动或缓存失效风暴）
3. GC 暂停 (Stop-The-World)
4. CPU 资源争抢 (同主机其他容器)
5. 外部 API 调用超时 (SMTP provider)
6. 请求体过大 (接近 10MB 限制)

**诊断步骤**:
```bash
# 1. 检查 Prometheus 延迟指标
# P95 > 3s (HighLatencyP95 告警, 15min)
curl -s 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))' | jq '.data.result[0]'

# P50 > 300ms (APILatencyP50Elevated 告警, 10min)
curl -s 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))' | jq '.data.result[0]'

# 2. 检查慢查询 (需要在 PG 中开启 log_min_duration_statement)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# 3. 检查 Redis 缓存命中率
docker exec globalreach-redis redis-cli INFO stats | grep hitspace

# 4. 检查 CPU 使用情况
docker stats --no-stream globalreach-api-prod --format "{{.CPUPerc}}"

# 5. 检查 GC 事件频率
docker logs --tail=500 globalreach-api-prod 2>&1 | grep -i gc | tail -20
```

**解决方案**:
- DB 慢查询 → 添加索引或优化 SQL (见 RB-002)
- 缓存未命中 → 预热关键缓存或调整 TTL 策略
- GC 暂停 → 减少堆中对象数量，优化数据结构
- CPU 争抢 → 调整容器 CPU shares 或迁移到低负载节点
- 外部调用超时 → 增加超时时间或增加重试/熔断机制

**预防措施**: Prometheus 告警覆盖 P50/P95 延迟，定期审查慢查询

---

### 场景 7: JWT Token 问题

**症状**: 用户认证失败，token 验证报错 (JsonWebTokenError / TokenExpiredError)

**可能原因**:
1. JWT_SECRET 环境变量变更（所有旧 token 失效）
2. Token 时钟偏移（服务器与客户端时间不同步）
3. Token 格式损坏（前端传输截断）
4. Refresh token 泄漏或被盗用
5. JWT_EXPIRES_IN 配置过短

**诊断步骤**:
```bash
# 1. 检查当前 JWT 配置
docker exec globalreach-api-prod env | grep -E "(JWT_SECRET|JWT_EXPIRES)"

# 2. 查看认证相关错误日志
docker logs --tail=200 globalreach-api-prod 2>&1 | grep -iE "(jwt|token|auth|unauthorized|401)"

# 3. 手动验证一个 token (需要进入容器)
docker exec -it globalreach-api-prod sh
# 然后在容器内:
# node -e "const jwt = require('jsonwebtoken'); console.log(jwt.verify('<your_token>', process.env.JWT_SECRET))"

# 4. 检查 refresh_tokens 表是否有异常记录
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT count(*), date_trunc('hour', created_at) as hour
FROM refresh_tokens GROUP BY hour ORDER BY hour DESC LIMIT 12;"
```

**解决方案**:
- Secret 变更 → 通知所有用户重新登录（预期行为）
- 时钟偏移 → 同步服务器 NTP (`ntpdate pool.ntp.org`)
- Token 损坏 → 检查前端 token 存储和传输逻辑
- 泄露 → 吊销可疑的 refresh_token，强制重新登录

**预防措施**: 定期轮换 JWT_SECRET（参考 docs/SECURITY_KEY_ROTATION_POLICY.md），设置合理的过期时间 (默认 24h)

---

### 场景 8: 文件上传失败

**症状**: 用户上传附件/模板时返回 413 Payload Too Large 或 500 错误

**可能原因**:
1. 超过 Nginx 的 `client_max_body_size` (50MB)
2. 超过 Express 的 body parser 限制 (10MB)
3. 磁盘空间不足（临时目录或 volume）
4. 上传超时（大文件在弱网络环境下）

**诊断步骤**:
```bash
# 1. 检查 Nginx body size 限制
grep -r "client_max_body_size" nginx/

# 2. 检查 Express body parser 限制
grep -r "limit.*10mb" api/server.js

# 3. 检查磁盘空间
df -h | grep -E "(Filesystem|/var/lib/docker)"

# 4. 查看 API 日志中的上传错误
docker logs --tail=100 globalreach-api-prod 2>&1 | grep -iE "(upload|payload|entity.*too.*large|413)"

# 5. 检查 Nginx 错误日志
docker logs --tail=30 globalreach-nginx-prod 2>&1 | grep -i "client.*request.*body"
```

**解决方案**:
- 文件过大 → 提示用户压缩文件或分片上传
- 限制不一致 → 统一 Nginx (50MB) 和 Express (10MB) 的限制值
- 磁盘满 → 清理空间或扩容
- 超时 → 增加 Nginx 的 `proxy_read_timeout` 和 `proxy_send_timeout`

**预防措施**: 前端应在上传前校验文件大小并给用户明确提示

---

### 场景 9: 邮件队列堆积

**症状**: Campaign 发送后邮件长时间处于 QUEUED/PENDING 状态，发送进度停滞

**可能原因**:
1. SendWorker 崩溃或停止消费
2. SMTP Provider 限流或不可达
3. 并发数过低 (SEND_CONCURRENCY 默认 5)
4. 队列中存在大量失败重试任务
5. Redis（队列存储）连接异常

**诊断步骤**:
```bash
# 1. 检查 Worker 状态（通过 metrics 端点）
curl -sf http://localhost:3000/api/v1/metrics | grep -i queue

# 2. 查看邮件队列相关日志
docker logs --tail=200 globalreach-api-prod 2>&1 | grep -iE "(queue|worker|send|email.*job|consumer)"

# 3. 检查 SMTP 配置和环境变量
docker exec globalreach-api-prod env | grep -E "(SMTP_|SEND_)"

# 4. 测试 SMTP 连通性（通过 Mailpit）
curl -sf http://localhost:8025/api/messages | jq '.Messages | length'

# 5. 检查 Redis 中的队列 key
docker exec globalreach-redis redis-cli KEYS "*queue*" 2>/dev/null || echo "Use SCAN instead"
docker exec globalreach-redis redis-cli SCAN 0 MATCH "*queue*" COUNT 10
```

**解决方案**:
- Worker 停止 → 重启 API 容器（Worker 随 API 启动）
- SMTP 限流 → 降低 SEND_RATE_LIMIT 或切换 Provider
- 并发不足 → 增大 SEND_CONCURRENCY（注意不要超过 Provider 限制）
- 大量重试 → 清理死信队列或修复根本原因后重试

**预防措施**: 配置 EmailQueueCritical / EmailQueueBacklog 告警，监控队列深度

---

## 6. 关键指标基线

| 指标 | 正常范围 | 警告阈值 | 严重阈值 | Prometheus 表达式 |
|------|---------|---------|---------|-----------------|
| HTTP 错误率 (5xx) | < 1% | > 5% | > 10% | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` |
| P50 延迟 | < 100ms | > 300ms | > 1000ms | `histogram_quantile(0.50, ...)` |
| P95 延迟 | < 500ms | > 3s | > 10s | `histogram_quantile(0.95, ...)` |
| 容器 RSS 内存 | < 350MB | > 400MB (78%) | > 450MB (88%) | `container_memory_rss{container=~".*api.*"}` |
| 容器 CPU | < 50% | > 75% | > 95% | `rate(container_cpu_usage_seconds_total{...}[5m])` |
| 健康分数 | 90-100 | < 75 | < 50 | `globalreach_health_score` |
| DB 连接池活跃 | < 8 | > 8 | = 10 (max) | `pg_stat_activity_count` |
| 邮件队列积压 | < 50 | > 100 | > 500 | 自定义 queue_pending metric |
| 请求吞吐量 (QPS) | 基线 ±20% | 下降 > 30% | 下降 > 50% | `rate(http_requests_total{job="globalreach-api"}[5m])` |
| V8 Heap Used | < 300MB | > 340MB | > 370MB | `globalreach_heap_used_bytes` |

### 告警规则对照表

| 告警名 | 严重度 | 条件 | 持续时间 | 对应 Runbook 场景 |
|--------|-------|------|---------|----------------|
| APIDown | critical | up==0 | 2min | 场景 1/2 |
| HighErrorRate | critical | 5xx率 > 10% | 5min | 场景 1/通用 |
| ContainerRestartLoop | critical | 1h 内重启 > 5次 | 10min | TT-004 |
| APIHealthCritical | critical | 健康分数 < 50 | 5min | 综合 |
| APIHealthDegraded | warning | 健康分数 < 75 | 5min | 综合 |
| HighLatencyP95 | warning | P95 > 3s | 15min | 场景 6 |
| APILatencyP50Elevated | warning | P50 > 300ms | 10min | 场景 6 |
| APIMemoryPressure | warning | RSS > 80% | 15min | 场景 5 |
| APIThroughputAnomaly | warning | 吞吐量下降 > 50% | 15min | 场景 6 |
| PostgresConnectionHigh | warning | PG连接 > 80 | 20min | 场景 3 |
| RedisMemoryHigh | warning | Redis内存 > 85% | 15min | 场景 4 |

---

## 7. 日志关键字搜索命令

```bash
# ===== 通用错误搜索 =====
# 所有 ERROR 级别日志
docker logs --since=1h globalreach-api-prod 2>&1 | grep -i '"level":"error"'

# 未捕获异常
docker logs globalreach-api-prod 2>&1 | grep -iE "(UnhandledPromiseRejection|uncaughtException|FATAL)"

# ===== 数据库相关 =====
# 连接错误
docker logs --since=1h globalreach-api-prod 2>&1 | grep -iE "(SequelizeConnectionError|ECONNREFUSED|connection.*refused|pool.*empty|timeout.*acquire)"

# 查询错误
docker logs --since=1h globalreach-api-prod 2>&1 | grep -iE "(SQL_ERROR|query.*failed|syntax error|deadlock)"

# ===== Redis 相关 =====
# Redis 连接/超时
docker logs --since=1h globalreach-api-prod 2>&1 | grep -iE "(redis.*error|ioredis.*timeout|cache.*disconnect|REDIS)"

# ===== 认证相关 =====
# JWT / Auth 错误
docker logs --since=1h globalreach-api-prod 2>&1 | grep -iE "(jwt.*error|TokenExpired|JsonWebTokenError|unauthorized|401|forbidden)"

# ===== 邮件流水线 =====
# 队列/Worker 错误
docker logs --since=1h globalreach-api-prod 2>&1 | grep -iE "(EmailQueue|SendWorker|send.*fail|smtp.*error|queue.*stuck)"

# ===== 性能相关 =====
# 慢请求
docker logs --since=1h globalreach-api-prod 2>&1 | grep -iE ("duration.*>[0-9]{4}|slow|timeout")

# GC 日志
docker logs --since=1h globalreach-api-prod 2>&1 | grep -i gc

# ===== 启动/关闭 =====
# 启动过程
docker logs globalreach-api-prod 2>&1 | grep -iE "\[Startup\]|Step [0-9]|starting|initialized|ready"

# 优雅关闭
docker logs globalreach-api-prod 2>&1 | grep -iE "(SIGTERM|SIGINT|graceful shutdown|closed|stopped)"
```

---

## 8. 相关资源

### 关联 Runbook
- [RB-002 PostgreSQL 运行手册](../runbooks/RB-002_POSTGRES.md) — 数据库相关问题深入排查
- [RB-003 Redis 运行手册](../runbooks/RB-003_REDIS.md) — 缓存层问题排查
- [RB-004 Nginx 运行手册](../runbooks/RB-004_NGINX.md) — 反向代理/SSL/TLS 问题
- [RB-007 邮件流水线运行手册](../runbooks/RB-007_EMAIL_PIPELINE.md) — 邮件发送链路详细排查
- [RB-006 Docker Compose 运行手册](../runbooks/RB-006_DOCKER.md) — 容器编排操作

### 关联决策树
- [TT-001 API 响应慢](../troubleshooting-trees/TT-001_API_SLOW.md)
- [TT-004 容器崩溃循环](../troubleshooting-trees/TT-004_CONTAINER_CRASH_LOOP.md)
- [TT-006 数据不一致](../troubleshooting-trees/TT-006_DATA_INCONSISTENCY.md)

### 配置文件
- `api/server.js` — 主入口和中间件注册
- `api/db/index.js` — 数据库模型和连接池配置
- `docker-compose.prod.yml` — API 服务定义 (第 44-114 行)
- `.env.prod` / `.env` — 环境变量（含 DB/Redis/JWT 密钥）

### Grafana 仪表盘
- GlobalReach API Overview (API 延迟/错误率/吞吐量)
- GlobalReach Health Score (综合健康评分)
- Container Resources (CPU/Memory/Network)

### 升级路径
1. **L1 — 一线运维**: 按本 Runbook 执行标准排查（预估 MTTR: 5-15 分钟）
2. **L2 — 平台工程师**: 涉及代码级修改或架构调整
3. **L3 — 架构师**: 涉及跨组件协调或重大变更决策
