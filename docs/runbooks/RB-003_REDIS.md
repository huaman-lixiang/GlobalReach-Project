# RB-003 Redis 运行手册

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **组件**: redis (globalreach-redis)
> **最后更新**: 2026-06-09

---

## 1. 组件身份卡

| 属性 | 值 |
|------|-----|
| 容器名称 | globalreach-redis |
| 镜像 | redis:7.4.9-alpine (固定版本) |
| Redis 版本 | 7.x |
| 监听端口 | 6379 (仅容器内部网络) |
| 数据卷 | redis_data → /data |
| 持久化 | RDB (默认配置, save 3600 1 / 300 100 / 60 10000) |
| 健康检查 | `redis-cli ping` → PONG (30s间隔, 10s超时, 3次重试) |
| 重启策略 | unless-stopped |
| 网络 | globalreach-network (内部网络) |
| 最大内存 | 由容器限制决定（建议设置 maxmemory） |
| 内存策略 | noeviction (默认，需确认) |

### Redis 在 GlobalReach 中的用途

| 用途 | Key 模式示例 | TTL | 说明 |
|------|-------------|-----|------|
| 用户会话 | `sess:{sessionId}` | 24h | 登录态存储 |
| API 限流计数 | `rl:{ip}:{endpoint}:{window}` | 窗口期内 | M-C04 三层限流的 L2/L3 层 |
| 缓存数据 | `cache:{namespace}:{key}` | 可配 (5min-1h) | D17 CacheService |
| 邮件队列 | `bull:*` / `emailq:*` | 任务生命周期 | EmailQueue (基于 Bull 队列) |
| 邮件发送速率 | `rate:{accountId}:{timestamp}` | 1min | SEND_RATE_LIMIT 控制 |

---

## 2. 快速命令参考

| 操作 | 命令 |
|------|------|
| 查看状态 | `docker compose -f docker-compose.prod.yml ps redis` |
| 查看日志 | `docker compose -f docker-compose.prod.yml logs -f --tail=30 redis` |
| CLI 连接 | `docker exec -it globalreach-redis redis-cli` |
| Ping 测试 | `docker exec globalreach-redis redis-cli ping` |
| 重启服务 | `docker compose -f docker-compose.prod.yml restart redis` |
| 停止服务 | `docker compose -f docker-compose.prod.yml stop redis` |
| 查看数据库大小 | `docker exec globalreach-redis redis-cli DBSIZE` |
| 查看内存使用 | `docker exec globalreach-redis redis-cli INFO memory` |
| 查看所有 key (⚠️ 生产禁用) | `docker exec globalreach-redis redis-cli KEYS '*'` |
| 安全扫描 key | `docker exec globalreach-redis redis-cli SCAN 0 COUNT 20` |
| 查看客户端连接 | `docker exec globalreach-redis redis-cli CLIENT LIST` |
| 查看慢查询 | `docker exec globalreach-redis redis-cli SLOWLOG GET 10` |
| 强制保存 RDB | `docker exec globalreach-redis redis-cli BGSAVE` |
| 查看上次保存时间 | `docker exec globalreach-redis redis-cli LASTSAVE` |
| 清空所有数据 (⚠️ 危险) | `docker exec globalreach-redis redis-cli FLUSHALL` |

---

## 3. Key 命名规范说明

GlobalReach 项目遵循以下 Redis Key 命名规范：

```
格式: {前缀}:{命名空间}:{标识符}[:{子键}]

前缀列表:
  sess:     — 用户会话 (Session)
  cache:    — 通用缓存 (CacheService)
  rl:       — 速率限制 (Rate Limit)
  bull:     — Bull 队列 (EmailQueue 底层)
  emailq:   — 邮件队列自定义 key
  rate:     — 发送速率控制
  lock:     — 分布式锁
```

**重要**: 生产环境中**严禁**使用 `KEYS *` 命令！此命令是 O(N) 复杂度，在大数据量下会阻塞 Redis 单线程。请始终使用 `SCAN` 进行迭代查询。

---

## 4. 内存使用分析

```bash
# === 内存概况 ===
docker exec globalreach-redis redis-cli INFO memory

# 关键字段解读:
# used_memory_rss: Redis 向操作系统申请的物理内存
# used_memory: Redis 分配器分配的总字节数
# used_memory_peak: 历史内存峰值
# mem_fragmentation_ratio: 碎片率 (= used_memory_rss / used_memory)
#   > 1.5 表示碎片较多，< 1.0 表示使用了 swap（危险信号）

# === 内存使用 TOP 5 Key (需要 redis-memory-forget 工具或手动估算) ===
# 使用 --bigkeys 扫描大 key
docker exec globalreach-redis redis-cli --bigkeys

# === 各数据类型 key 数量统计 ===
docker exec globalreach-redis redis-cli INFO keyspace

# === 按 Pattern 统计 key 数量 ===
# (使用 SCAN 遍历，脚本方式)
docker exec globalreach-redis redis-cli EVAL "
local cursor = 0
local counts = {}
repeat
  local reply = redis.call('SCAN', cursor, 'COUNT', 1000)
  cursor = tonumber(reply[1])
  for i=1,#reply[2] do
    local key = reply[2][i]
    local prefix = string.match(key, '^([%%w_-]+):')
    if prefix then
      counts[prefix] = (counts[prefix] or 0) + 1
    end
  end
until cursor == 0
for k,v in pairs(counts) do
  print(k .. ': ' .. v)
end
" 0
```

---

## 5. 常用运维命令详解

### 5.1 SCAN (安全的 key 遍历)

```bash
# 基础用法: 返回下一批 cursor 和 key 列表
docker exec globalreach-redis redis-cli SCAN 0 MATCH "sess:*" COUNT 20

# 遍历所有 session key (用于统计或批量操作)
docker exec globalreach-redis redis-cli SCAN 0 MATCH "sess:*" COUNT 100
# 返回结果中的第一个数字是下一个 cursor，为 0 时表示遍历完成

# 查找即将过期的 key
docker exec globalreach-redis redis-cli SCAN 0 MATCH "cache:*" COUNT 50
# 结合 TTL 检查每个 key 的剩余生存时间
```

### 5.2 INFO (服务器信息)

```bash
# 全面信息
docker exec globalreach-redis redis-cli INFO

# 分类查看
docker exec globalreach-redis redis-cli INFO server    # 版本、运行时间
docker exec globalreach-redis redis-cli INFO memory     # 内存详情
docker exec globalreach-redis redis-cli INFO stats      # 命令统计
docker exec globalreach-redis redis-cli INFO replication # 复制状态 (单节点为 standalone)
docker exec globalreach-redis redis-cli INFO clients    # 客户端连接
docker exec globalreach-redis redis-cli INFO persistence # RDB/AOF 状态
docker exec globalreach-redis redis-cli INFO keyspace   # DB/key 统计
```

### 5.3 DBSIZE (key 总数)

```bash
docker exec globalreach-redis redis-cli DBSIZE
# 返回当前数据库 (默认 DB 0) 的 key 总数
# 注意: 此命令也是 O(1) 复杂度（Redis 内部维护了计数器），可安全使用
```

### 5.4 MONITOR (实时命令监控)

```bash
# ⚠️ 仅用于调试，生产环境慎用（影响性能）
docker exec globalreach-redis redis-cli MONITOR
# 实时显示所有执行的命令，Ctrl+C 退出
```

---

## 6. 缓存失效策略

### 当前配置 (推测)

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **noeviction** (默认) | 内存满时不驱逐任何 key，写入返回错误 | 生产默认，防止数据丢失 |
| allkeys-lru | 对所有 key 使用 LRU 淘汰 | 高缓存命中场景 |
| volatile-lru | 只对设置了 TTL 的 key 使用 LRU | 混合持久/缓存场景 |

### TTL 管理

```bash
# 查看某个 key 的 TTL
docker exec globalreach-redis redis-cli TTL "cache:user:profile:abc123"
# 返回值: >0 = 剩余秒数, -1 = 无过期时间, -2 = key 不存在

# 设置/更新 TTL
docker exec globalreach-redis redis-cli EXPIRE "cache:user:profile:abc123" 3600

# 查找即将过期的 key (需要配合 SCAN + TTL)
```

### 缓存预热建议

- 用户登录后主动加载热点数据到缓存
- Campaign 开始发送前预加载模板和客户列表
- 系统启动后由 CacheService 自动填充基础数据

---

## 7. 持久化状态

### RDB 快照 (默认)

```bash
# 查看持久化配置
docker exec globalreach-redis redis-cli CONFIG GET save
# 预期输出: save 配置列表 (如 3600 1, 300 100, 60 10000)

# 查看最后一次 RDB 保存时间
docker exec globalreach-redis redis-cli LASTSAVE
# 返回 Unix 时间戳

# 手动触发 BGSAVE (后台保存，不阻塞)
docker exec globalreach-redis redis-cli BGSAVE

# 查看保存状态
docker exec globalreach-redis redis-cli INFO persistence
# 关注字段: rdb_last_bgsave_status, rdb_last_bgsave_time_sec
```

### AOF (Append Only File) — 如已启用

```bash
# 查看 AOF 状态
docker exec globalreach-redis redis-cli INFO persistence | grep aof

# 手动重写 AOF (缩小文件体积)
docker exec globalreach-redis redis-cli BGREWRITEAOF
```

### 数据文件位置

- RDB 文件: `/data/dump.rdb` (容器内) → 映射到 `redis_data` volume
- AOF 文件: `/data/appendonly.aof` (如启用)

---

## 8. 架构关系图

```
┌──────────────────────────────────────┐
│         Redis 7 (Alpine)             │
│      globalreach-redis :6379         │
│                                      │
│  ┌────────┐ ┌────────┐ ┌────────┐   │
│  │ Sessions│ │ Cache  │ │ Queue  │   │
│  │ sess:* │ │cache:* │ │bull:*  │   │
│  └───┬────┘ └───┬────┘ └───┬────┘   │
│      │          │          │         │
└──────┼──────────┼──────────┼─────────┘
       │          │          │
       ▼          ▼          ▼
┌────────────┐ ┌──────────┐ ┌──────────┐
│ API Auth   │ │CacheSvc  │ │EmailQueue│
│ (JWT/Session)│ (TTL缓存) │ (Bull队列) │
└────────────┘ └──────────┘ └──────────┘

唯一客户端: API Service (globalreach-api-prod)
降级模式: Redis 不可用时 API 以无缓存模式继续运行
```

---

## 9. 健康检查清单

- [ ] **容器状态**: `docker ps \| grep globalreach-redis` — Up
- [ ] **Ping 响应**: `redis-cli ping` → PONG
- [ ] **内存使用**: `used_memory / maxmemory` < 85% (RedisMemoryHigh 告警阈值)
- [ ] **碎片率**: `mem_fragmentation_ratio` < 2.0 (理想 < 1.5)
- [ ] **Key 数量**: DBSIZE 在预期范围内
- [ ] **RDB 状态**: 最后一次 BGSAVE 成功且时间合理 (< 1小时前)
- [ ] **客户端连接数**: 正常范围 (< 20)
- [ ] **慢查询日志**: 无异常慢命令 (> 10ms)
- [ ] **持久化文件**: dump.rdb 存在且非空

---

## 10. 故障排查场景

### 场景 1: Redis 无法连接

**症状**: API 日志报 Redis 连接错误，缓存功能不可用

**可能原因**:
1. Redis 容器未启动或崩溃
2. Redis 正在加载 RDB 文件（启动较慢）
3. Docker 网络不通
4. 达到最大客户端连接数

**诊断步骤**:
```bash
# 1. 容器状态
docker ps -a | grep globalreach-redis

# 2. 直接 ping
docker exec globalreach-redis redis-cli ping

# 3. 从 API 容器测试
docker exec globalreach-api-prod sh -c "echo > /dev/tcp/redis/6379" && echo "OK" || echo "FAIL"

# 4. 检查连接数
docker exec globalreach-redis redis-cli INFO clients | grep connected_clients
```

**解决方案**: 启动 Redis 容器。API 会自动降级到无缓存模式。

---

### 场景 2: 内存使用过高

**症状**: RedisMemoryHigh 告警触发 (>85%)

**可能原因**:
1. 缓存 key 没有 TTL，持续累积
2. 大 key 存储（如缓存了大的 HTML 模板）
3. 队列任务积压（Bull 队列未及时消费）
4. 内存碎片严重

**诊断步骤**:
```bash
# 1. 内存详情
docker exec globalreach-redis redis-cli INFO memory | grep -E "(used_memory|mem_fragmentation|maxmemory)"

# 2. 找出大 key
docker exec globalreach-redis redis-cli --bigkeys

# 3. 按 namespace 统计 key 数量和内存
docker exec globalreach-redis redis-cli MEMORY USAGE "cache:some_key"  # 单个 key

# 4. 检查队列深度
docker exec globalreach-redis redis-cli SCARD bull:email:wait  # 等待队列
```

**解决方案**:
- 无 TTL key → 给缓存 key 设置合理 TTL
- 大 key → 拆分为多个小 key 或使用 hash 结构
- 队列积压 → 排查 Worker 消费速度 (见 RB-007)
- 碎片高 → 重启 Redis（会触发 RDB 重新加载，减少碎片）

---

### 场景 3: 响应延迟升高

**症状**: API 调用 Redis 操作变慢，整体延迟上升

**可能原因**:
1. 执行 O(N) 命令 (KEYS *, FLUSHDB, DEL 大 hash)
2. Big Key 操作 (GET/HDEL/DEL 一个很大的 key)
3. 内存交换 (swap) — 最危险的情况
4. CPU 资源争抢
5. RDB fork 子进程导致阻塞

**诊断步骤**:
```bash
# 1. 慢查询日志
docker exec globalreach-redis redis-cli SLOWLOG GET 10

# 2. 即时延迟测试
docker exec globalreach-redis redis-cli --latency-history -i 1 -c 5

# 3. 检查是否在使用 swap
docker exec globalreach-redis redis-cli INFO memory | grep used_memory_rss
# 如果 used_memory_rss >> used_memory，可能在 swap

# 4. 检查 fork 是否在进行
docker exec globalreach-redis redis-cli INFO persistence | grep rdb_bgsave_in_progress
# 或 rdb_fork_percentage (fork 期间子进程内存占用比)
```

**解决方案**:
- 慢命令 → 找出并优化/禁止该命令
- Big Key → 拆分或异步处理
- Swap → 增加物理内存或减小 maxmemory
- Fork 阻塞 → 调整 `save` 配置降低频率，或在低峰期手动 BGSAVE

---

### 场景 4: 数据丢失

**症状**: 重启后发现部分数据不存在

**可能原因**:
1. RDB 未成功保存（BGSAVE 期间崩溃）
2. 使用了 noeviction 但没有持久化的纯缓存 key
3. AOF 损坏
4. 误操作 FLUSHDB/FLUSHALL

**诊断步骤**:
```bash
# 1. 检查 RDB 文件
docker exec globalreach-redis ls -la /data/dump.rdb

# 2. 检查最后的保存时间
docker exec globalreach-redis redis-cli LASTSAVE
# 对比容器启动时间

# 3. 检查 AOF 状态
docker exec globalreach-redis redis-cli INFO persistence

# 4. 查看启动日志中的加载信息
docker logs globalreach-redis 2>&1 | grep -iE "(load|rdb|aof|recover)"
```

**解决方案**:
- RDB 未保存 → 从最近的 RDB 恢复（可能有数据丢失）
- AOF 损坏 → 使用 `redis-check-aof --fix` 修复
- 误操作 → 从备份恢复

**预防措施**: 启用 AOF + RDB 混合持久化（Redis 4.0+），定期备份 dump.rdb

---

### 场景 5: 连接数耗尽

**症状**: 新连接被拒绝，报 `maxclients reached` 错误

**可能原因**:
1. 连接泄漏（应用未正确 close 连接）
2. maxclients 设置过低
3. 连接复用未启用（未使用连接池）

**诊断步骤**:
```bash
# 1. 当前连接数和配置
docker exec globalreach-redis redis-cli INFO clients
# 关注: connected_clients, blocked_clients, maxclients

# 2. 查看每个连接的详细信息
docker exec globalreach-redis redis-cli CLIENT LIST

# 3. 检查 idle 时间过长的连接
docker exec globalreach-redis redis-cli CLIENT LIST | awk -F= '$NF > 300 {print}'  # idle > 5min
```

**解决方案**:
- 泄漏连接 → 修复应用代码，确保连接正确释放
- maxclients 低 → 调大: `CONFIG SET maxclients 10000`
- 未使用连接池 → 在 API 的 Redis 客户端中使用连接池

---

### 场景 6: 队列阻塞

**症状**: EmailQueue 任务不消费或消费极慢

**可能原因**:
1. Bull 队列的 Redis key 被锁定
2. Worker 进程崩溃
3. Redis 内存满导致写入失败

**诊断步骤**:
```bash
# 1. 检查 Bull 队列相关 key
docker exec globalreach-redis redis-cli SCAN 0 MATCH "bull:*" COUNT 50

# 2. 检查等待/活跃/完成队列
docker exec globalreach-redis redis-cli TYPE bull:email:wait
docker exec globalreach-redis redis-cli LLEN bull:email:wait
docker exec globalreach-redis redis-cli LLEN bull:email:active

# 3. 检查是否有被锁定的 key
docker exec globalreach-redis redis-cli OBJECT ENCODING "bull:email:lock"
```

**解决方案**: 见 [RB-007 邮件流水线运行手册](RB-007_EMAIL_PIPELINE.md) 场景详细排查

---

## 11. 关键指标基线

| 指标 | 正常范围 | 警告阈值 | 严重阈值 | 说明 |
|------|---------|---------|---------|------|
| 内存使用率 | < 70% | > 85% | > 95% | RedisMemoryHigh 告警 |
| 碎片率 | 1.0 - 1.5 | > 2.0 | > 3.0 | mem_fragmentation_ratio |
| Key 总数 | 基线 | 突增 > 50% | 突增 > 200% | DBSIZE |
| 命令 QPS | 基线 | 波动 > 3x | 波动 > 10x | instantaneous_ops_per_sec |
| 响应延迟 (P99) | < 1ms | > 5ms | > 50ms | --latency-history |
| 连接数 | < 15 | > 30 | > 100 | connected_clients |
| 被拒绝连接 | 0 | > 10/min | > 100/min | rejected_connections |
| 慢查询数 | 0 | > 5/min | > 20/min | SLOWLOG 长度增长率 |
| RDB 保存间隔 | < 1h | > 2h | > 6h |距 LASTSAVE 的时间 |
| 命中率 (如有缓存) | > 90% | < 80% | < 60% | keyspace_hits / (hits+misses) |

---

## 12. 相关资源

### 关联 Runbook
- [RB-001 API 服务运行手册](RB-001_API_SERVICE.md) — API 层面 Redis 问题
- [RB-007 邮件流水线运行手册](RB-007_EMAIL_PIPELINE.md) — 队列相关 Redis 问题

### 配置文件
- `docker-compose.prod.yml` — redis 服务定义 (第 29-42 行)
- `api/services/cacheService.js` — Redis 缓存服务实现
- `api/queue/emailQueue.js` — Bull 队列 Redis 操作

### Grafana 仪表盘
- Redis Overview (内存/Key 数/命令统计/命中率)
- GlobalReach Cache Metrics (缓存命中率/TTL分布)
